/**
 * Lambda Metadata Handler — DocSaaS Infra TCC
 * =============================================
 * Responsabilidade: gerenciar o ciclo de vida dos metadados dos documentos
 * no DynamoDB e publicar eventos no SNS.
 *
 * Endpoints atendidos:
 *   POST   /documents           → cria metadado após upload confirmado pelo MVP
 *   GET    /documents           → lista documentos ativos do tenant
 *   DELETE /documents/{documentId} → eliminação lógica (deleted=true)
 *
 * Variáveis de ambiente injetadas pelo CloudFormation (compute.yaml):
 *   DYNAMODB_TABLE     → nome da tabela DynamoDB
 *   DYNAMODB_GSI_NAME  → nome do GSI para queries por tenant (TenantIndex)
 *   SNS_TOPIC_ARN      → ARN do tópico SNS
 */

const {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  GetItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

// Clientes AWS — usam automaticamente as credenciais da Role IAM da Lambda
const dynamodb = new DynamoDBClient({});
const sns = new SNSClient({});

// Variáveis de ambiente injetadas pelo CloudFormation
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const DYNAMODB_GSI_NAME = process.env.DYNAMODB_GSI_NAME || 'TenantIndex';
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// =============================================================================
// HANDLER PRINCIPAL
// Recebe o evento do API Gateway e encaminha para a função correta
// =============================================================================
exports.handler = async (event) => {
  log('INFO', 'metadata-handler invocada', {
    method: event.httpMethod,
    path: event.path,
  });

  try {
    // Extrai e valida o JWT
    const jwt = extrairJWT(event.headers);
    if (!jwt) {
      return resposta(401, { error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    }

    const payload = decodificarJWT(jwt);
    if (!payload) {
      return resposta(403, { error: 'Forbidden', message: 'Access denied: invalid token' });
    }

    const { tenantId, sub: userId } = payload;

    if (!tenantId || !userId) {
      return resposta(403, { error: 'Forbidden', message: 'Access denied: missing tenantId or userId in token' });
    }

    const method = event.httpMethod;
    const path = event.path;

    // POST /documents — cria metadado após upload
    if (method === 'POST' && path === '/simulation/documents') {
      return await handleCriarMetadado(event, tenantId, userId);
    }

    // GET /documents — lista documentos do tenant
    if (method === 'GET' && path === '/simulation/documents') {
      return await handleListarDocumentos(event, tenantId);
    }

    // DELETE /documents/{documentId} — eliminação lógica
    if (method === 'DELETE' && event.pathParameters?.documentId) {
      return await handleDeletarDocumento(event, tenantId, userId);
    }

    return resposta(400, { error: 'Bad Request', message: 'Route not found' });

  } catch (erro) {
    log('ERROR', 'Erro interno na metadata-handler', { error: erro.message, stack: erro.stack });

    await publicarSNS({
      event: 'ERROR',
      tenantId: 'unknown',
      documentId: 'unknown',
      errorMessage: erro.message,
    });

    return resposta(500, { error: 'Internal Server Error', message: 'Internal error: metadata operation failed' });
  }
};

// =============================================================================
// CRIAR METADADO
// Chamado pelo MVP após confirmar que o upload no S3 foi concluído.
// Cria o item no DynamoDB com todos os metadados do documento.
// =============================================================================
async function handleCriarMetadado(event, tenantId, userId) {
  const body = JSON.parse(event.body || '{}');
  const { documentId, filename, contentType, sizeBytes, s3Key } = body;

  // Valida campos obrigatórios
  if (!documentId || !filename || !contentType || !s3Key) {
    return resposta(400, {
      error: 'Bad Request',
      message: 'documentId, filename, contentType and s3Key are required',
    });
  }

  const uploadedAt = new Date().toISOString();

  // Cria o item no DynamoDB com todos os metadados
  // storageClass começa como STANDARD — muda para GLACIER após 365 dias
  // deleted começa como false — muda para true na eliminação lógica
  await dynamodb.send(new PutItemCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      documentId:  { S: documentId },
      tenantId:    { S: tenantId },
      userId:      { S: userId },
      filename:    { S: filename },
      contentType: { S: contentType },
      sizeBytes:   { N: String(sizeBytes || 0) },
      uploadedAt:  { S: uploadedAt },
      storageClass:{ S: 'STANDARD' },
      s3Key:       { S: s3Key },
      deleted:     { BOOL: false },
    },
    // Evita sobrescrever um metadado existente com o mesmo documentId+tenantId
    ConditionExpression: 'attribute_not_exists(documentId)',
  }));

  log('INFO', 'Metadado criado no DynamoDB', {
    tenantId,
    userId,
    documentId,
    filename,
    operation: 'CREATE_METADATA',
    status: 'SUCCESS',
  });

  // Publica evento UPLOADED no SNS para notificar o MVP
  await publicarSNS({
    event: 'UPLOADED',
    tenantId,
    documentId,
    uploadedAt,
  });

  return resposta(201, {
    message: 'Document metadata created successfully',
    documentId,
    uploadedAt,
  });
}

