# DocSaaS — Infraestrutura AWS (TCC)

> Trabalho de Conclusão de Curso  
> Camada de infraestrutura serverless na AWS provisionada via CloudFormation

---

## O que é este projeto

Este repositório é a **camada de infraestrutura AWS** de um SaaS de gestão de documentos multi-tenant. O sistema permite que empresas (tenants) façam upload, download e gestão de documentos de forma segura, com arquivamento automático após 365 dias.

O projeto é dividido entre duas equipes:

| Equipe | Tecnologias | Responsabilidade |
|--------|-------------|-----------------|
| **MVP / Aplicação** | React, Node.js, Supabase | Interface, regras de negócio, autenticação |
| **CloudFormation** (este repo) | AWS Lambda, S3, DynamoDB, API Gateway, KMS, IAM, CloudWatch, SNS | Infraestrutura de armazenamento e processamento |

---

## O que é um Tenant

Tenant é a empresa ou organização que usa o SaaS. O sistema é multi-tenant — várias empresas compartilham a mesma infraestrutura, mas os dados de cada uma são completamente isolados.

```
Tenant A: Empresa Acme     → tenantId: "tenant_acme"     → só vê os próprios documentos
Tenant B: Startup XYZ      → tenantId: "tenant_xyz"      → só vê os próprios documentos
Tenant C: Escritório Adv.  → tenantId: "tenant_adv123"   → só vê os próprios documentos
```

O `tenantId` vem dentro do JWT emitido pelo Supabase Auth. A Lambda lê o JWT e garante que cada empresa só acessa a sua pasta no S3.

---

## Fluxo Completo do Sistema

### 1. Upload de Documento

```
Utilizador (browser)
    │
    │  1. Faz login via Supabase Auth
    │     Supabase emite JWT com { sub: userId, tenantId: "tenant_acme" }
    │
    ▼
Backend MVP (Node.js)
    │
    │  2. POST /documents/upload-url
    │     Header: Authorization: Bearer {JWT}
    │     Body: { filename, contentType, sizeBytes }
    │
    ▼
API Gateway (AWS)
    │
    │  3. Valida presença do header Authorization
    │     Encaminha para Lambda Access Verifier
    │
    ▼
Lambda Access Verifier
    │
    │  4. Decodifica o JWT → extrai tenantId e userId
    │  5. Gera documentId único
    │  6. Monta s3Key = tenant_acme/doc_ABC/contrato.pdf
    │  7. Gera Pre-signed URL para PUT no S3 (válida 900s)
    │
    ▼
Backend MVP recebe { uploadUrl, documentId, expiresIn: 900 }
    │
    │  8. PUT direto no S3 usando uploadUrl (sem passar pela Lambda)
    │
    ▼
S3 Standard Bucket armazena o arquivo
    │
    │  9. Backend MVP confirma o upload chamando:
    │     POST /documents
    │     Body: { documentId, filename, contentType, sizeBytes, s3Key }
    │
    ▼
Lambda Metadata Handler
    │
    │  10. Cria item no DynamoDB com storageClass: STANDARD, deleted: false
    │  11. Publica evento UPLOADED no SNS
    │
    ▼
SNS notifica o backend MVP → utilizador vê o documento na lista
```

---

### 2. Download de Documento

```
Utilizador clica em "Baixar documento"
    │
    ▼
Backend MVP
    │  GET /documents/download-url/{documentId}
    │  Header: Authorization: Bearer {JWT}
    │
    ▼
Lambda Access Verifier
    │  1. Decodifica JWT → extrai tenantId
    │  2. Consulta DynamoDB pelo documentId
    │  3. Verifica se tenantId do JWT == tenantId do documento
    │     (proteção multi-tenant — bloqueia acesso cruzado)
    │  4. Verifica storageClass do documento
    │
    ├─ storageClass: STANDARD → gera Pre-signed URL de GET no S3 Standard
    │
    └─ storageClass: GLACIER  → retorna { downloadUrl: null, restoreStatus: "REQUIRED" }
                                  (restore de Glacier leva 12-48h, fora do escopo do TCC)
    │
    ▼
Backend MVP recebe downloadUrl → utilizador faz download direto do S3
```

---

### 3. Listagem e Deleção

```
GET /documents
    │
    ▼
Lambda Metadata Handler
    │  Query no DynamoDB via GSI TenantIndex
    │  Filtra: tenantId == tenant do JWT AND deleted == false
    │  Ordena por data de upload (mais recente primeiro)
    │
    ▼
Retorna lista de documentos do tenant


DELETE /documents/{documentId}
    │
    ▼
Lambda Metadata Handler
    │  Atualiza DynamoDB: deleted = true, deletedAt, deletedBy
    │  Arquivo NO S3 NÃO é removido (auditoria / LGPD)
    │
    ▼
Retorna { message: "Document marked as deleted" }
```

---

### 4. Arquivamento Automático (sem intervenção humana)

```
[365 dias após o upload]
    │
    ▼
S3 Lifecycle Policy detecta objeto com 365+ dias no bucket Standard
    │
    ▼
S3 move o objeto automaticamente para o bucket Glacier Deep Archive
    │  (custo ~$0.00099/GB/mês vs $0.023/GB/mês no Standard)
    │
    ▼
S3 aciona automaticamente a Lambda Archive Trigger
    │
    ▼
Lambda Archive Trigger
    │  1. Extrai tenantId e documentId do caminho S3
    │     "tenant_acme/doc_ABC/contrato.pdf" → tenantId + documentId
    │  2. Atualiza DynamoDB: storageClass = GLACIER, archivedAt = agora
    │  3. Publica evento ARCHIVED no SNS
    │
    ▼
SNS notifica o backend MVP → utilizador vê documento como "Arquivado"
```

---

