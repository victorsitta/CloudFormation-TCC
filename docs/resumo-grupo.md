# Resumo do Projeto — DocSaaS Infra TCC
> Este documento foi criado para ser compartilhado com todo o grupo.
> Cada seção é direcionada para uma pessoa específica do grupo.

---

## O QUE É O PROJETO (leia todos)

Estamos construindo um **SaaS de gestão de documentos** — um sistema onde empresas podem fazer upload, download e gestão de documentos na nuvem, de forma segura e organizada.

O projeto é dividido em duas partes:

**Parte 1 — MVP / Aplicação** (outra equipe)
- Frontend em React (tela do utilizador)
- Backend em Node.js (regras de negócio)
- Supabase Auth (login e autenticação)
- Supabase PostgreSQL (dados das contas e planos)

**Parte 2 — Infraestrutura AWS** (nossa equipe — este repositório)
- Toda a camada de armazenamento e processamento de documentos
- Construída como código usando AWS CloudFormation
- Serverless — sem servidores para gerir

---

## CONCEITO IMPORTANTE: O QUE É UM TENANT

Tenant = a empresa que contrata o sistema.

Exemplo:
- Empresa Acme contrata o SaaS → ela é o **Tenant A**
- Startup XYZ contrata o SaaS → ela é o **Tenant B**

Cada empresa tem seus próprios documentos completamente isolados. A Empresa Acme nunca vê os documentos da Startup XYZ, mesmo que tudo esteja na mesma infraestrutura. Isso é chamado de **sistema multi-tenant**.

O isolamento é feito pelo `tenantId` — um identificador único de cada empresa que fica dentro do token de autenticação (JWT).

---

## COMO FUNCIONA O FLUXO COMPLETO

### Upload de um documento:
1. Utilizador faz login → Supabase gera um token (JWT) com o tenantId da empresa
2. Backend MVP chama nossa API: `POST /documents/upload-url`
3. Nossa Lambda valida o JWT e gera uma URL temporária para o S3
4. O MVP faz o upload do arquivo diretamente no S3 usando essa URL
5. O MVP confirma o upload → nossa Lambda cria os metadados no DynamoDB
6. SNS notifica o MVP que o upload foi concluído

### Download:
1. MVP chama `GET /documents/download-url/{documentId}`
2. Lambda verifica se o documento pertence ao tenant correto
3. Lambda gera URL temporária de download e devolve ao MVP

### Arquivamento automático (após 365 dias):
1. S3 detecta automaticamente arquivos com 365+ dias
2. S3 move o arquivo para o Glacier (armazenamento frio e barato)
3. Nossa Lambda é acionada automaticamente
4. Lambda atualiza o banco de dados e notifica o sistema

---

## SERVIÇOS AWS QUE USAMOS

| Serviço | Para que serve no projeto |
|---------|--------------------------|
| API Gateway | Porta de entrada — recebe as chamadas do MVP |
| Lambda (3 funções) | Processamento — valida tokens, gera URLs, atualiza banco |
| S3 Standard | Armazena os documentos nos primeiros 365 dias |
| S3 Glacier Deep Archive | Armazena documentos antigos (365+ dias) com custo mínimo |
| DynamoDB | Banco de dados para informações sobre os documentos |
| KMS | Criptografia — protege os dados armazenados |
| IAM | Permissões — controla quem pode fazer o quê |
| CloudWatch | Logs — registra tudo que acontece no sistema |
| SNS | Notificações — avisa o MVP quando algo acontece |

---

---

-------------------------------------------------------------------------------------------------------------------
# SEÇÃO 0 — PARA A EQUIPE MVP: COMO SE CONECTAR COM A INFRA AWS
# ✅ ADICIONADO — Como o MVP se conecta com a infra AWS (endpoints, fluxo, SNS)
-------------------------------------------------------------------------------------------------------------------

## Vocês NÃO precisam instalar nada da nossa parte

Nossa equipe usou o CloudFormation para **criar a infraestrutura dentro da AWS**. Depois do deploy, a AWS gera uma URL real de API. Vocês chamam essa URL diretamente do backend Node.js — sem intermediário.

## A URL que vocês vão usar

Após o deploy, a infra gera uma URL no formato:
```
https://{api-id}.execute-api.{region}.amazonaws.com/simulation
```
Essa URL será entregue por nós após o deploy. Coloquem ela no `.env` de vocês.

## Os 4 endpoints disponíveis

