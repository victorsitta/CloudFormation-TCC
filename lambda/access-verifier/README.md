# Lambda — Access Verifier

## O que faz

Valida o JWT recebido do MVP e gera URLs temporárias (Pre-signed URLs) para
upload e download de arquivos diretamente no S3.

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/documents/upload-url` | Gera URL de upload para o S3 |
| GET | `/documents/download-url/{documentId}` | Gera URL de download do S3 |

## Fluxo de Upload

```
MVP → POST /documents/upload-url
      Body: { filename, contentType, sizeBytes }
      Header: Authorization: Bearer {JWT}
          ↓
Lambda extrai tenantId + userId do JWT
Lambda gera documentId único
Lambda gera Pre-signed URL para {tenantId}/{documentId}/{filename} no S3
          ↓
Resposta: { uploadUrl, documentId, expiresIn: 900 }
          ↓
MVP faz PUT direto no S3 usando uploadUrl
```

## Fluxo de Download

```
MVP → GET /documents/download-url/{documentId}
      Header: Authorization: Bearer {JWT}
          ↓
Lambda extrai tenantId do JWT
Lambda consulta DynamoDB para verificar dono do documento
Lambda verifica se tenantId do JWT == tenantId do documento
Lambda gera Pre-signed URL para o caminho S3 correto
          ↓
Resposta: { downloadUrl, storageClass, expiresIn: 900 }
```

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `S3_STANDARD_BUCKET` | Nome do bucket S3 Standard |
| `S3_GLACIER_BUCKET` | Nome do bucket S3 Glacier |
| `DYNAMODB_TABLE` | Nome da tabela DynamoDB |
| `KMS_KEY_ARN` | ARN da chave KMS |
| `SNS_TOPIC_ARN` | ARN do tópico SNS |
| `PRESIGNED_URL_EXPIRY` | Validade da URL em segundos (padrão: 900) |

## Respostas de Erro

| Código | Situação |
|--------|----------|
| 400 | Body inválido ou campos obrigatórios ausentes |
| 401 | Header Authorization ausente |
| 403 | JWT inválido ou tenant mismatch |
| 404 | Documento não encontrado |
| 500 | Erro interno (S3, DynamoDB ou KMS) |
