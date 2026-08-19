# Modelo de Dados

## DynamoDB — Tabela de Metadados

### Estrutura da Tabela

**Nome**: `docsaas-documents-{environment}`

| Atributo | Tipo | Papel | Descrição |
|----------|------|-------|-----------|
| `documentId` | String (S) | Partition Key | Identificador único do documento (ex: `doc_01HK2X...`) |
| `tenantId` | String (S) | Sort Key | Identificador do tenant proprietário |
| `userId` | String (S) | — | Identificador do utilizador que fez o upload |
| `filename` | String (S) | — | Nome original do ficheiro |
| `contentType` | String (S) | — | MIME type (ex: `application/pdf`) |
| `sizeBytes` | Number (N) | — | Tamanho do ficheiro em bytes |
| `uploadedAt` | String (S) | — | ISO 8601 timestamp do upload |
| `storageClass` | String (S) | — | `STANDARD` ou `GLACIER` |
| `s3Key` | String (S) | — | Chave S3 completa: `{tenantId}/{documentId}/{filename}` |
| `deleted` | Boolean (BOOL) | — | Flag de eliminação lógica |

### Exemplo de Item

```json
{
  "documentId": "doc_01HK2XABCDEF",
  "tenantId": "tenant_acme_corp",
  "userId": "user_abc123",
  "filename": "contrato-2024.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 1048576,
  "uploadedAt": "2024-03-15T14:30:00Z",
  "storageClass": "STANDARD",
  "s3Key": "tenant_acme_corp/doc_01HK2XABCDEF/contrato-2024.pdf",
  "deleted": false
}
```

### Padrões de Acesso

| Operação | Tipo de Query | Parâmetros |
|----------|---------------|------------|
| Obter metadado por documentId | GetItem | `documentId` + `tenantId` |
| Listar documentos do tenant | Query | `tenantId` (GSI) + `deleted = false` |
| Criar metadado | PutItem | Item completo |
| Eliminação lógica | UpdateItem | `documentId` + `tenantId` → `deleted = true` |
| Actualizar storageClass | UpdateItem | `documentId` + `tenantId` → `storageClass = GLACIER` |

### Global Secondary Index (GSI)

Para suportar queries por tenant, é necessário um GSI:

**Nome**: `TenantIndex`
- Partition Key: `tenantId`
- Sort Key: `uploadedAt`
- Projection: ALL

Isto permite listar todos os documentos de um tenant ordenados por data de upload.

---

## S3 — Estrutura de Objectos

### S3 Standard Bucket

**Nome**: `docsaas-standard-{environment}-{accountId}`

**Estrutura de prefixo**:
```
{tenantId}/
  {documentId}/
    {filename}
```

**Exemplo**:
```
tenant_acme_corp/
  doc_01HK2XABCDEF/
    contrato-2024.pdf
  doc_01HK2XGHIJKL/
    relatorio-anual.pdf

tenant_startup_xyz/
  doc_01HK2XMNOPQR/
    proposta-comercial.docx
```

**Configurações**:
- Encriptação: SSE-KMS (KMS_Key CMK)
- Versionamento: Activado
- Block Public Access: Activado completamente
- Lifecycle Policy: Transição para Glacier após 365 dias

### S3 Glacier Deep Archive Bucket

**Nome**: `docsaas-glacier-{environment}-{accountId}`

**Estrutura de prefixo**: Idêntica ao S3 Standard (mantida para consistência)

**Configurações**:
- Encriptação: SSE-KMS (KMS_Key CMK)
- Block Public Access: Activado completamente
- Classe de armazenamento: GLACIER_DEEP_ARCHIVE

---

## KMS — Chave de Encriptação

**Alias**: `alias/docsaas-key-{environment}`

**Tipo**: Symmetric, ENCRYPT_DECRYPT

**Usos**:
- Encriptação de objectos S3 Standard (SSE-KMS)
- Encriptação de objectos S3 Glacier (SSE-KMS)
- Encriptação em repouso DynamoDB

**Rotação**: Automática anual

---

## Fluxo de Dados por Operação

### Upload

```
1. Cliente → API Gateway (POST /documents/upload-url)
   Body: { filename, contentType, sizeBytes }
   Header: Authorization: Bearer {JWT}

2. API Gateway → Lambda Access Verifier
   Passa: JWT + body da requisição

3. Lambda Access Verifier:
   a. Extrai tenantId e userId do JWT
   b. Gera documentId único
   c. Constrói s3Key = {tenantId}/{documentId}/{filename}
   d. Gera Pre-signed URL para s3Key no S3 Standard (TTL: 900s)
   e. Retorna { uploadUrl, documentId, expiresIn: 900 }

4. Cliente → S3 Standard (upload directo via Pre-signed URL)

5. S3 Standard → Lambda Metadata Handler (via evento S3 ou chamada directa)
   Lambda cria item no DynamoDB com storageClass: "STANDARD"
   Lambda publica evento UPLOADED no SNS
```

### Arquivamento (automático após 365 dias)

```
1. S3 Lifecycle Policy detecta objecto com 365+ dias
2. S3 move objecto para S3 Glacier Deep Archive
3. Lambda Archive Trigger é invocada:
   a. Actualiza DynamoDB: storageClass → "GLACIER"
   b. Publica evento ARCHIVED no SNS
```