| Método | Endpoint | Para que serve |
|--------|----------|---------------|
| POST | `/documents/upload-url` | Pedir URL temporária para fazer upload de um arquivo |
| GET | `/documents/download-url/{documentId}` | Pedir URL temporária para baixar um arquivo |
| GET | `/documents` | Listar todos os documentos da empresa |
| DELETE | `/documents/{documentId}` | Marcar um documento como deletado |

## Como autenticar

Todos os endpoints precisam do JWT do Supabase no header:
```
Authorization: Bearer {token_do_supabase}
```

O JWT **precisa ter o campo `tenantId`** como claim customizado — isso é responsabilidade de vocês configurar no Supabase Auth. Sem o `tenantId` no JWT, a nossa Lambda rejeita a requisição com HTTP 403.

## Fluxo de upload (passo a passo para vocês implementarem)

```
1. Chamar POST /documents/upload-url
   Body: { filename, contentType, sizeBytes }
   Header: Authorization: Bearer {JWT}

2. Receber: { uploadUrl, documentId, expiresIn: 900 }

3. Fazer PUT direto na uploadUrl com o arquivo binário
   (não passa pela nossa API — vai direto pro S3)

4. Após upload concluído, confirmar chamando POST /documents
   Body: { documentId, filename, contentType, sizeBytes, s3Key }
   (o s3Key vocês montam como: {tenantId}/{documentId}/{filename})
```

## Fluxo de download

```
1. Chamar GET /documents/download-url/{documentId}
   Header: Authorization: Bearer {JWT}

2. Receber: { downloadUrl, storageClass, expiresIn: 900 }
   - Se storageClass = STANDARD → downloadUrl é uma URL válida
   - Se storageClass = GLACIER  → downloadUrl é null (arquivo arquivado, inacessível imediatamente)

3. Redirecionar o utilizador para a downloadUrl
```

## Eventos SNS (opcional — para notificações em tempo real)

Se quiserem receber notificações quando algo acontece, podem subscrever o nosso tópico SNS. Entregaremos o ARN do tópico após o deploy.

Eventos que publicamos:
- `UPLOADED` — documento criado com sucesso
- `ARCHIVED` — documento movido para Glacier após 365 dias
- `ERROR` — erro crítico no processamento

## O que precisamos de vocês

Apenas uma coisa: configurar o Supabase Auth para incluir o `tenantId` no JWT como claim customizado. Sem isso o sistema não consegue identificar a qual empresa o utilizador pertence.

---

-------------------------------------------------------------------------------------------------------------------
# SEÇÃO 1 — PARA A PESSOA DE CUSTOS

## O que você precisa fazer

Calcular e documentar quanto custaria este sistema em produção real, usando a calculadora oficial da AWS.

## Link da calculadora
**https://calculator.aws/pricing/2/home**

---

## Como calcular cada serviço

### 1. AWS Lambda
- Acesse: calculadora → Lambda
- **Modelo de precificação**: pay-per-use (paga por execução)
- **Parâmetros para simular**:
  - Número de requisições por mês: comece com **10.000** (cenário pequeno) e **100.000** (cenário médio)
  - Duração média de cada execução: **500 ms**
  - Memória alocada: **256 MB** (access-verifier e metadata-handler) e **128 MB** (archive-trigger)
- **Free Tier**: 1 milhão de invocações gratuitas por mês — para TCC o custo é R$ 0,00
- **Em produção real**: ~$0.20 por 1 milhão de requisições

### 2. Amazon API Gateway
- Acesse: calculadora → API Gateway → REST API
- **Parâmetros**:
  - Número de chamadas por mês: mesmos valores do Lambda acima
  - Transferência de dados: estimativa de 1 KB por requisição
- **Free Tier**: 1 milhão de chamadas gratuitas por mês
- **Em produção**: ~$3.50 por 1 milhão de chamadas

### 3. Amazon S3 Standard
- Acesse: calculadora → S3
- **Parâmetros**:
  - Armazenamento: estime o tamanho médio dos documentos × número de documentos
  - Exemplo: 1.000 documentos × 2 MB cada = **2 GB armazenados**
  - Requests PUT (upload): número de documentos por mês
  - Requests GET (download): estimativa de 5 downloads por documento
- **Free Tier**: 5 GB gratuitos por 12 meses
- **Em produção**: ~$0.023 por GB/mês

