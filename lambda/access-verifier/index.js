/**
 * Lambda Access Verifier — DocSaaS Infra TCC
 * ===========================================
 * Responsabilidade: validar o JWT recebido do MVP e gerar Pre-signed URLs
 * temporárias para que o MVP possa fazer upload e download de arquivos no S3.
 *
 * Endpoints atendidos:
 *   POST /documents/upload-url              → gera URL de upload
 *   GET  /documents/download-url/{documentId} → gera URL de download
 *
 * Variáveis de ambiente injetadas pelo CloudFormation (compute.yaml):
 *   S3_STANDARD_BUCKET   → nome do bucket S3 Standard
 *   S3_GLACIER_BUCKET    → nome do bucket S3 Glacier
 *   DYNAMODB_TABLE       → nome da tabela DynamoDB
 *   KMS_KEY_ARN          → ARN da chave KMS
 *   SNS_TOPIC_ARN        → ARN do tópico SNS
 *   PRESIGNED_URL_EXPIRY → tempo de validade da URL em segundos (900)
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { randomUUID } = require('crypto');

// Clientes AWS — usam automaticamente as credenciais da Role IAM da Lambda
const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const sns = new SNSClient({});

// Variáveis de ambiente injetadas pelo CloudFormation
const S3_STANDARD_BUCKET = process.env.S3_STANDARD_BUCKET;
const S3_GLACIER_BUCKET = process.env.S3_GLACIER_BUCKET;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const PRESIGNED_URL_EXPIRY = parseInt(process.env.PRESIGNED_URL_EXPIRY || '900');

// =============================================================================
// HANDLER PRINCIPAL
// Recebe o evento do API Gateway e encaminha para a função correta
// =============================================================================
exports.handler = async (event) => {
  // Log estruturado em JSON — aparece no CloudWatch
  log('INFO', 'access-verifier invocada', {
    method: event.httpMethod,
    path: event.path,
  });

  try {
    // Extrai e valida o JWT do header Authorization
    const jwt = extrairJWT(event.headers);
    if (!jwt) {
      return resposta(401, { error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    }

    // Decodifica o JWT para extrair tenantId e userId
    // NOTA TCC: validação simplificada — decodifica sem verificar assinatura
    // Em produção: verificar assinatura com chave pública do Supabase
    const payload = decodificarJWT(jwt);
    if (!payload) {
      return resposta(403, { error: 'Forbidden', message: 'Access denied: invalid token' });
    }

    const { tenantId, sub: userId } = payload;

    if (!tenantId || !userId) {
      return resposta(403, { error: 'Forbidden', message: 'Access denied: missing tenantId or userId in token' });
    }

    // Encaminha para a função correta baseado no método e path
    const method = event.httpMethod;
    const path = event.path;

    if (method === 'POST' && path.includes('upload-url')) {
      return await handleUpload(event, tenantId, userId);
    }

    if (method === 'GET' && path.includes('download-url')) {
      return await handleDownload(event, tenantId, userId);
    }

    return resposta(400, { error: 'Bad Request', message: 'Route not found' });

  } catch (erro) {
    log('ERROR', 'Erro interno na access-verifier', { error: erro.message, stack: erro.stack });

    // Publica evento ERROR no SNS para notificar a equipe MVP
    await publicarErroSNS({ errorMessage: erro.message, operation: 'ACCESS_VERIFIER' });

    return resposta(500, { error: 'Internal Server Error', message: 'Internal error: access operation failed' });
  }
};

// =============================================================================
// HANDLER DE UPLOAD
// Gera uma Pre-signed URL para o MVP fazer upload direto no S3
// =============================================================================
async function handleUpload(event, tenantId, userId) {
  // Lê o body da requisição enviado pelo MVP
  const body = JSON.parse(event.body || '{}');
  const { filename, contentType, sizeBytes } = body;

  // Valida campos obrigatórios
  if (!filename || !contentType) {
    return resposta(400, { error: 'Bad Request', message: 'filename and contentType are required' });
  }

  // Gera um documentId único para este documento
  const documentId = `doc_${randomUUID().replace(/-/g, '').substring(0, 20)}`;

  // Monta a chave S3 com isolamento por tenant
  // Formato: {tenantId}/{documentId}/{filename}
  // Exemplo: tenant_acme/doc_01HK2XABCDEF/contrato.pdf
  const s3Key = `${tenantId}/${documentId}/${filename}`;

  // Cria o comando de PutObject para gerar a Pre-signed URL de upload
  const comando = new PutObjectCommand({
    Bucket: S3_STANDARD_BUCKET,
    Key: s3Key,
    ContentType: contentType,
    // Metadados extras armazenados junto ao objeto no S3
    Metadata: {
      tenantid: tenantId,
      userid: userId,
      documentid: documentId,
    },
  });

  // Gera a Pre-signed URL — válida por PRESIGNED_URL_EXPIRY segundos (padrão 900s)
  const uploadUrl = await getSignedUrl(s3, comando, { expiresIn: PRESIGNED_URL_EXPIRY });

  log('INFO', 'Pre-signed URL de upload gerada', {
    tenantId,
    userId,
    documentId,
    s3Key,
    operation: 'GENERATE_UPLOAD_URL',
    status: 'APPROVED',
  });

  // Retorna a URL e o documentId para o MVP
  // O MVP deve salvar o documentId e depois chamar o metadata-handler para criar o metadado
  return resposta(200, {
    uploadUrl,
    documentId,
    s3Key,
    expiresIn: PRESIGNED_URL_EXPIRY,
  });
}

// =============================================================================
// HANDLER DE DOWNLOAD
// Verifica se o tenant tem acesso ao documento e gera URL de download
// =============================================================================
async function handleDownload(event, tenantId, userId) {
  // Extrai o documentId do path: /documents/download-url/{documentId}
  const documentId = event.pathParameters?.documentId;

  if (!documentId) {
    return resposta(400, { error: 'Bad Request', message: 'documentId is required' });
  }

  // Consulta o DynamoDB para obter os metadados do documento
  const resultado = await dynamodb.send(new GetItemCommand({
    TableName: DYNAMODB_TABLE,
    Key: {
      documentId: { S: documentId },
      tenantId: { S: tenantId },
    },
  }));

  // Se não encontrou o documento na tabela
  if (!resultado.Item) {
    log('WARN', 'Documento não encontrado', { tenantId, userId, documentId, status: 'DENIED', reason: 'not found' });
    return resposta(404, { error: 'Not Found', message: 'Document not found' });
  }

  const item = resultado.Item;

  // Verifica se o tenant do JWT é o dono do documento (proteção multi-tenant)
  if (item.tenantId.S !== tenantId) {
    log('WARN', 'Tentativa de acesso cross-tenant bloqueada', {
      tenantId,
      userId,
      documentId,
      operation: 'GENERATE_DOWNLOAD_URL',
      status: 'DENIED',
      reason: 'tenant mismatch',
    });
    return resposta(403, { error: 'Forbidden', message: 'Access denied: tenant mismatch' });
  }

  // Verifica se o documento foi logicamente deletado
  if (item.deleted?.BOOL === true) {
    return resposta(404, { error: 'Not Found', message: 'Document not found' });
  }

  const storageClass = item.storageClass?.S || 'STANDARD';
  const s3Key = item.s3Key?.S;

  // Se o documento está no Glacier Deep Archive, não é possível gerar URL imediatamente
  // Restore de Glacier leva 12-48h — fora do escopo do TCC
  if (storageClass === 'GLACIER') {
    log('INFO', 'Documento em Glacier — restore necessário', { tenantId, userId, documentId });
    return resposta(200, {
      downloadUrl: null,
      storageClass: 'GLACIER',
      restoreStatus: 'REQUIRED',
      message: 'Document is archived in Glacier Deep Archive. Restore required (12-48h).',
    });
  }

  // Gera a Pre-signed URL de download para o S3 Standard
  const comando = new GetObjectCommand({
    Bucket: S3_STANDARD_BUCKET,
    Key: s3Key,
  });

  const downloadUrl = await getSignedUrl(s3, comando, { expiresIn: PRESIGNED_URL_EXPIRY });

  log('INFO', 'Pre-signed URL de download gerada', {
    tenantId,
    userId,
    documentId,
    operation: 'GENERATE_DOWNLOAD_URL',
    status: 'APPROVED',
  });

  return resposta(200, {
    downloadUrl,
    storageClass,
    expiresIn: PRESIGNED_URL_EXPIRY,
  });
}

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/**
 * Extrai o JWT do header Authorization.
 * Formato esperado: "Bearer {token}"
 */
