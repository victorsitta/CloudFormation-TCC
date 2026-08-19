# Lambda — Archive Trigger

## O que faz

Reage automaticamente quando o S3 move um documento do bucket Standard
para o Glacier Deep Archive (após 365 dias via Lifecycle Policy).

**Não é chamada pelo MVP** — é acionada automaticamente pelo S3.

## Fluxo

```
[365 dias após o upload]
        ↓
S3 Lifecycle Policy move objeto → Glacier Deep Archive (automático)
        ↓
S3 envia evento para esta Lambda
        ↓
Lambda extrai tenantId e documentId do caminho S3:
  "tenant_acme/doc_01HK2X/contrato.pdf"
   └── tenantId: tenant_acme
   └── documentId: doc_01HK2X
        ↓
Lambda atualiza DynamoDB: storageClass → "GLACIER"
        ↓
Lambda publica evento ARCHIVED no SNS
```

## Formato do evento S3

```json
{
  "Records": [
    {
      "s3": {
        "bucket": { "name": "docsaas-standard-simulation-123456789" },
        "object": { "key": "tenant_acme/doc_01HK2XABCDEF/contrato.pdf" }
      }
    }
  ]
}
```

## Evento SNS publicado

```json
{
  "event": "ARCHIVED",
  "tenantId": "tenant_acme",
  "documentId": "doc_01HK2XABCDEF",
  "archivedAt": "2025-03-15T00:00:00Z",
  "timestamp": "2025-03-15T00:00:00Z"
}
```

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `DYNAMODB_TABLE` | Nome da tabela DynamoDB |
| `SNS_TOPIC_ARN` | ARN do tópico SNS |