### 4. Amazon S3 Glacier Deep Archive
- Mesmo campo do S3, mas selecionar classe **Glacier Deep Archive**
- **Uso**: documentos com 365+ dias — comece estimando 20% do total de documentos
- **Custo**: ~$0.00099 por GB/mês (23x mais barato que S3 Standard)
- **Importante**: Glacier é o grande diferencial de custo do projeto — demonstrar essa comparação é muito relevante para o TCC

### 5. Amazon DynamoDB
- Acesse: calculadora → DynamoDB
- **Modo**: On-Demand (PAY_PER_REQUEST)
- **Parâmetros**:
  - Write Request Units (WRU): 1 por documento criado + 1 por deleção = número de documentos por mês
  - Read Request Units (RRU): estimativa de 10 leituras por documento (listagens, downloads)
  - Armazenamento: ~1 KB por documento (metadados são pequenos)
- **Free Tier**: 25 GB + 25 WCU + 25 RCU gratuitos permanentemente
- **Para TCC**: custo zero

### 6. AWS KMS (Key Management Service)
- Acesse: calculadora → KMS
- **Parâmetros**:
  - 1 Customer Managed Key (CMK): **$1.00/mês fixo**
  - Requisições de criptografia: ~$0.03 por 10.000 requisições
- **Este é o único serviço com custo fixo** — $1.00/mês (~R$ 5,00)
- **Para o TCC**: lembrar de deletar a stack após a apresentação para não acumular custo

### 7. Amazon CloudWatch
- Acesse: calculadora → CloudWatch
- **Parâmetros**:
  - Logs ingeridos: estimativa de 1 KB por invocação Lambda × número de invocações
  - Retenção configurada: 30 dias
- **Free Tier**: 5 GB gratuitos por mês
- **Para TCC**: custo zero

### 8. Amazon SNS
- Acesse: calculadora → SNS
- **Parâmetros**:
  - Publicações: 1 por documento criado + 1 por documento arquivado
- **Free Tier**: 1 milhão de publicações gratuitas por mês
- **Para TCC**: custo zero

---

## Comparação para incluir no TCC

Monte uma tabela assim:

| Cenário | Documentos/mês | Custo estimado/mês |
|---------|---------------|-------------------|
| TCC / Demo | < 1.000 | ~R$ 5,00 (só KMS) |
| Pequena empresa | 10.000 | ~R$ 15–30 |
| Média empresa | 100.000 | ~R$ 80–150 |

**Destaque importante**: O Glacier Deep Archive reduz o custo de armazenamento em 95% para documentos antigos. Este é um dos principais argumentos técnicos e econômicos do projeto.

---

-------------------------------------------------------------------------------------------------------------------
# SEÇÃO 2 — PARA A PESSOA DE QA (Qualidade e Testes)

## O que você precisa fazer

Documentar os testes do sistema. Para o TCC, não precisamos de testes automatizados complexos — precisamos mostrar que o sistema funciona corretamente e que os casos de erro são tratados.

---

## Testes que já existem (prontos para rodar)

### Teste local das Lambdas
```bash
# Rodar no terminal dentro da pasta do projeto
node lambda/test-local.js
```

Este script testa:
- ✅ Decodificação correta do JWT (extração de tenantId e userId)
- ✅ Geração correta do caminho S3 com isolamento de tenant
- ✅ Extração de tenantId/documentId do caminho S3 (para archive-trigger)
- ✅ Rejeição de JWT sem o prefixo "Bearer" (retorna 401)

### Validação dos templates CloudFormation
```bash
cfn-lint templates/iam.yaml templates/monitoring.yaml templates/storage.yaml templates/database.yaml templates/compute.yaml templates/api.yaml main.yaml
```
- ✅ Verifica sintaxe e estrutura de todos os templates

---

## Casos de teste para documentar

Monte uma tabela de casos de teste para o TCC:

### Cenários de sucesso

| ID | Cenário | Entrada | Resultado Esperado |
|----|---------|---------|-------------------|
| TC01 | Upload com JWT válido | JWT com tenantId + filename + contentType | HTTP 200 + uploadUrl + documentId |
| TC02 | Download de documento próprio | JWT correto + documentId do próprio tenant | HTTP 200 + downloadUrl |
| TC03 | Listar documentos | JWT válido | HTTP 200 + lista de documentos do tenant |
| TC04 | Deletar documento próprio | JWT correto + documentId válido | HTTP 200 + mensagem de confirmação |
| TC05 | Arquivamento automático | Documento com 365+ dias | storageClass atualizado para GLACIER no DynamoDB |

### Cenários de erro (segurança)

