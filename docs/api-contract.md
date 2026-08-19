# API Reference

**Base URL:** `https://{api-id}.execute-api.{region}.amazonaws.com/simulation`

All endpoints require a Supabase-issued JWT in the `Authorization` header. The JWT must contain a custom `tenantId` claim configured by the MVP team in Supabase Auth.

---

## Authentication

**Header required on all requests:**
```
Authorization: Bearer {jwt_token}
```

**Required JWT claims:**
| Claim | Description |
|-------|-------------|
| `sub` | User ID (standard JWT subject) |
| `tenantId` | Tenant identifier (custom claim — must be configured in Supabase Auth) |

---

## Endpoints

### POST /documents/upload-url

Generates a pre-signed S3 URL for direct file upload. The client must use this URL to upload the file directly to S3 — the file does not pass through the API.

**Request**

```http
POST /documents/upload-url
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "filename": "annual-report.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 2048576
}
```

**Response 200**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/docsaas-standard-simulation-{accountId}/tenant_acme/doc_ABC123/annual-report.pdf?X-Amz-...",
  "documentId": "doc_ABC123",
  "s3Key": "tenant_acme/doc_ABC123/annual-report.pdf",
  "expiresIn": 900
}
```

**Response 400** — Missing required fields
```json
{
  "error": "Bad Request",
  "message": "filename and contentType are required"
}
```

**Response 401** — Missing Authorization header
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid Authorization header"
}
```

**Response 403** — Invalid or expired token
```json
{
  "error": "Forbidden",
  "message": "Access denied: invalid token"
}
```

> After uploading the file to S3, call `POST /documents` to register the document metadata.

---

### POST /documents

Registers document metadata in DynamoDB after a successful S3 upload. Must be called after the file has been uploaded to S3 using the pre-signed URL.

**Request**

```http
POST /documents
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "documentId": "doc_ABC123",
  "filename": "annual-report.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 2048576,
  "s3Key": "tenant_acme/doc_ABC123/annual-report.pdf"
}
```

**Response 201**
```json
{
  "message": "Document metadata created successfully",
  "documentId": "doc_ABC123",
  "uploadedAt": "2024-03-15T14:30:00.000Z"
}
```

**Response 400** — Missing required fields
```json
{
  "error": "Bad Request",
  "message": "documentId, filename, contentType and s3Key are required"
}
```

---

### GET /documents

Returns all active (non-deleted) documents belonging to the authenticated tenant. Supports pagination.

**Request**

```http
GET /documents?limit=20&nextToken={token}
Authorization: Bearer {token}
```

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | No | 20 | Maximum results per page (max: 100) |
| `nextToken` | string | No | — | Pagination cursor from previous response |

**Response 200**
```json
{
  "documents": [
    {
      "documentId": "doc_ABC123",
      "filename": "annual-report.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 2048576,
      "uploadedAt": "2024-03-15T14:30:00.000Z",
      "storageClass": "STANDARD"
    }
  ],
  "count": 1,
  "nextToken": null
}
```

> `storageClass` will be `STANDARD` for active documents and `GLACIER` for documents archived after 365 days.

---

### GET /documents/download-url/{documentId}

Generates a pre-signed S3 URL for direct file download. If the document is in Glacier Deep Archive, the URL will be `null` and a restore will be required.

**Request**

```http
GET /documents/download-url/{documentId}
Authorization: Bearer {token}
```

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | Document identifier |

**Response 200 — Standard storage**
```json
{
  "downloadUrl": "https://s3.amazonaws.com/docsaas-standard-simulation-{accountId}/...",
  "storageClass": "STANDARD",
  "expiresIn": 900
}
```

**Response 200 — Glacier Deep Archive**
```json
{
  "downloadUrl": null,
  "storageClass": "GLACIER",
  "restoreStatus": "REQUIRED",
  "message": "Document is archived in Glacier Deep Archive. Restore required (12-48h)."
}
```

**Response 403** — Tenant mismatch (cross-tenant access attempt)
```json
{
  "error": "Forbidden",
  "message": "Access denied: tenant mismatch"
}
```

**Response 404** — Document not found or deleted
```json
{
  "error": "Not Found",
  "message": "Document not found"
}
```

---

### DELETE /documents/{documentId}

Performs a logical deletion — marks the document as deleted in DynamoDB. The file remains in S3 for audit and compliance purposes.

**Request**

```http
DELETE /documents/{documentId}
Authorization: Bearer {token}
```

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | Document identifier |

**Response 200**
```json
{
  "message": "Document marked as deleted",
  "documentId": "doc_ABC123"
}
```

**Response 403** — Tenant mismatch
```json
{
  "error": "Forbidden",
  "message": "Access denied: tenant mismatch"
}
```

**Response 404** — Document not found
```json
{
  "error": "Not Found",
  "message": "Document not found"
}
```

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Invalid request body or missing parameters |
| 401 | Missing or malformed Authorization header |
| 403 | Invalid/expired token or cross-tenant access attempt |
| 404 | Document not found or logically deleted |
| 500 | Internal server error (Lambda, DynamoDB, or KMS failure) |

---

## SNS Events

After successful operations, the infrastructure publishes events to the SNS topic. The MVP backend can subscribe to receive real-time notifications.

**Topic ARN:** Available in CloudFormation stack outputs as `SNSTopicArn`.

### UPLOADED
Published when document metadata is created successfully.
```json
{
  "event": "UPLOADED",
  "tenantId": "tenant_acme",
  "documentId": "doc_ABC123",
  "uploadedAt": "2024-03-15T14:30:00.000Z",
  "timestamp": "2024-03-15T14:30:00.000Z"
}
```

### ARCHIVED
Published when a document is automatically transitioned to Glacier Deep Archive after 365 days.
```json
{
  "event": "ARCHIVED",
  "tenantId": "tenant_acme",
  "documentId": "doc_ABC123",
  "archivedAt": "2025-03-15T00:00:00.000Z",
  "timestamp": "2025-03-15T00:00:00.000Z"
}
```

### ERROR
Published when any Lambda encounters a critical error.
```json
{
  "event": "ERROR",
  "tenantId": "tenant_acme",
  "documentId": "doc_ABC123",
  "errorMessage": "DynamoDB UpdateItem failed: ...",
  "timestamp": "2024-03-15T14:30:00.000Z"
}
```
