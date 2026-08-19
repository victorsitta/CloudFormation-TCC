# Lambda — Metadata Handler

## O que faz

Gerencia o ciclo de vida dos metadados dos documentos no DynamoDB.
Cria, lista e deleta metadados. Publica eventos no SNS.

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/documents` | Cria metadado após upload confirmado |
| GET | `/documents` | Lista documentos ativos do tenant |
| DELETE | `/documents/{documentId}` | Eliminação lógica (deleted=true) |

## O que é metadado?

O DynamoDB **não armazena o arquivo** — esse fica no S3.
O DynamoDB armazena apenas as **informações sobre o arquivo**:

```json
{
  "documentId":   "doc_01HK2XABCDEF",
  "tenantId":     "tenant_acme",
  "userId":       "user_123",
  "filename":     "contrato.pdf",
  "contentType":  "application/pdf",
  "sizeBytes":    1048576,
  "uploadedAt":   "2024-03-15T14:30:00Z",
  "storageClass": "STANDARD",
  "s3Key":        "tenant_acme/doc_01HK2XABCDEF/contrato.pdf",
  "deleted":      false
}
```

## Eliminação Lógica

O DELETE **não remove o arquivo do S3**. Apenas marca `deleted=true` no DynamoDB.
O arquivo permanece no S3 para fins de auditoria e conformidade (LGPD).

## Eventos SNS publicados

| Evento | Quando |
|--------|--------|
| `UPLOADED` | Após criar metadado com sucesso |
| `ERROR` | Em caso de erro crítico |

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `DYNAMODB_TABLE` | Nome da tabela DynamoDB |
| `DYNAMODB_GSI_NAME` | Nome do GSI (padrão: TenantIndex) |
| `SNS_TOPIC_ARN` | ARN do tópico SNS |