| ID | Cenário | Entrada | Resultado Esperado |
|----|---------|---------|-------------------|
| TC06 | Sem JWT no header | Chamada sem Authorization | HTTP 401 |
| TC07 | JWT malformado | Token inválido | HTTP 403 |
| TC08 | Tenant mismatch | Tenant A tenta acessar documento do Tenant B | HTTP 403 |
| TC09 | Documento inexistente | documentId que não existe | HTTP 404 |
| TC10 | Download de arquivo no Glacier | Documento com 365+ dias | HTTP 200 + downloadUrl: null + restoreStatus: REQUIRED |

---

## Como documentar os testes no TCC

Para cada caso de teste, documente:
1. **Pré-condição**: o que precisa existir antes do teste
2. **Passo a passo**: o que fazer
3. **Resultado obtido**: o que aconteceu (com print ou log do CloudWatch se disponível)
4. **Status**: ✅ Passou / ❌ Falhou

---

## Evidências de teste para a apresentação

Ao rodar `node lambda/test-local.js`, copie o output do terminal e inclua no documento de testes como evidência. O resultado esperado é:

```
✅ Todos os testes passaram
```

---

-------------------------------------------------------------------------------------------------------------------
# SEÇÃO 3 — PARA A PESSOA DE ARQUITETURA

## O que você precisa fazer

Documentar a arquitetura do sistema de forma visual e técnica para o TCC.

---

## Diagrama de Arquitetura

Monte um diagrama com as seguintes camadas (pode usar draw.io, Lucidchart ou Mermaid):

```
┌─────────────────────────────────────────┐
│          EQUIPE MVP / APLICAÇÃO          │
│  React → Node.js → Supabase Auth + DB    │
└─────────────────┬───────────────────────┘
                  │ JWT + HTTP
                  ▼
┌─────────────────────────────────────────┐
│         CAMADA NOSSA (CloudFormation)    │
│                                          │
│  API Gateway (porta de entrada REST)     │
│       │              │                   │
│  Lambda           Lambda                 │
│  access-verifier  metadata-handler       │
│       │              │                   │
│  S3 Standard      DynamoDB               │
│       │           (metadados)            │
│  [365 dias]                              │
│       │                                  │
│  S3 Glacier  ←  Lambda archive-trigger  │
│                                          │
│  KMS (criptografia de tudo)              │
│  CloudWatch (logs)                       │
│  SNS (notificações)                      │
└─────────────────────────────────────────┘
```

---

## Decisões arquiteturais importantes para documentar

### Por que Serverless (Lambda) e não servidores?
- Sem custo quando não há uso
- Escala automaticamente
- Sem gestão de servidores
- Ideal para TCC e para o padrão de uso do sistema

### Por que dois buckets S3 (Standard + Glacier)?
- Standard: documentos ativos, acesso rápido, custo $0.023/GB/mês
- Glacier: documentos antigos (365+ dias), acesso lento (12-48h), custo $0.00099/GB/mês
- A transição é automática via Lifecycle Policy — sem código adicional

### Por que DynamoDB e não PostgreSQL?
- Supabase PostgreSQL já é usado pelo MVP para dados de conta
- DynamoDB fica na camada AWS, separado e serverless
- Consultas por documentId + tenantId são ideais para chave composta do DynamoDB

### Por que Pre-signed URLs?
- A Lambda não recebe o arquivo — ela apenas gera uma URL temporária
- O MVP faz o upload/download diretamente no S3
- Mais rápido, mais barato e mais seguro

### Por que KMS CMK?
- Chave gerida pelo cliente (Customer Managed Key)
- Rotação automática anual
- Controle total da política de acesso
- Boa prática de segurança em ambientes multi-tenant

### Por que nested stacks no CloudFormation?
- Um único template teria mais de 200 recursos — limite do CloudFormation
- Separar por domínio torna o código mais legível e manutenível
- Demonstra boas práticas de IaC (Infrastructure as Code)

---

## Ordem de criação dos recursos (dependências)

```
main.yaml
├── 1. iam.yaml         → cria primeiro — outros dependem das Roles
├── 2. monitoring.yaml  → cria segundo — Lambdas precisam do Log Group e SNS
├── 3. storage.yaml     → cria terceiro — DynamoDB precisa do KMS Key
├── 4. database.yaml    → cria quarto — Lambdas precisam da tabela DynamoDB
├── 5. compute.yaml     → cria quinto — API Gateway precisa dos ARNs das Lambdas
└── 6. api.yaml         → cria por último — depende de tudo
```

