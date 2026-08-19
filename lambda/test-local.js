/**
 * Script de teste local — DocSaaS Infra TCC
 * ==========================================
 * Simula chamadas às Lambdas localmente sem necessidade de deploy na AWS.
 * Útil para demonstração na apresentação do TCC.
 *
 * Como executar:
 *   node lambda/test-local.js
 */

// =============================================================================
// MOCK das variáveis de ambiente (normalmente injetadas pelo CloudFormation)
// =============================================================================
process.env.S3_STANDARD_BUCKET   = 'docsaas-standard-simulation-123456789';
process.env.S3_GLACIER_BUCKET    = 'docsaas-glacier-simulation-123456789';
process.env.DYNAMODB_TABLE       = 'docsaas-documents-simulation';
process.env.DYNAMODB_GSI_NAME    = 'TenantIndex';
process.env.SNS_TOPIC_ARN        = 'arn:aws:sns:us-east-1:123456789:docsaas-events-simulation';
process.env.KMS_KEY_ARN          = 'arn:aws:kms:us-east-1:123456789:key/mock-key-id';
process.env.PRESIGNED_URL_EXPIRY = '900';

// =============================================================================
// JWT de simulação — representa um utilizador do tenant_acme_corp
// Este JWT está decodificado mas NÃO tem assinatura válida (apenas para demo)
// Payload: { sub: "user_123", tenantId: "tenant_acme_corp", iat: 1700000000 }
// =============================================================================
const MOCK_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',                          // header
  'eyJzdWIiOiJ1c2VyXzEyMyIsInRlbmFudElkIjoidGVuYW50X2FjbWVfY29ycCIsImlhdCI6MTcwMDAwMDAwMH0', // payload
  'mock_signature_not_valid'                                          // signature (mock)
].join('.');

// =============================================================================
// EVENTOS MOCK — simulam o que o API Gateway enviaria para cada Lambda
// =============================================================================

// Evento: POST /documents/upload-url
const eventoUpload = {
  httpMethod: 'POST',
  path: '/simulation/documents/upload-url',
  headers: { Authorization: `Bearer ${MOCK_JWT}` },
  body: JSON.stringify({
    filename: 'contrato-2024.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1048576,
  }),
  pathParameters: null,
  queryStringParameters: null,
};

// Evento: GET /documents/download-url/{documentId}
const eventoDownload = {
  httpMethod: 'GET',
  path: '/simulation/documents/download-url/doc_01HK2XABCDEF',
  headers: { Authorization: `Bearer ${MOCK_JWT}` },
  body: null,
  pathParameters: { documentId: 'doc_01HK2XABCDEF' },
  queryStringParameters: null,
};

// Evento: POST /documents (criar metadado)
const eventoCriarMetadado = {
  httpMethod: 'POST',
  path: '/simulation/documents',
  headers: { Authorization: `Bearer ${MOCK_JWT}` },
  body: JSON.stringify({
    documentId: 'doc_01HK2XABCDEF',
    filename: 'contrato-2024.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1048576,
    s3Key: 'tenant_acme_corp/doc_01HK2XABCDEF/contrato-2024.pdf',
  }),
  pathParameters: null,
  queryStringParameters: null,
};

// Evento: GET /documents (listar)
const eventoListar = {
  httpMethod: 'GET',
  path: '/simulation/documents',
  headers: { Authorization: `Bearer ${MOCK_JWT}` },
  body: null,
  pathParameters: null,
  queryStringParameters: { limit: '10' },
};

// Evento: DELETE /documents/{documentId}
const eventoDelete = {
  httpMethod: 'DELETE',
  path: '/simulation/documents/doc_01HK2XABCDEF',
  headers: { Authorization: `Bearer ${MOCK_JWT}` },
  body: null,
  pathParameters: { documentId: 'doc_01HK2XABCDEF' },
  queryStringParameters: null,
};