function extrairJWT(headers) {
  if (!headers) return null;

  // Headers podem vir em maiúsculas ou minúsculas dependendo do API Gateway
  const authHeader = headers['Authorization'] || headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  return authHeader.substring(7); // Remove "Bearer " do início
}

/**
 * Decodifica o payload do JWT sem verificar a assinatura.
 * NOTA TCC: Em produção, verificar a assinatura com a chave pública do Supabase.
 * A chave pública ficaria no AWS Secrets Manager, não hardcoded.
 */
function decodificarJWT(token) {
  try {
    // JWT tem 3 partes separadas por "." — header.payload.signature
    const partes = token.split('.');
    if (partes.length !== 3) return null;

    // O payload é a segunda parte, codificada em Base64URL
    const payloadBase64 = partes[1];

    // Converte Base64URL para Base64 normal e decodifica
    const payloadJson = Buffer.from(
      payloadBase64.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');

    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * Publica um evento de erro no SNS para notificar o MVP.
 */
async function publicarErroSNS({ tenantId, documentId, errorMessage, operation }) {
  try {
    await sns.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Message: JSON.stringify({
        event: 'ERROR',
        tenantId: tenantId || 'unknown',
        documentId: documentId || 'unknown',
        operation,
        errorMessage,
        timestamp: new Date().toISOString(),
      }),
      Subject: 'DocSaaS ERROR',
    }));
  } catch {
    // Silencia erros do SNS para não mascarar o erro original
  }
}

/**
 * Formata a resposta HTTP para o API Gateway.
 * O API Gateway espera este formato exato para repassar ao cliente.
 */
function resposta(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // CORS — permite que o frontend React do MVP acesse a API
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Log estruturado em JSON para o CloudWatch.
 * Todos os logs seguem o mesmo schema para facilitar análise.
 */
function log(level, message, dados = {}) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...dados,
  }));
}
