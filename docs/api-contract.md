# Contrato da API

## Visão Geral

O API Gateway expõe 4 endpoints REST no stage `simulation`. Todos os endpoints requerem o header `Authorization: Bearer {JWT}` onde o JWT é emitido pelo Supabase Auth.

**Base URL**: `https://{api-id}.execute-api.{region}.amazonaws.com/simulation`

---

## Autenticação

Todos os endpoints requerem o header:
```
Authorization: Bearer {JWT_do_Supabase}
```

O JWT deve conter os claims:
- `sub`: userId
- `tenantId`: identificador do tenant (claim customizado adicionado pela equipe MVP)

---

## Endpoints

### 1. Gerar URL de Upload

**POST** `/documents/upload-url`

Gera uma Pre-signed URL para upload directo ao S3.

**Request Body**:
```json
{
  "filename": "relatorio-anual.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 2048576
}
```

**Response 200**:
```json
{
  "uploadUrl": "https://s3.amazonaws.com/docsaas-standard-{env}/...",
  "documentId": "doc_01HK2X...",
  "expiresIn": 900
}
```

**Response 401** — JWT ausente ou malformado:
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid Authorization header"
}
```

**Response 403** — Token inválido ou expirado:
```json
{
  "error": "Forbidden",
  "message": "Access denied: invalid token"
}
```

---

### 2. Gerar URL de Download

**GET** `/documents/download-url/{documentId}`

Gera uma Pre-signed URL para download directo do S3 (Standard ou Glacier).

**Path Parameters**:
- `documentId` (string): Identificador do documento

**Response 200**:
```json
{
  "downloadUrl": "https://s3.amazonaws.com/...",
  "storageClass": "STANDARD",
  "expiresIn": 900
}
```

**Response 403** — Tenant mismatch:
```json
{
  "error": "Forbidden",
  "message": "Access denied: tenant mismatch"
}
```

**Response 404** — Documento não encontrado:
```json
{
  "error": "Not Found",
  "message": "Document not found"
}
```

**Nota sobre Glacier**: Se o documento estiver em Glacier Deep Archive, o campo `downloadUrl` será `null` e a resposta incluirá `"restoreStatus": "REQUIRED"`. Restore de Glacier não está no escopo do TCC.

---

### 3. Listar Documentos do Tenant

**GET** `/documents`

Lista todos os documentos activos do tenant autenticado.

**Query Parameters** (opcionais):
- `limit` (number): Máximo de resultados (padrão: 20, máximo: 100)
- `nextToken` (string): Token de paginação

**Response 200**:
```json
{
  "documents": [
    {
      "documentId": "doc_01HK2X...",
      "filename": "relatorio-anual.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 2048576,
      "uploadedAt": "2024-01-15T10:30:00Z",
      "storageClass": "STANDARD"
    }
  ],
  "count": 1,
  "nextToken": null
}
```

---

### 4. Eliminação Lógica de Documento

**DELETE** `/documents/{documentId}`

Marca um documento como eliminado (eliminação lógica — o ficheiro permanece no S3).

**Path Parameters**:
- `documentId` (string): Identificador do documento

**Response 200**:
```json
{
  "message": "Document marked as deleted",
  "documentId": "doc_01HK2X..."
}
```

**Response 403** — Tenant mismatch:
```json
{
  "error": "Forbidden",
  "message": "Access denied: tenant mismatch"
}
```

---

## Códigos de Erro

| Código | Situação |
|--------|----------|
| 400 | Request body inválido ou parâmetros em falta |
| 401 | JWT ausente ou malformado |
| 403 | JWT inválido/expirado ou tenant mismatch |
| 404 | Documento não encontrado |
| 500 | Erro interno (Lambda, DynamoDB ou KMS) |

---

## Eventos SNS

Após operações bem-sucedidas, a infra publica eventos no SNS Topic.

### Evento UPLOADED
```json
{
  "event": "UPLOADED",
  "tenantId": "tenant_123",
  "documentId": "doc_01HK2X...",
  "uploadedAt": "2024-01-15T10:30:00Z"
}
```

### Evento ARCHIVED
```json
{
  "event": "ARCHIVED",
  "tenantId": "tenant_123",
  "documentId": "doc_01HK2X...",
  "archivedAt": "2025-01-15T00:00:00Z"
}
```

### Evento ERROR
```json
{
  "event": "ERROR",
  "tenantId": "tenant_123",
  "documentId": "doc_01HK2X...",
  "errorMessage": "DynamoDB write failed: ..."
}
```