// =============================================================================
// LISTAR DOCUMENTOS
// Lista todos os documentos ativos (deleted=false) do tenant autenticado.
// Usa o GSI TenantIndex para query eficiente por tenantId.
// Suporta paginação via query params limit e nextToken.
// =============================================================================
async function handleListarDocumentos(event, tenantId) {
  const queryParams = event.queryStringParameters || {};

  // Paginação — limite máximo de 100 documentos por página
  const limit = Math.min(parseInt(queryParams.limit || '20'), 100);

  // nextToken é o ExclusiveStartKey codificado em Base64 para paginação
  let exclusiveStartKey;
  if (queryParams.nextToken) {
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(queryParams.nextToken, 'base64').toString('utf8')
      );
    } catch {
      return resposta(400, { error: 'Bad Request', message: 'Invalid nextToken' });
    }
  }

  // Query no GSI TenantIndex — busca todos os documentos do tenant
  // FilterExpression filtra apenas os não deletados (deleted=false)
  const params = {
    TableName: DYNAMODB_TABLE,
    IndexName: DYNAMODB_GSI_NAME,
    KeyConditionExpression: 'tenantId = :tenantId',
    FilterExpression: 'deleted = :deleted',
    ExpressionAttributeValues: {
      ':tenantId': { S: tenantId },
      ':deleted':  { BOOL: false },
    },
    Limit: limit,
    ScanIndexForward: false, // Ordena do mais recente para o mais antigo
  };

  if (exclusiveStartKey) {
    params.ExclusiveStartKey = exclusiveStartKey;
  }

  const resultado = await dynamodb.send(new QueryCommand(params));

  // Converte o formato DynamoDB para JSON limpo para o MVP
  const documentos = (resultado.Items || []).map(item => ({
    documentId:   item.documentId?.S,
    filename:     item.filename?.S,
    contentType:  item.contentType?.S,
    sizeBytes:    parseInt(item.sizeBytes?.N || '0'),
    uploadedAt:   item.uploadedAt?.S,
    storageClass: item.storageClass?.S,
  }));

  // Codifica o LastEvaluatedKey em Base64 para usar como nextToken
  let nextToken = null;
  if (resultado.LastEvaluatedKey) {
    nextToken = Buffer.from(
      JSON.stringify(resultado.LastEvaluatedKey)
    ).toString('base64');
  }

  log('INFO', 'Documentos listados', {
    tenantId,
    count: documentos.length,
    operation: 'LIST_DOCUMENTS',
    status: 'SUCCESS',
  });

  return resposta(200, {
    documents: documentos,
    count: documentos.length,
    nextToken,
  });
}

// =============================================================================
// DELETAR DOCUMENTO (ELIMINAÇÃO LÓGICA)
// Marca o documento como deleted=true no DynamoDB.
// O arquivo físico permanece no S3 para fins de auditoria.
// =============================================================================
async function handleDeletarDocumento(event, tenantId, userId) {
  const documentId = event.pathParameters?.documentId;

  // Verifica se o documento existe e pertence ao tenant
  const resultado = await dynamodb.send(new GetItemCommand({
    TableName: DYNAMODB_TABLE,
    Key: {
      documentId: { S: documentId },
      tenantId:   { S: tenantId },
    },
  }));

  if (!resultado.Item) {
    return resposta(404, { error: 'Not Found', message: 'Document not found' });
  }

  // Proteção extra — garante que o tenant do JWT é o dono do documento
  if (resultado.Item.tenantId?.S !== tenantId) {
    log('WARN', 'Tentativa de deletar documento de outro tenant', {
      tenantId,
      userId,
      documentId,
      operation: 'DELETE_DOCUMENT',
      status: 'DENIED',
      reason: 'tenant mismatch',
    });
    return resposta(403, { error: 'Forbidden', message: 'Access denied: tenant mismatch' });
  }

  // Já está deletado
  if (resultado.Item.deleted?.BOOL === true) {
    return resposta(404, { error: 'Not Found', message: 'Document not found' });
  }

  // Atualiza deleted=true no DynamoDB — eliminação lógica
  // O arquivo no S3 não é removido
  await dynamodb.send(new UpdateItemCommand({
    TableName: DYNAMODB_TABLE,
    Key: {
      documentId: { S: documentId },
      tenantId:   { S: tenantId },
    },
    UpdateExpression: 'SET deleted = :deleted, deletedAt = :deletedAt, deletedBy = :deletedBy',
    ExpressionAttributeValues: {
      ':deleted':   { BOOL: true },
      ':deletedAt': { S: new Date().toISOString() },
      ':deletedBy': { S: userId },
    },
  }));

  log('INFO', 'Documento marcado como deletado', {
    tenantId,
    userId,
    documentId,
    operation: 'DELETE_DOCUMENT',
    status: 'SUCCESS',
  });

  return resposta(200, {
    message: 'Document marked as deleted',
    documentId,
  });
}

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/**
 * Publica um evento no SNS Topic.
 * Eventos possíveis: UPLOADED, ERROR
 */
async function publicarSNS(dados) {
  try {
    await sns.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Message: JSON.stringify({
        ...dados,
        timestamp: new Date().toISOString(),
      }),
      Subject: `DocSaaS ${dados.event}`,
    }));

    log('INFO', `Evento ${dados.event} publicado no SNS`, { documentId: dados.documentId });
  } catch (erro) {
    log('ERROR', 'Falha ao publicar no SNS', { error: erro.message });
  }
}

/**
 * Extrai o JWT do header Authorization.
 */
function extrairJWT(headers) {
  if (!headers) return null;
  const authHeader = headers['Authorization'] || headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

/**
 * Decodifica o payload do JWT sem verificar a assinatura.
 * NOTA TCC: Em produção, verificar assinatura com chave pública do Supabase.
 */
function decodificarJWT(token) {
  try {
    const partes = token.split('.');
    if (partes.length !== 3) return null;
    const payloadJson = Buffer.from(
      partes[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * Formata a resposta HTTP para o API Gateway.
 */
function resposta(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Log estruturado em JSON para o CloudWatch.
 */
function log(level, message, dados = {}) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...dados,
  }));
}
