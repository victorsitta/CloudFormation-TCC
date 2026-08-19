/**
 * Lambda Archive Trigger — DocSaaS Infra TCC
 * ============================================
 * Responsabilidade: reagir automaticamente quando o S3 move um documento
 * do bucket Standard para o bucket Glacier Deep Archive (após 365 dias).
 *
 * NÃO é chamada pelo MVP — é acionada automaticamente pelo S3 via evento.
 *
 * Fluxo:
 *   1. S3 Lifecycle Policy detecta objeto com 365+ dias
 *   2. S3 move o objeto para Glacier Deep Archive automaticamente
 *   3. S3 envia evento para esta Lambda
 *   4. Lambda extrai tenantId e documentId do caminho S3
 *   5. Lambda atualiza DynamoDB: storageClass → "GLACIER"
 *   6. Lambda publica evento ARCHIVED no SNS
 *
 * Variáveis de ambiente injetadas pelo CloudFormation (compute.yaml):
 *   DYNAMODB_TABLE → nome da tabela DynamoDB
 *   SNS_TOPIC_ARN  → ARN do tópico SNS
 */

const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

// Clientes AWS — usam automaticamente as credenciais da Role IAM da Lambda
const dynamodb = new DynamoDBClient({});
const sns = new SNSClient({});

// Variáveis de ambiente injetadas pelo CloudFormation
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// =============================================================================
// HANDLER PRINCIPAL
// O S3 pode enviar múltiplos eventos em lote — processamos cada um
// =============================================================================
exports.handler = async (event) => {
  log('INFO', 'archive-trigger invocada', {
    totalEventos: event.Records?.length || 0,
  });

  // O S3 envia os eventos dentro de event.Records (pode ser mais de um por vez)
  const registros = event.Records || [];
  const resultados = [];

  for (const registro of registros) {
    try {
      const resultado = await processarEvento(registro);
      resultados.push({ status: 'SUCCESS', ...resultado });
    } catch (erro) {
      log('ERROR', 'Erro ao processar evento S3', {
        error: erro.message,
        registro: registro.s3?.object?.key,
      });
      resultados.push({ status: 'ERROR', error: erro.message });
    }
  }

  log('INFO', 'archive-trigger concluída', {
    processados: resultados.length,
    sucessos: resultados.filter(r => r.status === 'SUCCESS').length,
    erros: resultados.filter(r => r.status === 'ERROR').length,
  });

  return { processados: resultados.length, resultados };
};

// =============================================================================
// PROCESSAR EVENTO S3
// Extrai informações do evento e atualiza DynamoDB + SNS
// =============================================================================
async function processarEvento(registro) {
  // O evento S3 contém o bucket e a chave (key) do objeto arquivado
  const bucket = registro.s3?.bucket?.name;
  const s3Key = decodeURIComponent(registro.s3?.object?.key?.replace(/\+/g, ' ') || '');

  if (!bucket || !s3Key) {
    throw new Error('Evento S3 inválido: bucket ou key ausente');
  }

  log('INFO', 'Processando arquivamento', { bucket, s3Key });

  // Extrai tenantId e documentId do caminho S3
  // Formato esperado: {tenantId}/{documentId}/{filename}
  // Exemplo: tenant_acme/doc_01HK2XABCDEF/contrato.pdf
  const { tenantId, documentId } = extrairIdsDoS3Key(s3Key);

  if (!tenantId || !documentId) {
    throw new Error(`Não foi possível extrair tenantId e documentId do s3Key: ${s3Key}`);
  }

  const archivedAt = new Date().toISOString();

  // Atualiza o campo storageClass no DynamoDB de STANDARD para GLACIER
  // Também registra a data do arquivamento para auditoria
  await dynamodb.send(new UpdateItemCommand({
    TableName: DYNAMODB_TABLE,
    Key: {
      documentId: { S: documentId },
      tenantId:   { S: tenantId },
    },
    UpdateExpression: 'SET storageClass = :storageClass, archivedAt = :archivedAt',
    ExpressionAttributeValues: {
      ':storageClass': { S: 'GLACIER' },
      ':archivedAt':   { S: archivedAt },
    },
    // Só atualiza se o documento existir — evita criar item fantasma
    ConditionExpression: 'attribute_exists(documentId)',
  }));

  log('INFO', 'DynamoDB atualizado — storageClass: GLACIER', {
    tenantId,
    documentId,
    archivedAt,
    operation: 'ARCHIVE_DOCUMENT',
    status: 'SUCCESS',
  });

  // Publica evento ARCHIVED no SNS para notificar o MVP
  await publicarSNS({
    event: 'ARCHIVED',
    tenantId,
    documentId,
    archivedAt,
    s3Key,
    bucket,
  });

  return { tenantId, documentId, archivedAt };
}

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/**
 * Extrai tenantId e documentId do caminho S3.
 *
 * Formato do caminho: {tenantId}/{documentId}/{filename}
 * Exemplo: tenant_acme_corp/doc_01HK2XABCDEF/contrato-2024.pdf
 *
 * Retorna: { tenantId: "tenant_acme_corp", documentId: "doc_01HK2XABCDEF" }
 */
function extrairIdsDoS3Key(s3Key) {
  const partes = s3Key.split('/');

  // O caminho precisa ter pelo menos 3 partes: tenantId / documentId / filename
  if (partes.length < 3) {
    log('WARN', 'Formato de s3Key inválido', { s3Key });
    return { tenantId: null, documentId: null };
  }

  return {
    tenantId:   partes[0],  // Primeira parte: tenant_acme_corp
    documentId: partes[1],  // Segunda parte: doc_01HK2XABCDEF
    filename:   partes.slice(2).join('/'),  // Resto: nome do arquivo
  };
}

/**
 * Publica um evento no SNS Topic.
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

    log('INFO', `Evento ${dados.event} publicado no SNS`, {
      documentId: dados.documentId,
      tenantId: dados.tenantId,
    });
  } catch (erro) {
    // Loga o erro mas não interrompe o fluxo — a atualização do DynamoDB já ocorreu
    log('ERROR', 'Falha ao publicar no SNS', { error: erro.message });
  }
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