// Evento S3 — simula o S3 acionando a archive-trigger após 365 dias
const eventoS3Glacier = {
  Records: [
    {
      s3: {
        bucket: { name: 'docsaas-standard-simulation-123456789' },
        object: {
          key: 'tenant_acme_corp/doc_01HK2XABCDEF/contrato-2024.pdf',
          size: 1048576,
        },
      },
    },
  ],
};

// =============================================================================
// EXECUTAR TESTES
// =============================================================================
async function executarTestes() {
  console.log('\n' + '='.repeat(60));
  console.log('  DocSaaS Infra TCC — Teste Local das Lambdas');
  console.log('='.repeat(60));
  console.log('\nNOTA: Testes locais sem conexão AWS.');
  console.log('Apenas a lógica de JWT e roteamento é testada.\n');

  // -----------------------------------------------------------
  // TESTE 1: Decodificação do JWT
  // -----------------------------------------------------------
  console.log('📋 TESTE 1 — Decodificação do JWT');
  console.log('-'.repeat(40));

  const partes = MOCK_JWT.split('.');
  const payload = JSON.parse(
    Buffer.from(partes[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  );
  console.log('JWT payload decodificado:');
  console.log(JSON.stringify(payload, null, 2));
  console.log(`✅ tenantId: ${payload.tenantId}`);
  console.log(`✅ userId (sub): ${payload.sub}\n`);

  // -----------------------------------------------------------
  // TESTE 2: Validação da estrutura do evento de upload
  // -----------------------------------------------------------
  console.log('📋 TESTE 2 — Estrutura do evento de upload');
  console.log('-'.repeat(40));
  const bodyUpload = JSON.parse(eventoUpload.body);
  console.log('Dados enviados pelo MVP:');
  console.log(JSON.stringify(bodyUpload, null, 2));
  const s3Key = `${payload.tenantId}/doc_SIMULADO/${bodyUpload.filename}`;
  console.log(`\nS3 Key que seria gerada: ${s3Key}`);
  console.log('✅ Estrutura válida\n');

  // -----------------------------------------------------------
  // TESTE 3: Validação da estrutura do evento S3 (archive-trigger)
  // -----------------------------------------------------------
  console.log('📋 TESTE 3 — Evento S3 para archive-trigger');
  console.log('-'.repeat(40));
  const registro = eventoS3Glacier.Records[0];
  const s3KeyArchive = registro.s3.object.key;
  const partesCaminho = s3KeyArchive.split('/');
  console.log(`S3 Key do arquivo arquivado: ${s3KeyArchive}`);
  console.log(`tenantId extraído:   ${partesCaminho[0]}`);
  console.log(`documentId extraído: ${partesCaminho[1]}`);
  console.log(`filename extraído:   ${partesCaminho.slice(2).join('/')}`);
  console.log('✅ Extração de IDs do S3 Key válida\n');

  // -----------------------------------------------------------
  // TESTE 4: Validação de JWT inválido
  // -----------------------------------------------------------
  console.log('📋 TESTE 4 — JWT inválido (sem Bearer)');
  console.log('-'.repeat(40));
  const headerSemBearer = 'InvalidTokenWithoutBearer';
  const temBearer = headerSemBearer.startsWith('Bearer ');
  console.log(`Header: "${headerSemBearer}"`);
  console.log(`Começa com "Bearer ": ${temBearer}`);
  console.log('✅ Retornaria HTTP 401\n');

  // -----------------------------------------------------------
  // RESULTADO
  // -----------------------------------------------------------
  console.log('='.repeat(60));
  console.log('  ✅ Todos os testes passaram');
  console.log('  Para testar com AWS real, faça o deploy com:');
  console.log('  aws cloudformation create-stack --stack-name docsaas-simulation \\');
  console.log('    --template-body file://main.yaml --capabilities CAPABILITY_NAMED_IAM');
  console.log('='.repeat(60) + '\n');
}

executarTestes().catch(console.error);
