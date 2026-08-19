# Architecture Decision Records (ADR)

This document captures the key architectural decisions made for the DocSaaS infrastructure, including the context, rationale, and trade-offs considered for each decision.

---

## ADR-001: Serverless Architecture (AWS Lambda)

**Status:** Accepted

**Context:**
The system requires intermittent compute for document access validation and metadata management. No persistent server state is needed.

**Decision:**
Use AWS Lambda for all compute instead of EC2 instances or ECS containers.

**Rationale:**
- Zero cost when idle — no requests, no charges
- Auto-scales with demand without capacity planning
- No server management overhead
- Aligns with the serverless storage and database layers (S3, DynamoDB)

**Trade-offs:**
- Cold start latency on first invocation (acceptable for this use case)
- 15-minute execution limit (not a concern for pre-signed URL generation)

---

## ADR-002: Modular Nested Stacks (CloudFormation)

**Status:** Accepted

**Context:**
A single CloudFormation template has a hard limit of 200 resources. The full infrastructure requires resources across multiple domains (IAM, storage, database, compute, networking, observability).

**Decision:**
Split the infrastructure into 6 domain-specific templates orchestrated by a root `main.yaml` via nested stacks.

**Template dependency order:**
```
main.yaml
├── iam.yaml         (no dependencies)
├── monitoring.yaml  (no dependencies)
├── storage.yaml     (depends on: iam.yaml)
├── database.yaml    (depends on: storage.yaml → KMSKeyArn)
├── compute.yaml     (depends on: all above)
└── api.yaml         (depends on: compute.yaml → Lambda ARNs)
```

**Rationale:**
- Avoids CloudFormation resource limits
- Each domain can be updated independently
- Follows the separation of concerns principle
- Enables parallel creation of independent stacks

---

## ADR-003: Multi-Tenant Isolation via S3 Key Prefix

**Status:** Accepted

**Context:**
Multiple tenants share the same S3 buckets. Data isolation must be enforced at the storage level.

**Decision:**
Use a structured key prefix `{tenantId}/{documentId}/{filename}` for all S3 objects.

**Rationale:**
- IAM policies can use `s3:prefix` conditions to restrict per-tenant access
- No need for per-tenant buckets (cost and complexity overhead)
- Enables straightforward auditability — ownership is explicit in the key path

**Example:**
```
tenant_acme/doc_ABC123/contract-2024.pdf
tenant_xyz/doc_DEF456/proposal.docx
```

---

## ADR-004: Pre-signed URLs for File Transfer

**Status:** Accepted

**Context:**
Files need to be transferred between clients and S3. Two approaches were considered: Lambda proxy (Lambda receives and forwards the file) vs. pre-signed URLs (Lambda issues a temporary URL, client transfers directly).

**Decision:**
Lambda generates pre-signed URLs; clients upload/download directly to/from S3.

**Rationale:**
- Lambda is not a bottleneck for large file transfers
- Reduces Lambda invocation duration (cost)
- Pre-signed URLs expire in 900 seconds — time-limited and scoped to the tenant prefix
- Industry-standard pattern for S3 access delegation

**Flow:**
```
Client → API Gateway → Lambda (generates URL) → Client → S3 (direct transfer)
```

---

## ADR-005: DynamoDB for Document Metadata

**Status:** Accepted

**Context:**
Document metadata (filename, size, owner, storage location) requires fast lookups by `documentId` and efficient queries by `tenantId`.

**Decision:**
Use Amazon DynamoDB with a composite primary key (`documentId` + `tenantId`) and a Global Secondary Index (GSI) for tenant-scoped queries.

**Rationale:**
- Supabase PostgreSQL (managed by the MVP team) already handles account, plan, and permission data — DynamoDB stays within the AWS infrastructure boundary
- Serverless by nature — no server provisioning
- Single-digit millisecond read/write performance
- Composite key provides direct lookup by document and natural tenant isolation

**Key design:**
```
Primary Key:  documentId (partition) + tenantId (sort)
GSI:          TenantIndex → tenantId (partition) + uploadedAt (sort)
```

---

## ADR-006: Two Separate S3 Buckets (Standard + Glacier)

**Status:** Accepted

**Context:**
Documents older than 365 days should be moved to low-cost archival storage. Two approaches: single bucket with storage class transitions vs. two separate buckets.

**Decision:**
Use two separate S3 buckets — one for Standard, one for Glacier Deep Archive.

**Rationale:**
- Explicit separation makes the archival boundary clear in the IaC code
- Allows different IAM policies per bucket if needed
- Makes the cost differentiation visible in the CloudFormation template
- S3 Lifecycle Policy on the Standard bucket handles automatic transition

**Note:** In a production system, a single bucket with lifecycle transitions would be sufficient. The two-bucket approach is a deliberate design choice for clarity.

---

## ADR-007: Amazon SNS for Event Notifications

**Status:** Accepted

**Context:**
The MVP backend needs to be notified when documents are uploaded, archived, or when errors occur.

**Decision:**
Use a single Amazon SNS topic for all document lifecycle events.

**Rationale:**
- Simple to provision in CloudFormation
- Supports fan-out to multiple subscribers (MVP backend, email, etc.)
- Appropriate for point-in-time event notifications (not persistent message queues)
- EventBridge would add unnecessary complexity for this use case

**Events published:**
- `UPLOADED` — document metadata created successfully
- `ARCHIVED` — document transitioned to Glacier Deep Archive
- `ERROR` — critical error during any Lambda operation

---

## ADR-008: KMS Customer Managed Key (CMK)

**Status:** Accepted

**Context:**
All data at rest in S3 and DynamoDB must be encrypted. Two options: AWS Managed Keys (free, no control) vs. Customer Managed Keys (paid, full control).

**Decision:**
Use a KMS Customer Managed Key (CMK) for all encryption at rest.

**Rationale:**
- Full control over the key policy — restricts usage to specific services and Lambda roles
- Automatic annual key rotation enabled
- CMK is the recommended approach for sensitive data in multi-tenant environments
- Key ARN is exported as a CloudFormation output for cross-stack reference

**Cost:** $1.00/month per CMK + $0.03 per 10,000 API calls.

---

## Known Simplifications (Academic Context)

The following production-grade features were intentionally omitted to keep the project scope appropriate for an academic TCC:

| Feature | TCC Approach | Production Approach |
|---------|-------------|-------------------|
| JWT validation | Decode only (no signature verification) | Verify signature with Supabase public key |
| Secrets management | Environment variables | AWS Secrets Manager |
| DDoS protection | None | AWS WAF on API Gateway |
| Network isolation | Lambda outside VPC | Lambda in private VPC with VPC Endpoints |
| Observability | CloudWatch logs only | AWS X-Ray distributed tracing |
| Multi-region | Single region | Active-active multi-region |
