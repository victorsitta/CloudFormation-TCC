<div align="center">

# 🗂️ DocSaaS Infrastructure

**Serverless AWS infrastructure for a multi-tenant document management SaaS**

[![CloudFormation](https://img.shields.io/badge/AWS-CloudFormation-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com/cloudformation/)
[![Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?style=for-the-badge&logo=aws-lambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

*Trabalho de Conclusão de Curso — Infraestrutura AWS provisionada via IaC*

</div>

---

## 📌 Overview

This repository contains the **AWS infrastructure layer** of the DocSaaS platform — a multi-tenant document management SaaS. The entire infrastructure is defined as code using AWS CloudFormation and follows a fully serverless architecture.

> The platform is split across two independent teams. This repository covers the **infrastructure side only**.

| Team | Stack | Scope |
|------|-------|-------|
| **MVP / Application** | React · Node.js · Supabase | Frontend, business rules, authentication |
| **Infrastructure** *(this repo)* | CloudFormation · Lambda · S3 · DynamoDB | Storage, access control, archival, notifications |

---

## 🏗️ Architecture

```
╔══════════════════════════════════════════════════════════════╗
║              MVP Application Layer                           ║
║   React  ──▶  Node.js / Express  ──▶  Supabase Auth + DB    ║
╚══════════════════════════╦═══════════════════════════════════╝
                           ║  HTTPS · JWT
                           ▼
╔══════════════════════════════════════════════════════════════╗
║              AWS Infrastructure Layer  (this repo)           ║
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │            Amazon API Gateway  (REST)                 │   ║
║  │  POST /documents/upload-url                           │   ║
║  │  GET  /documents/download-url/{id}                    │   ║
║  │  GET  /documents                                      │   ║
║  │  DELETE /documents/{id}                               │   ║
║  └────────────┬─────────────────────┬────────────────────┘   ║
║               │                     │                        ║
║   ┌───────────▼──────────┐ ┌────────▼──────────────┐        ║
║   │  λ access-verifier   │ │  λ metadata-handler   │        ║
║   │  JWT · Pre-signed URL│ │  DynamoDB CRUD · SNS  │        ║
║   └───────────┬──────────┘ └────────┬──────────────┘        ║
║               │                     │                        ║
║   ┌───────────▼──────┐   ┌──────────▼──────────────┐        ║
║   │   AWS KMS  (CMK) │   │   Amazon DynamoDB        │        ║
║   │   Encryption     │   │   Document Metadata      │        ║
║   └───────────┬──────┘   └─────────────────────────┘        ║
║               │                                              ║
║   ┌───────────▼──────────────────────────────────────┐      ║
║   │   Amazon S3 Standard   (0 – 365 days)             │      ║
║   │   {tenantId}/{documentId}/{filename}               │      ║
║   └───────────────────────┬──────────────────────────┘      ║
║                 Lifecycle  │  Policy  →  365 days            ║
║   ┌───────────────────────▼──────────────────────────┐      ║
║   │   Amazon S3 Glacier Deep Archive  (365d+)         │      ║
║   └───────────────────────┬──────────────────────────┘      ║
║                     S3 Event │                               ║
║              ┌──────────────▼────────────┐                  ║
║              │  λ archive-trigger        │──▶  Amazon SNS   ║
║              │  DynamoDB · SNS           │     (ARCHIVED)   ║
║              └───────────────────────────┘                  ║
║                                                              ║
║   Amazon CloudWatch Logs  ·  AWS IAM Roles                  ║
╚══════════════════════════════════════════════════════════════╝
```

---

## ⚙️ Infrastructure Components

| Service | Resource | Purpose |
|---------|----------|---------|
| 🌐 **API Gateway** | REST API · 4 routes | Single entry point for the MVP backend |
| ⚡ **Lambda** | `access-verifier` | JWT validation + S3 pre-signed URL generation |
| ⚡ **Lambda** | `metadata-handler` | Document metadata CRUD + SNS event publishing |
| ⚡ **Lambda** | `archive-trigger` | Updates DynamoDB on S3 → Glacier transition |
| 🗄️ **S3 Standard** | `docsaas-standard-*` | Active document storage (0–365 days) |
| 🧊 **S3 Glacier** | `docsaas-glacier-*` | Long-term archive (365+ days, ~95% cheaper) |
| 📊 **DynamoDB** | `docsaas-documents-*` | Document metadata (filename, owner, location) |
| 🔐 **KMS** | Customer Managed Key | Encryption at rest — S3 + DynamoDB |
| 🛡️ **IAM** | 3 Lambda roles | Least-privilege access control per function |
| 📋 **CloudWatch** | Log Group (30d) | Structured JSON logs from all Lambda functions |
| 📣 **SNS** | Events topic | Lifecycle notifications — UPLOADED · ARCHIVED · ERROR |

---

## 📁 Repository Structure

```
.
├── 📄 main.yaml                    # Root template — orchestrates all nested stacks
│
├── 📂 templates/
│   ├── iam.yaml                    # Lambda IAM roles and policies          [stack 1]
│   ├── monitoring.yaml             # CloudWatch Log Group + SNS Topic        [stack 2]
│   ├── storage.yaml                # KMS CMK + S3 Standard + S3 Glacier      [stack 3]
│   ├── database.yaml               # DynamoDB table and GSI                  [stack 4]
│   ├── compute.yaml                # Lambda functions (Node.js 24.x)         [stack 5]
│   └── api.yaml                    # API Gateway REST API and routes         [stack 6]
│
├── 📂 lambda/
│   ├── access-verifier/
│   │   ├── index.js                # JWT validation + pre-signed URL logic
│   │   ├── package.json
│   │   └── README.md
│   ├── metadata-handler/
│   │   ├── index.js                # DynamoDB CRUD + SNS event publishing
│   │   ├── package.json
│   │   └── README.md
│   ├── archive-trigger/
│   │   ├── index.js                # storageClass update on Glacier transition
│   │   ├── package.json
│   │   └── README.md
│   └── test-local.js               # Local test script — no AWS required
│
├── 📂 docs/
│   ├── architecture.md             # Architecture Decision Records (ADR)
│   ├── api-contract.md             # Full API reference
│   ├── data-model.md               # DynamoDB schema + S3 structure
│   ├── security.md                 # Security model + IAM + audit logging
│   └── simulation-guide.md         # Deployment guide + local testing
│
├── .env.example                    # Environment variable reference (MVP team)
└── README.md
```

---

## 🔗 Stack Dependency Chain

The `main.yaml` root template provisions nested stacks in strict dependency order:

```
main.yaml
 │
 ├─▶ [1] iam.yaml          no upstream dependencies
 ├─▶ [2] monitoring.yaml   no upstream dependencies
 ├─▶ [3] storage.yaml      outputs → KMSKeyArn · S3BucketNames
 ├─▶ [4] database.yaml     requires → KMSKeyArn
 ├─▶ [5] compute.yaml      requires → IAM Roles · S3 · DynamoDB · SNS · CloudWatch
 └─▶ [6] api.yaml          requires → Lambda ARNs
```

---

## 🚀 Quick Start

### Prerequisites

```bash
# Python + cfn-lint for template validation
pip install cfn-lint

# Node.js 18+ for local Lambda tests
node --version
```

### 1 — Validate all templates *(no AWS account required)*

```bash
cfn-lint templates/iam.yaml \
         templates/monitoring.yaml \
         templates/storage.yaml \
         templates/database.yaml \
         templates/compute.yaml \
         templates/api.yaml \
         main.yaml
```

### 2 — Run local Lambda tests *(no AWS account required)*

```bash
node lambda/test-local.js
```

### 3 — Deploy to AWS *(Free Tier eligible)*

```bash
# Create a bucket to host nested stack templates
aws s3 mb s3://docsaas-cfn-templates-{your-name}
aws s3 cp templates/ s3://docsaas-cfn-templates-{your-name}/templates/ --recursive

# Deploy the full stack
aws cloudformation create-stack \
  --stack-name docsaas-simulation \
  --template-body file://main.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=Environment,ParameterValue=simulation \
    ParameterKey=ProjectName,ParameterValue=docsaas \
    ParameterKey=TemplatesBucketName,ParameterValue=docsaas-cfn-templates-{your-name}

# Retrieve outputs after CREATE_COMPLETE (~3–5 min)
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs'

# Tear down to avoid ongoing KMS charges
aws cloudformation delete-stack --stack-name docsaas-simulation
```

---

## 🔒 Multi-Tenant Isolation

Every document is stored with an explicit tenant-scoped S3 key prefix:

```
{tenantId}/{documentId}/{filename}

  tenant_acme/doc_ABC123/contract-2024.pdf     ← Acme only
  tenant_xyz/doc_DEF456/proposal.docx          ← XYZ only
```

The `access-verifier` Lambda extracts `tenantId` from the JWT and scopes all pre-signed URLs to that tenant's prefix. Cross-tenant access is rejected at the application layer (`HTTP 403`) and enforced independently by IAM role conditions at the AWS layer.

---

## 📊 CloudFormation Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `Environment` | `simulation` | Deployment stage — appended to all resource names |
| `ProjectName` | `docsaas` | Project prefix applied to all resource names |
| `RetentionDays` | `30` | CloudWatch log retention period (days) |
| `ArchiveDays` | `365` | Days until S3 objects transition to Glacier |
| `TemplatesBucketName` | `docsaas-cfn-templates` | S3 bucket hosting nested stack templates |

---

## 💰 Cost Estimate

| Service | Free Tier | Demo Cost |
|---------|-----------|-----------|
| Lambda | 1M requests/month | **$0.00** |
| API Gateway | 1M calls/month | **$0.00** |
| DynamoDB | 25 GB + 25 WCU/RCU | **$0.00** |
| S3 Standard | 5 GB | **$0.00** |
| CloudWatch | 5 GB logs | **$0.00** |
| SNS | 1M publishes/month | **$0.00** |
| **KMS CMK** | — | **~$1.00/month** |

> ⚠️ The KMS Customer Managed Key is the only resource with a fixed monthly cost. Run `aws cloudformation delete-stack` after the demo to stop all charges.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [`docs/architecture.md`](docs/architecture.md) | Architecture Decision Records (ADR) — rationale behind every design choice |
| [`docs/api-contract.md`](docs/api-contract.md) | Full API reference — endpoints, request/response schemas, SNS events |
| [`docs/data-model.md`](docs/data-model.md) | DynamoDB schema, S3 key structure, data flow diagrams |
| [`docs/security.md`](docs/security.md) | Security model, IAM roles, encryption, audit logging |
| [`docs/simulation-guide.md`](docs/simulation-guide.md) | Step-by-step deployment and local testing guide |

---

<div align="center">

*Built with ❤️ for academic purposes — TCC · AWS CloudFormation · Serverless*

</div>