---

-------------------------------------------------------------------------------------------------------------------
# SEÇÃO 4 — PARA A PESSOA DE SEGURANÇA

## O que você precisa fazer

Documentar todas as medidas de segurança implementadas no sistema.

---

## As 4 Camadas de Segurança

### Camada 1 — API Gateway
- Toda comunicação é obrigatoriamente HTTPS/TLS
- Valida a presença do header `Authorization` em todos os endpoints
- Retorna HTTP 401 se o header estiver ausente
- Nenhum recurso interno (S3, DynamoDB, Lambda) é exposto diretamente

### Camada 2 — Validação do JWT (Lambda)
- O JWT é emitido pelo Supabase Auth (equipe MVP)
- Nossa Lambda decodifica o JWT e extrai `tenantId` e `userId`
- Verifica se o documento solicitado pertence ao tenant do JWT
- Se tenant do JWT ≠ tenant do documento → HTTP 403 (tenant mismatch)
- Para o TCC: validação sem verificar assinatura (simplificação acadêmica)
- Em produção: verificar assinatura com chave pública do Supabase

### Camada 3 — IAM (Permissões AWS)
Cada Lambda tem uma Role IAM própria com permissões mínimas (princípio do menor privilégio):

| Lambda | Pode fazer |
|--------|-----------|
| access-verifier | S3 GetObject + PutObject, KMS, CloudWatch |
| metadata-handler | DynamoDB GetItem/PutItem/UpdateItem/Query, SNS, KMS, CloudWatch |
| archive-trigger | DynamoDB UpdateItem apenas, SNS, KMS, CloudWatch |

A `archive-trigger` não tem acesso ao S3 — ela só atualiza o DynamoDB e notifica o SNS. Isso demonstra o princípio do menor privilégio na prática.

### Camada 4 — Criptografia (KMS)
- **KMS CMK** (Customer Managed Key): chave de criptografia gerida pelo cliente
- **S3 Standard**: criptografia SSE-KMS — todos os objetos são criptografados automaticamente no upload
- **S3 Glacier**: mesma chave KMS — objetos arquivados também criptografados
- **DynamoDB**: criptografia em repouso ativada com a mesma chave KMS
- **Rotação automática anual**: a AWS cria uma nova versão da chave todo ano automaticamente

---

## Isolamento Multi-Tenant

### Como funciona:
1. Supabase emite JWT com `tenantId` da empresa
2. Lambda extrai o `tenantId` do JWT
3. Toda URL gerada aponta para `s3://bucket/{tenantId}/{documentId}/arquivo`
4. Empresa A nunca consegue gerar uma URL para a pasta da Empresa B

### Estrutura de isolamento no S3:
```
bucket/
├── tenant_empresa_a/    ← Empresa A só acessa esta pasta
│   ├── doc_001/contrato.pdf
│   └── doc_002/relatorio.pdf
└── tenant_empresa_b/    ← Empresa B só acessa esta pasta
    └── doc_003/proposta.docx
```

---

## Eliminação Lógica (conformidade / LGPD)

Quando um documento é "deletado" pelo utilizador:
- O arquivo **permanece no S3** (não é removido fisicamente)
- No DynamoDB, o campo `deleted` é atualizado para `true`
- O documento não aparece mais na listagem
- Rastreabilidade: os campos `deletedAt` e `deletedBy` são gravados

Isso permite auditoria e conformidade com leis de proteção de dados.

---

## Auditoria e Rastreamento

Todos os eventos são registados no CloudWatch em formato JSON:

```json
{
  "level": "INFO",
  "message": "Pre-signed URL de upload gerada",
  "timestamp": "2024-03-15T14:30:00Z",
  "tenantId": "tenant_acme_corp",
  "userId": "user_abc123",
  "documentId": "doc_01HK2XABCDEF",
  "operation": "GENERATE_UPLOAD_URL",
  "status": "APPROVED"
}
```

Para acessos negados:
```json
{
  "level": "WARN",
  "message": "Tentativa de acesso cross-tenant bloqueada",
  "tenantId": "tenant_empresa_a",
  "documentId": "doc_de_outra_empresa",
  "operation": "GENERATE_DOWNLOAD_URL",
  "status": "DENIED",
  "reason": "tenant mismatch"
}
```

---

## Simplificações para o TCC (honestidade acadêmica)

Documentar que as seguintes simplificações foram feitas conscientemente:

