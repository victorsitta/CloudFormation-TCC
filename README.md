# DocSaaS Infrastructure

Serverless AWS infrastructure for a multi-tenant document management SaaS, provisioned entirely via AWS CloudFormation.

---

## Overview

This repository contains the AWS infrastructure layer of the DocSaaS platform. It provides secure document storage, retrieval, and lifecycle management for multiple tenant organizations through a serverless architecture.

The platform is developed across two independent teams:

| Team | Stack | Responsibility |
|------|-------|---------------|
| **MVP / Application** | React, Node.js, Supabase Auth, PostgreSQL | Frontend, business logic, authentication, account management |
| **Infrastructure** (this repo) | CloudFormation, Lambda, S3, DynamoDB, API Gateway, KMS, IAM, CloudWatch, SNS | Document storage, access control, archival, event notifications |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  MVP Application Layer                                       │
│  React (frontend) → Node.js/Express (backend) → Supabase    │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTPS + JWT
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  AWS Infrastructure Layer (this repository)                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Amazon API Gateway  (REST — stage: simulation)     │    │
│  │  POST /documents/upload-url                         │    │
│  │  GET  /documents/download-url/{documentId}          │    │
│  │  GET  /documents                                    │    │
│  │  DELETE /documents/{documentId}                     │    │
│  └───────────────┬──────────────────┬──────────────────┘    │
│                  │                  │                        │
│      ┌───────────▼──────┐  ┌────────▼─────────────┐        │
│      │ Lambda           │  │ Lambda               │        │
│      │ access-verifier  │  │ metadata-handler     │        │
│      │ (JWT + URLs)     │  │ (DynamoDB CRUD)      │        │
│      └────────┬─────────┘  └────────┬─────────────┘        │
│               │                     │                       │
│      ┌────────▼──────┐     ┌─────────▼──────────┐          │
│      │  AWS KMS CMK  │     │  Amazon DynamoDB    │          │
│      │  (encryption) │     │  (metadata)         │          │
│      └────────┬──────┘     └────────────────────┘          │
│               │                                             │
│      ┌────────▼────────────────────────────────┐           │
│      │  Amazon S3 Standard  (0–365 days)        │           │
│      │  {tenantId}/{documentId}/{filename}       │           │
│      └────────────────────┬────────────────────┘           │
│                  Lifecycle │ Policy (365 days)              │
│      ┌────────────────────▼────────────────────┐           │
│      │  Amazon S3 Glacier Deep Archive (365d+)  │           │
│      └────────────────────┬────────────────────┘           │
│                           │ S3 Event                       │
│                 ┌──────────▼──────────┐                    │
│                 │ Lambda              │──→ Amazon SNS       │
│                 │ archive-trigger     │    (ARCHIVED event) │
│                 └─────────────────────┘                    │
│                                                             │
│  Amazon CloudWatch Logs  ·  AWS IAM Roles                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Infrastructure Components

| Service | Resource | Purpose |
|---------|----------|---------|
| Amazon API Gateway | REST API — 4 routes | Single entry point for the MVP backend |
| AWS Lambda | `access-verifier` | Validates JWT and generates S3 pre-signed URLs |
| AWS Lambda | `metadata-handler` | DynamoDB CRUD — create, list, logical delete |
| AWS Lambda | `archive-trigger` | Updates DynamoDB after S3 → Glacier transition |
| Amazon S3 | `docsaas-standard-*` | Active document storage (0–365 days) |
| Amazon S3 | `docsaas-glacier-*` | Historical archive (365+ days, Glacier Deep Archive) |
| Amazon DynamoDB | `docsaas-documents-*` | Document metadata store |
| AWS KMS | Customer Managed Key | Encryption at rest for S3 and DynamoDB |
| AWS IAM | 3 Lambda roles | Least-privilege access control |
| Amazon CloudWatch | Log Group (30-day retention) | Structured JSON logs from all Lambda functions |
| Amazon SNS | Events topic | Document lifecycle notifications (UPLOADED, ARCHIVED, ERROR) |

---

## Repository Structure

