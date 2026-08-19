# Deployment & Simulation Guide

---

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| AWS CLI | Deploy and manage the CloudFormation stack | [docs.aws.amazon.com/cli](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) |
| cfn-lint | Static validation of CloudFormation templates | `pip install cfn-lint` |
| Node.js 18+ | Run local Lambda tests | [nodejs.org](https://nodejs.org) |

---

## Option 1 — Static Validation (No AWS Account Required)

Validates template syntax, resource properties, and cross-stack references without any AWS credentials.

```bash
# Validate all templates
cfn-lint templates/iam.yaml \
         templates/monitoring.yaml \
         templates/storage.yaml \
         templates/database.yaml \
         templates/compute.yaml \
         templates/api.yaml \
         main.yaml

# Expected output: no errors, no warnings
```

---

## Option 2 — Local Lambda Tests (No AWS Account Required)

Tests JWT decoding logic, S3 key construction, and routing without any AWS infrastructure.

```bash
node lambda/test-local.js
```

**Expected output:**
```
============================================================
  DocSaaS Infra TCC — Local Lambda Tests
============================================================

📋 TEST 1 — JWT Decoding
JWT payload decoded: { sub: 'user_123', tenantId: 'tenant_acme_corp', ... }
✅ tenantId: tenant_acme_corp
✅ userId: user_123

📋 TEST 2 — Upload event structure
S3 Key generated: tenant_acme_corp/doc_SIMULATED/contract-2024.pdf
✅ Valid structure

📋 TEST 3 — S3 event for archive-trigger
tenantId extracted: tenant_acme_corp
documentId extracted: doc_01HK2XABCDEF
✅ ID extraction from S3 Key valid

📋 TEST 4 — Invalid JWT (no Bearer prefix)
✅ Would return HTTP 401

============================================================
  ✅ All tests passed
============================================================
```

---

## Option 3 — Full Deploy (AWS Account — Free Tier)

Deploys the complete infrastructure to AWS. Estimated cost: ~$1.00/month (KMS key only). Delete the stack immediately after the presentation to avoid charges.

### Step 1 — Configure AWS CLI

```bash
aws configure
# AWS Access Key ID: [your key]
# AWS Secret Access Key: [your secret]
# Default region name: us-east-1
# Default output format: json
```

### Step 2 — Create a bucket for nested stack templates

CloudFormation nested stacks require templates to be hosted in S3.

```bash
aws s3 mb s3://docsaas-cfn-templates-{your-name}
aws s3 cp templates/ s3://docsaas-cfn-templates-{your-name}/templates/ --recursive
```

### Step 3 — Deploy the stack

```bash
aws cloudformation create-stack \
  --stack-name docsaas-simulation \
  --template-body file://main.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=Environment,ParameterValue=simulation \
    ParameterKey=ProjectName,ParameterValue=docsaas \
    ParameterKey=TemplatesBucketName,ParameterValue=docsaas-cfn-templates-{your-name}
```

### Step 4 — Monitor deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].StackStatus'

# Watch for CREATE_COMPLETE (takes ~3-5 minutes)
```

### Step 5 — Retrieve stack outputs

```bash
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs'
```

Expected outputs:

| Output Key | Description |
|-----------|-------------|
| `APIGatewayURL` | Base URL for the MVP backend to integrate |
| `SNSTopicArn` | ARN for subscribing to document events |
| `S3StandardBucketName` | Active storage bucket name |
| `S3GlacierBucketName` | Archive storage bucket name |
| `DynamoDBTableName` | Metadata table name |
| `KMSKeyArn` | Encryption key ARN |

### Step 6 — Test the API

```bash
API_URL=$(aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs[?OutputKey==`APIGatewayURL`].OutputValue' \
  --output text)

# Mock JWT (decode-only validation for simulation)
MOCK_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInRlbmFudElkIjoidGVuYW50X2FjbWUiLCJpYXQiOjE3MDAwMDAwMDB9.mock"

# Request upload URL
curl -X POST "$API_URL/documents/upload-url" \
  -H "Authorization: Bearer $MOCK_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.pdf","contentType":"application/pdf","sizeBytes":1024}'

# List documents
curl -X GET "$API_URL/documents" \
  -H "Authorization: Bearer $MOCK_JWT"
```

### Step 7 — Teardown (important — prevents ongoing charges)

```bash
aws cloudformation delete-stack --stack-name docsaas-simulation
aws s3 rb s3://docsaas-cfn-templates-{your-name} --force
```

---

## Cost Estimate

| Service | Free Tier | Estimated Cost (demo) |
|---------|-----------|----------------------|
| Lambda | 1M requests/month | $0.00 |
| API Gateway | 1M calls/month | $0.00 |
| DynamoDB | 25 GB + 25 WCU/RCU | $0.00 |
| S3 Standard | 5 GB | $0.00 |
| CloudWatch | 5 GB logs | $0.00 |
| SNS | 1M publishes/month | $0.00 |
| **KMS** | — | **~$1.00/month** |

**Total: ~$1.00** — only the KMS Customer Managed Key has a fixed monthly cost. Delete the stack after the presentation to stop all charges.