| Aspecto | O que fizemos (TCC) | O que seria em produção |
|---------|---------------------|------------------------|
| Validação JWT | Decodifica sem verificar assinatura | Verifica assinatura com chave pública Supabase |
| Secrets | Sem uso de Secrets Manager | AWS Secrets Manager para chaves sensíveis |
| WAF | Não implementado | AWS WAF com rate limiting e proteção DDoS |
| VPC | Lambda fora de VPC | Lambda dentro de VPC privada com VPC Endpoints |
| Multi-region | Single region | Multi-region para alta disponibilidade |

---

-------------------------------------------------------------------------------------------------------------------
# SEÇÃO 5 — PARA A PESSOA DE DOCUMENTAÇÃO

## O que você precisa fazer

Organizar e formatar toda a documentação do projeto para entrega do TCC.

---

## Documentos já criados (prontos)

| Arquivo | Conteúdo | Status |
|---------|----------|--------|
| `README.md` | Visão geral + fluxo completo + estrutura de pastas | ✅ Pronto |
| `docs/architecture.md` | Decisões de arquitetura e justificativas | ✅ Pronto |
| `docs/api-contract.md` | Todos os endpoints com request/response | ✅ Pronto |
| `docs/data-model.md` | Modelo DynamoDB, estrutura S3, fluxos de dados | ✅ Pronto |
| `docs/security.md` | Camadas de segurança e isolamento multi-tenant | ✅ Pronto |
| `docs/simulation-guide.md` | Como validar e apresentar o TCC | ✅ Pronto |
| `docs/resumo-grupo.md` | Este arquivo — resumo para o grupo | ✅ Pronto |
| `.env.example` | Variáveis de ambiente para a equipe MVP | ✅ Pronto |

---

## Glossário para incluir na documentação do TCC

| Termo | Definição |
|-------|-----------|
| **Tenant** | Empresa ou organização que usa o SaaS |
| **Multi-tenant** | Sistema onde várias empresas compartilham a mesma infraestrutura com dados isolados |
| **JWT** | Token de autenticação emitido pelo Supabase Auth com informações do utilizador e tenant |
| **tenantId** | Identificador único da empresa dentro do JWT |
| **Pre-signed URL** | URL temporária que permite upload/download direto no S3 sem expor credenciais AWS |
| **Lambda** | Função serverless que executa código sem servidor dedicado |
| **CloudFormation** | Serviço AWS para criar infraestrutura como código (IaC) |
| **Nested Stack** | Template CloudFormation que é chamado por outro template |
| **DynamoDB** | Banco de dados NoSQL da AWS — armazena metadados dos documentos |
| **S3 Standard** | Armazenamento de alta disponibilidade para documentos ativos |
| **S3 Glacier** | Armazenamento frio e barato para documentos históricos (365+ dias) |
| **KMS CMK** | Chave de criptografia gerida pelo cliente na AWS |
| **IAM** | Serviço de permissões e controle de acesso da AWS |
| **SNS** | Serviço de notificações da AWS — envia eventos entre serviços |
| **CloudWatch** | Serviço de logs e monitorização da AWS |
| **Lifecycle Policy** | Regra automática do S3 que move arquivos entre classes de armazenamento |
| **Eliminação lógica** | Marcar como deletado sem remover fisicamente — mantém para auditoria |
| **Least Privilege** | Princípio de segurança: cada componente tem apenas as permissões mínimas necessárias |

---

## Sugestão de estrutura para o relatório do TCC

1. Introdução
2. Objetivos
3. Tecnologias utilizadas
4. Arquitetura do sistema (usar `docs/architecture.md`)
5. Modelo de dados (usar `docs/data-model.md`)
6. Segurança (usar `docs/security.md`)
7. API e integração com o MVP (usar `docs/api-contract.md`)
8. Análise de custos (usar seção de custos deste documento)
9. Testes realizados (usar seção de QA deste documento)
10. Conclusão
11. Referências

---

## Como citar os serviços AWS

Para referências bibliográficas, use a documentação oficial:
- AWS CloudFormation: https://docs.aws.amazon.com/cloudformation/
- AWS Lambda: https://docs.aws.amazon.com/lambda/
- Amazon S3: https://docs.aws.amazon.com/s3/
- Amazon DynamoDB: https://docs.aws.amazon.com/dynamodb/
- AWS KMS: https://docs.aws.amazon.com/kms/
- Amazon API Gateway: https://docs.aws.amazon.com/apigateway/