## Estrutura de Pastas

```
TCC/
│
├── main.yaml                    # Template raiz — orquestra todos os outros via nested stacks
│
├── templates/                   # Templates CloudFormation por domínio
│   ├── iam.yaml                 # Roles e permissões IAM das 3 Lambdas (criado primeiro)
│   ├── monitoring.yaml          # CloudWatch Log Group + SNS Topic (criado segundo)
│   ├── storage.yaml             # KMS Key + S3 Standard + S3 Glacier (criado terceiro)
│   ├── database.yaml            # Tabela DynamoDB de metadados (criado quarto)
│   ├── compute.yaml             # 3 funções Lambda (criado quinto)
│   └── api.yaml                 # API Gateway REST com 4 rotas (criado último)
│
├── lambda/                      # Código fonte das funções Lambda
│   ├── access-verifier/
│   │   ├── index.js             # Valida JWT e gera Pre-signed URLs
│   │   ├── package.json
│   │   └── README.md
│   ├── metadata-handler/
│   │   ├── index.js             # CRUD de metadados no DynamoDB
│   │   ├── package.json
│   │   └── README.md
│   ├── archive-trigger/
│   │   ├── index.js             # Atualiza DynamoDB após arquivamento no Glacier
│   │   ├── package.json
│   │   └── README.md
│   └── test-local.js            # Script de teste local sem AWS
│
├── docs/                        # Documentação técnica detalhada
│   ├── architecture.md          # Decisões de arquitetura e justificativas
│   ├── api-contract.md          # Endpoints, schemas de request/response
│   ├── data-model.md            # Modelo DynamoDB, estrutura S3, fluxos de dados
│   ├── security.md              # Camadas de segurança e isolamento multi-tenant
│   └── simulation-guide.md      # Como validar e apresentar no TCC
│
├── .env.example                 # Variáveis de ambiente para a equipe MVP
└── README.md                    # Este arquivo
```

---

## Ordem de Criação dos Templates (Dependências)

O `main.yaml` cria os stacks nesta ordem porque cada um depende do anterior:

```
1. iam.yaml         → sem dependências — cria as Roles IAM primeiro
2. monitoring.yaml  → sem dependências — cria CloudWatch e SNS
3. storage.yaml     → cria KMS Key + S3 Standard + S3 Glacier
4. database.yaml    → usa KMS Key do storage.yaml
5. compute.yaml     → usa tudo: IAM Roles, S3, DynamoDB, SNS, CloudWatch
6. api.yaml         → usa os ARNs das Lambdas do compute.yaml
```

---

## Recursos AWS Criados

| Serviço | Recurso | Para que serve |
|---------|---------|----------------|
| API Gateway | REST API + 4 rotas | Ponto de entrada para o backend MVP |
| Lambda | access-verifier | Valida JWT e gera URLs de upload/download |
| Lambda | metadata-handler | Cria, lista e deleta metadados no DynamoDB |
| Lambda | archive-trigger | Atualiza DynamoDB após arquivamento no Glacier |
| S3 | docsaas-standard-* | Documentos ativos (0–365 dias) |
| S3 | docsaas-glacier-* | Documentos arquivados (365+ dias) |
| DynamoDB | docsaas-documents-* | Metadados dos documentos |
| KMS | CMK com rotação anual | Criptografia de S3 e DynamoDB em repouso |
| IAM | 3 Roles | Permissões mínimas por Lambda |
| CloudWatch | Log Group | Logs estruturados JSON de todas as Lambdas |
| SNS | Topic de eventos | Notificações UPLOADED, ARCHIVED, ERROR |

---

## Isolamento Multi-Tenant

Cada documento é armazenado com o prefixo do tenant no S3:

```
S3 Bucket
├── tenant_acme/
│   ├── doc_ABC/contrato.pdf
│   └── doc_DEF/relatorio.pdf
├── tenant_xyz/
│   └── doc_GHI/proposta.docx
└── tenant_adv123/
    └── doc_JKL/processo.pdf
```

A Lambda só gera URLs para o prefixo do tenant autenticado no JWT. Um tenant nunca consegue acessar a pasta de outro.

---

## Como Validar os Templates

```bash
# Validar todos os templates de uma vez (cfn-lint já instalado)
cfn-lint templates/iam.yaml templates/monitoring.yaml templates/storage.yaml templates/database.yaml templates/compute.yaml templates/api.yaml main.yaml

# Testar a lógica das Lambdas localmente (sem AWS)
node lambda/test-local.js
```

---

## Como Fazer Deploy (com conta AWS)

```bash
# 1. Criar bucket para os templates das nested stacks
aws s3 mb s3://docsaas-cfn-templates-{seu-nome}

# 2. Upload dos templates
aws s3 cp templates/ s3://docsaas-cfn-templates-{seu-nome}/templates/ --recursive

# 3. Atualizar o parâmetro TemplatesBucketName no main.yaml com o nome do bucket acima

# 4. Deploy
aws cloudformation create-stack \
  --stack-name docsaas-simulation \
  --template-body file://main.yaml \
  --capabilities CAPABILITY_NAMED_IAM

# 5. Ver os Outputs (URL da API, ARNs, nomes dos recursos)
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs'

# 6. Limpar após a apresentação
aws cloudformation delete-stack --stack-name docsaas-simulation
```

---

## Documentação Complementar

| Documento | Conteúdo |
|-----------|----------|
| `docs/architecture.md` | Por que cada decisão técnica foi tomada |
| `docs/api-contract.md` | Todos os endpoints com request/response completos |
| `docs/data-model.md` | Estrutura do DynamoDB, S3 e KMS |
| `docs/security.md` | Camadas de segurança e isolamento multi-tenant |
| `docs/simulation-guide.md` | Roteiro de apresentação do TCC |
