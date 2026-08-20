<div align="center">

# 🗂️ DocSaaS — Infraestrutura AWS

**Infraestrutura serverless na AWS para um SaaS de gestão de documentos multi-tenant**

[![CloudFormation](https://img.shields.io/badge/AWS-CloudFormation-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com/cloudformation/)
[![Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?style=for-the-badge&logo=aws-lambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/Licença-MIT-blue?style=for-the-badge)](LICENSE)

*Trabalho de Conclusão de Curso — Infraestrutura AWS provisionada via IaC (CloudFormation)*

</div>

---

## 📌 Visão Geral

Este repositório contém a **camada de infraestrutura AWS** da plataforma DocSaaS — um SaaS de gestão de documentos multi-tenant. Toda a infraestrutura é definida como código usando AWS CloudFormation e segue uma arquitetura completamente serverless.

> A plataforma é desenvolvida por duas equipes independentes. Este repositório cobre **apenas a camada de infraestrutura**.

| Equipe | Stack | Responsabilidade |
|--------|-------|-----------------|
| **MVP / Aplicação** | React · Node.js · Supabase | Frontend, regras de negócio, autenticação |
| **Infraestrutura** *(este repo)* | CloudFormation · Lambda · S3 · DynamoDB | Armazenamento, controle de acesso, arquivamento, notificações |

---

## 🏗️ Arquitetura

```
╔══════════════════════════════════════════════════════════════╗
║              Camada MVP / Aplicação                          ║
║   React  ──▶  Node.js / Express  ──▶  Supabase Auth + DB    ║
╚══════════════════════════╦═══════════════════════════════════╝
                           ║  HTTPS · JWT
                           ▼
╔══════════════════════════════════════════════════════════════╗
║         Camada de Infraestrutura AWS  (este repositório)     ║
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │          Amazon API Gateway  (REST)                   │   ║
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
║   │   Criptografia   │   │   Metadados              │        ║
║   └───────────┬──────┘   └─────────────────────────┘        ║
║               │                                              ║
║   ┌───────────▼──────────────────────────────────────┐      ║
║   │   Amazon S3 Standard   (0 – 365 dias)             │      ║
║   │   {tenantId}/{documentId}/{filename}               │      ║
║   └───────────────────────┬──────────────────────────┘      ║
║              Lifecycle Policy → 365 dias                     ║
║   ┌───────────────────────▼──────────────────────────┐      ║
║   │   Amazon S3 Glacier Deep Archive  (365d+)         │      ║
║   └───────────────────────┬──────────────────────────┘      ║
║                   Evento S3 │                                ║
║              ┌──────────────▼────────────┐                  ║
║              │  λ archive-trigger        │──▶  Amazon SNS   ║
║              │  DynamoDB · SNS           │    (ARCHIVED)    ║
║              └───────────────────────────┘                  ║
║                                                              ║
║   Amazon CloudWatch Logs  ·  AWS IAM Roles                  ║
╚══════════════════════════════════════════════════════════════╝
```

---

## ⚙️ Componentes de Infraestrutura

| Serviço | Recurso | Finalidade |
|---------|---------|-----------|
| 🌐 **API Gateway** | REST API · 4 rotas | Ponto de entrada para o backend MVP |
| ⚡ **Lambda** | `access-verifier` | Validação de JWT + geração de Pre-signed URLs |
| ⚡ **Lambda** | `metadata-handler` | CRUD de metadados no DynamoDB + eventos SNS |
| ⚡ **Lambda** | `archive-trigger` | Atualiza DynamoDB após transição S3 → Glacier |
| 🗄️ **S3 Standard** | `docsaas-standard-*` | Armazenamento ativo de documentos (0–365 dias) |
| 🧊 **S3 Glacier** | `docsaas-glacier-*` | Arquivo histórico (365+ dias, ~95% mais barato) |
| 📊 **DynamoDB** | `docsaas-documents-*` | Metadados dos documentos (nome, dono, localização) |
| 🔐 **KMS** | Customer Managed Key | Criptografia em repouso — S3 + DynamoDB |
| 🛡️ **IAM** | 3 Roles Lambda | Controle de acesso com menor privilégio por função |
| 📋 **CloudWatch** | Log Group (30 dias) | Logs JSON estruturados de todas as funções Lambda |
| 📣 **SNS** | Tópico de eventos | Notificações — UPLOADED · ARCHIVED · ERROR |

---

## 📁 Estrutura do Repositório

```
.
├── 📄 main.yaml                    # Template raiz — orquestra todas as nested stacks
│
├── 📂 templates/
│   ├── iam.yaml                    # Roles e políticas IAM das Lambdas          [stack 1]
│   ├── monitoring.yaml             # CloudWatch Log Group + SNS Topic            [stack 2]
│   ├── storage.yaml                # KMS CMK + S3 Standard + S3 Glacier          [stack 3]
│   ├── database.yaml               # Tabela DynamoDB e GSI                       [stack 4]
│   ├── compute.yaml                # Funções Lambda (Node.js 24.x)               [stack 5]
│   └── api.yaml                    # API Gateway REST e rotas                    [stack 6]
│
├── 📂 lambda/
│   ├── access-verifier/
│   │   ├── index.js                # Validação JWT + lógica de Pre-signed URL
│   │   ├── package.json
│   │   └── README.md
│   ├── metadata-handler/
│   │   ├── index.js                # CRUD DynamoDB + publicação de eventos SNS
│   │   ├── package.json
│   │   └── README.md
│   ├── archive-trigger/
│   │   ├── index.js                # Atualização de storageClass na transição Glacier
│   │   ├── package.json
│   │   └── README.md
│   └── test-local.js               # Script de testes locais — sem AWS necessário
│
├── 📂 docs/
│   ├── architecture.md             # Architecture Decision Records (ADR)
│   ├── api-contract.md             # Referência completa da API
│   ├── data-model.md               # Schema DynamoDB + estrutura S3
│   ├── security.md                 # Modelo de segurança + IAM + auditoria
│   └── simulation-guide.md         # Guia de deploy e testes locais
│
├── .env.example                    # Referência de variáveis de ambiente (equipe MVP)
└── README.md
```

---

## 🔗 Cadeia de Dependências entre Stacks

O template raiz `main.yaml` provisiona as nested stacks na seguinte ordem de dependência:

```
main.yaml
 │
 ├─▶ [1] iam.yaml          sem dependências externas
 ├─▶ [2] monitoring.yaml   sem dependências externas
 ├─▶ [3] storage.yaml      exporta → KMSKeyArn · nomes dos buckets S3
 ├─▶ [4] database.yaml     requer  → KMSKeyArn
 ├─▶ [5] compute.yaml      requer  → IAM Roles · S3 · DynamoDB · SNS · CloudWatch
 └─▶ [6] api.yaml          requer  → ARNs das Lambdas
```

---

## 🚀 Como Começar

### Pré-requisitos

```bash
# Python + cfn-lint para validação dos templates
pip install cfn-lint

# Node.js 18+ para testes locais das Lambdas
node --version
```

### 1 — Validar todos os templates *(sem conta AWS)*

```bash
cfn-lint templates/iam.yaml \
         templates/monitoring.yaml \
         templates/storage.yaml \
         templates/database.yaml \
         templates/compute.yaml \
         templates/api.yaml \
         main.yaml
```

### 2 — Executar testes locais das Lambdas *(sem conta AWS)*

```bash
node lambda/test-local.js
```

### 3 — Deploy na AWS *(Free Tier elegível)*

```bash
# Criar bucket para hospedar os templates das nested stacks
aws s3 mb s3://docsaas-cfn-templates-{seu-nome}
aws s3 cp templates/ s3://docsaas-cfn-templates-{seu-nome}/templates/ --recursive

# Deploy completo da stack
aws cloudformation create-stack \
  --stack-name docsaas-simulation \
  --template-body file://main.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=Environment,ParameterValue=simulation \
    ParameterKey=ProjectName,ParameterValue=docsaas \
    ParameterKey=TemplatesBucketName,ParameterValue=docsaas-cfn-templates-{seu-nome}

# Consultar os Outputs após CREATE_COMPLETE (~3–5 min)
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs'

# Remover a stack após a apresentação (evita custos do KMS)
aws cloudformation delete-stack --stack-name docsaas-simulation
```

---

## 🔒 Isolamento Multi-Tenant

Cada documento é armazenado com um prefixo S3 exclusivo do tenant:

```
{tenantId}/{documentId}/{filename}

  tenant_acme/doc_ABC123/contrato-2024.pdf     ← somente Acme acessa
  tenant_xyz/doc_DEF456/proposta.docx          ← somente XYZ acessa
```

A Lambda `access-verifier` extrai o `tenantId` do JWT e restringe todas as Pre-signed URLs geradas ao prefixo daquele tenant. Tentativas de acesso cruzado são rejeitadas na camada de aplicação (`HTTP 403`) e bloqueadas independentemente pelas condições das roles IAM na camada AWS.

---

## 📊 Parâmetros CloudFormation

| Parâmetro | Padrão | Descrição |
|-----------|--------|-----------|
| `Environment` | `simulation` | Ambiente de execução — sufixo aplicado a todos os recursos |
| `ProjectName` | `docsaas` | Prefixo aplicado a todos os nomes de recursos |
| `RetentionDays` | `30` | Período de retenção dos logs no CloudWatch (dias) |
| `ArchiveDays` | `365` | Dias até os objetos S3 transitarem para o Glacier |
| `TemplatesBucketName` | `docsaas-cfn-templates` | Bucket S3 que hospeda os templates das nested stacks |

---

## 💰 Estimativa de Custos

| Serviço | Free Tier | Custo Demo |
|---------|-----------|------------|
| Lambda | 1M requisições/mês | **R$ 0,00** |
| API Gateway | 1M chamadas/mês | **R$ 0,00** |
| DynamoDB | 25 GB + 25 WCU/RCU | **R$ 0,00** |
| S3 Standard | 5 GB | **R$ 0,00** |
| CloudWatch | 5 GB de logs | **R$ 0,00** |
| SNS | 1M publicações/mês | **R$ 0,00** |
| **KMS CMK** | — | **~R$ 5,00/mês** |

> ⚠️ A chave KMS Customer Managed Key é o único recurso com custo fixo mensal. Execute `aws cloudformation delete-stack` após a apresentação para encerrar todas as cobranças.

---

## 📚 Documentação

| Documento | Descrição |
|-----------|-----------|
| [`docs/architecture.md`](docs/architecture.md) | Architecture Decision Records — justificativa de cada decisão técnica |
| [`docs/api-contract.md`](docs/api-contract.md) | Referência completa da API — endpoints, schemas, eventos SNS |
| [`docs/data-model.md`](docs/data-model.md) | Schema DynamoDB, estrutura S3, diagramas de fluxo de dados |
| [`docs/security.md`](docs/security.md) | Modelo de segurança, roles IAM, criptografia, logs de auditoria |
| [`docs/simulation-guide.md`](docs/simulation-guide.md) | Guia passo a passo de deploy e testes locais |

---

<div align="center">

*Desenvolvido com ❤️ — TCC · AWS CloudFormation · Serverless*

</div>
