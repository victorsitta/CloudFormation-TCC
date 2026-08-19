# Data Model

---

## DynamoDB — Documents Table

**Table name:** `docsaas-documents-{environment}`

**Billing mode:** PAY_PER_REQUEST (on-demand)

**Encryption:** AWS KMS Customer Managed Key (CMK)

**Point-in-Time Recovery:** Enabled (35-day window)

### Primary Key

| Attribute | Type | Role |
|-----------|------|------|
| `documentId` | String | Partition Key |
| `tenantId` | String | Sort Key |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `documentId` | String | Unique document identifier (e.g. `doc_ABC123`) |
| `tenantId` | String | Tenant that owns the document |
| `userId` | String | User who uploaded the document |
| `filename` | String | Original filename |
| `contentType` | String | MIME type (e.g. `application/pdf`) |
| `sizeBytes` | Number | File size in bytes |
| `uploadedAt` | String | ISO 8601 upload timestamp |
| `storageClass` | String | `STANDARD` or `GLACIER` |
| `s3Key` | String | Full S3 object key: `{tenantId}/{documentId}/{filename}` |
| `deleted` | Boolean | Logical deletion flag |
| `deletedAt` | String | ISO 8601 deletion timestamp (set on delete) |
| `deletedBy` | String | userId who performed the deletion (set on delete) |
| `archivedAt` | String | ISO 8601 archival timestamp (set when moved to Glacier) |

### Item Example

```json
{
  "documentId": "doc_ABC123",
  "tenantId": "tenant_acme_corp",
  "userId": "user_xyz789",
  "filename": "contract-2024.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 1048576,
  "uploadedAt": "2024-03-15T14:30:00.000Z",
  "storageClass": "STANDARD",
  "s3Key": "tenant_acme_corp/doc_ABC123/contract-2024.pdf",
  "deleted": false
}
```

### Global Secondary Index — TenantIndex

Enables efficient queries to list all documents belonging to a tenant.

| Attribute | Role |
|-----------|------|
| `tenantId` | Partition Key |
| `uploadedAt` | Sort Key |

**Projection:** ALL (includes all attributes)

**Query pattern:** `tenantId = :tenantId AND deleted = false`, sorted by `uploadedAt` descending.

### Access Patterns

| Operation | DynamoDB Action | Key Used |
|-----------|----------------|----------|
| Get document metadata | `GetItem` | `documentId` + `tenantId` |
| List tenant documents | `Query` on TenantIndex | `tenantId` |
| Create document metadata | `PutItem` | Full item |
| Logical delete | `UpdateItem` | `documentId` + `tenantId` |
| Update storage class to GLACIER | `UpdateItem` | `documentId` + `tenantId` |

---

## S3 — Object Storage

### Standard Bucket

**Name:** `docsaas-standard-{environment}-{accountId}`

**Purpose:** Active document storage (0–365 days)

**Configuration:**
- Encryption: SSE-KMS with CMK
- Versioning: Enabled
- Block Public Access: All options enabled
- Lifecycle Policy: Transition to Glacier Deep Archive after 365 days

**Key structure:**
```
{tenantId}/{documentId}/{filename}
```

**Example:**
```
tenant_acme_corp/
  doc_ABC123/
    contract-2024.pdf
  doc_DEF456/
    annual-report.pdf

tenant_startup_xyz/
  doc_GHI789/
    proposal.docx
```

### Glacier Bucket

**Name:** `docsaas-glacier-{environment}-{accountId}`

**Purpose:** Historical document archival (365+ days)

**Configuration:**
- Encryption: SSE-KMS with the same CMK as Standard bucket
- Block Public Access: All options enabled
- Storage class: Glacier Deep Archive

**Key structure:** Identical to Standard bucket (preserves path consistency)

> Documents in Glacier Deep Archive require a restore request before they can be downloaded. Restore time is 12–48 hours. This operation is outside the scope of this project.

---

## KMS — Encryption Key

**Key alias:** `alias/docsaas-key-{environment}`

**Key spec:** SYMMETRIC_DEFAULT (AES-256)

**Key usage:** ENCRYPT_DECRYPT

**Rotation:** Annual automatic rotation enabled

**Used by:**
- S3 Standard bucket — server-side encryption (SSE-KMS)
- S3 Glacier bucket — server-side encryption (SSE-KMS)
- DynamoDB table — encryption at rest

**Key policy principals:**
- AWS account root (administrative access)
- S3 service (`s3.amazonaws.com`) — via `kms:ViaService` condition
- DynamoDB service (`dynamodb.amazonaws.com`) — via `kms:ViaService` condition

---

## Data Flow

### Upload Flow

```
1. MVP Backend → POST /documents/upload-url
   Payload: { filename, contentType, sizeBytes }

2. Lambda access-verifier:
   - Decodes JWT → extracts tenantId, userId
   - Generates documentId
   - Constructs s3Key = {tenantId}/{documentId}/{filename}
   - Generates S3 pre-signed PUT URL (TTL: 900s)
   - Returns: { uploadUrl, documentId, s3Key, expiresIn }

3. MVP Backend → PUT {uploadUrl} (direct to S3, binary body)

4. MVP Backend → POST /documents
   Payload: { documentId, filename, contentType, sizeBytes, s3Key }

5. Lambda metadata-handler:
   - Creates DynamoDB item: storageClass=STANDARD, deleted=false
   - Publishes UPLOADED event to SNS
```

### Download Flow

```
1. MVP Backend → GET /documents/download-url/{documentId}

2. Lambda access-verifier:
   - Decodes JWT → extracts tenantId
   - Queries DynamoDB: GetItem by documentId + tenantId
   - Validates tenant ownership (tenant mismatch check)
   - Checks storageClass:
     - STANDARD → generates S3 pre-signed GET URL (TTL: 900s)
     - GLACIER  → returns { downloadUrl: null, restoreStatus: REQUIRED }
```

### Archival Flow (automatic)

```
1. S3 Lifecycle Policy detects objects older than 365 days
2. S3 transitions objects to Glacier Deep Archive automatically

3. S3 triggers Lambda archive-trigger with event:
   { s3.bucket.name, s3.object.key }

4. Lambda archive-trigger:
   - Extracts tenantId, documentId from s3Key
   - DynamoDB UpdateItem: storageClass=GLACIER, archivedAt=now
   - Publishes ARCHIVED event to SNS
```