```
.
├── main.yaml                        # Root template — orchestrates all nested stacks
│
├── templates/
│   ├── iam.yaml                     # Lambda IAM roles and policies
│   ├── monitoring.yaml              # CloudWatch Log Group + SNS Topic
│   ├── storage.yaml                 # KMS CMK + S3 Standard + S3 Glacier
│   ├── database.yaml                # DynamoDB table and GSI
│   ├── compute.yaml                 # Lambda functions
│   └── api.yaml                     # API Gateway REST API and routes
│
├── lambda/
│   ├── access-verifier/
│   │   ├── index.js                 # JWT validation + S3 pre-signed URL generation
│   │   ├── package.json
│   │   └── README.md
│   ├── metadata-handler/
│   │   ├── index.js                 # Document metadata CRUD + SNS events
│   │   ├── package.json
│   │   └── README.md
│   ├── archive-trigger/
│   │   ├── index.js                 # DynamoDB update on S3 → Glacier transition
│   │   ├── package.json
│   │   └── README.md
│   └── test-local.js                # Local test script (no AWS required)
│
├── docs/
│   ├── architecture.md              # Architecture Decision Records (ADR)
│   ├── api-contract.md              # API reference — endpoints, schemas, examples
│   ├── data-model.md                # DynamoDB schema, S3 key structure, data flows
│   ├── security.md                  # Security model, IAM roles, audit logging
│   └── simulation-guide.md          # Deployment guide and local testing instructions
│
├── .env.example                     # Environment variable reference for the MVP team
└── README.md
```

---

## CloudFormation Stack Dependencies

The `main.yaml` root template creates nested stacks in the following order based on output dependencies:

```
main.yaml
├── 1. iam.yaml         ← no dependencies
├── 2. monitoring.yaml  ← no dependencies
├── 3. storage.yaml     ← outputs: KMSKeyArn, S3 bucket names
├── 4. database.yaml    ← requires: KMSKeyArn (from storage)
├── 5. compute.yaml     ← requires: all IAM roles, S3 names, DynamoDB name, SNS ARN
└── 6. api.yaml         ← requires: Lambda ARNs (from compute)
```

---

## CloudFormation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `Environment` | String | `simulation` | Deployment environment — used as resource name suffix |
| `ProjectName` | String | `docsaas` | Project prefix applied to all resource names |
| `RetentionDays` | Number | `30` | CloudWatch log retention period in days |
| `ArchiveDays` | Number | `365` | Days until S3 objects transition to Glacier Deep Archive |
| `TemplatesBucketName` | String | `docsaas-cfn-templates` | S3 bucket hosting the nested stack templates |

---

## CloudFormation Outputs

| Output Key | Description |
|-----------|-------------|
| `APIGatewayURL` | Base URL for the MVP backend integration |
| `SNSTopicArn` | ARN for subscribing to document lifecycle events |
| `S3StandardBucketName` | Active storage bucket name |
| `S3GlacierBucketName` | Archive storage bucket name |
| `DynamoDBTableName` | Document metadata table name |
| `KMSKeyArn` | Encryption key ARN |

---

## Quick Start

### Validate templates (no AWS account required)

```bash
cfn-lint templates/iam.yaml \
         templates/monitoring.yaml \
         templates/storage.yaml \
         templates/database.yaml \
         templates/compute.yaml \
         templates/api.yaml \
         main.yaml
```

### Run local Lambda tests (no AWS account required)

```bash
node lambda/test-local.js
```

### Deploy to AWS

```bash
# 1. Create a bucket to host nested stack templates
aws s3 mb s3://docsaas-cfn-templates-{your-name}
aws s3 cp templates/ s3://docsaas-cfn-templates-{your-name}/templates/ --recursive

# 2. Deploy the stack
aws cloudformation create-stack \
  --stack-name docsaas-simulation \
  --template-body file://main.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=Environment,ParameterValue=simulation \
    ParameterKey=ProjectName,ParameterValue=docsaas \
    ParameterKey=TemplatesBucketName,ParameterValue=docsaas-cfn-templates-{your-name}

# 3. Retrieve stack outputs after CREATE_COMPLETE
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs'

# 4. Tear down (prevents ongoing KMS charges)
aws cloudformation delete-stack --stack-name docsaas-simulation
```

---

## Multi-Tenant Isolation

Documents are stored with an explicit tenant-scoped key prefix in S3:

```
{tenantId}/{documentId}/{filename}

tenant_acme/doc_ABC123/contract-2024.pdf
tenant_xyz/doc_DEF456/proposal.docx
```

The `access-verifier` Lambda extracts the `tenantId` from the JWT and scopes all generated pre-signed URLs to that tenant's prefix. Cross-tenant access is rejected at the application layer (HTTP 403) and enforced by IAM role conditions at the AWS layer.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/architecture.md`](docs/architecture.md) | Architecture Decision Records (ADR) |
| [`docs/api-contract.md`](docs/api-contract.md) | Full API reference with request/response schemas |
| [`docs/data-model.md`](docs/data-model.md) | DynamoDB schema, S3 structure, data flow diagrams |
| [`docs/security.md`](docs/security.md) | Security model, IAM roles, audit logging |
| [`docs/simulation-guide.md`](docs/simulation-guide.md) | Deployment guide and local testing instructions |
