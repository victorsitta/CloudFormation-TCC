# Guia de Simulação e Apresentação — TCC

---

## Opção 1 — Teste Local (sem conta AWS)

Tudo já está instalado e pronto. Basta rodar:

```bash
# Valida todos os templates CloudFormation
cfn-lint templates/iam.yaml templates/monitoring.yaml templates/storage.yaml templates/database.yaml templates/compute.yaml templates/api.yaml main.yaml

# Testa a lógica das Lambdas localmente
node lambda/test-local.js
```

Resultado esperado do test-local.js:
- JWT decodificado com tenantId e userId corretos
- S3 Key gerada no formato tenant/documentId/filename
- Extração de IDs do caminho S3 funcionando
- JWT inválido retornando HTTP 401

---

## Opção 2 — Deploy Real (conta AWS — Free Tier)

```bash
# 1. Criar bucket para os templates das nested stacks
aws s3 mb s3://docsaas-cfn-templates-{seu-nome}

# 2. Upload dos templates
aws s3 cp templates/ s3://docsaas-cfn-templates-{seu-nome}/templates/ --recursive

# 3. Deploy
aws cloudformation create-stack \
  --stack-name docsaas-simulation \
  --template-body file://main.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=Environment,ParameterValue=simulation \
    ParameterKey=ProjectName,ParameterValue=docsaas \
    ParameterKey=TemplatesBucketName,ParameterValue=docsaas-cfn-templates-{seu-nome}

# 4. Acompanhar o deploy
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].StackStatus'

# 5. Ver os Outputs após deploy concluído
aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs'

# 6. Testar a API
API_URL=$(aws cloudformation describe-stacks \
  --stack-name docsaas-simulation \
  --query 'Stacks[0].Outputs[?OutputKey==`APIGatewayURL`].OutputValue' \
  --output text)

MOCK_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInRlbmFudElkIjoidGVuYW50X2FjbWUiLCJpYXQiOjE3MDAwMDAwMDB9.mock"

curl -X POST "$API_URL/documents/upload-url" \
  -H "Authorization: Bearer $MOCK_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename":"teste.pdf","contentType":"application/pdf","sizeBytes":1024}'

# 7. LIMPAR após a apresentação (evitar custos)
aws cloudformation delete-stack --stack-name docsaas-simulation
```

---

## Custo Estimado (Free Tier)

| Serviço | Free Tier | Custo demo |
|---------|-----------|------------|
| Lambda | 1M invocações/mês | R$ 0,00 |
| API Gateway | 1M chamadas/mês | R$ 0,00 |
| DynamoDB | 25 GB + 25 WCU/RCU | R$ 0,00 |
| S3 Standard | 5 GB | R$ 0,00 |
| KMS | 1 chave = US$ 1,00/mês | ~R$ 5,00 |
| CloudWatch | 5 GB logs | R$ 0,00 |
| SNS | 1M publicações/mês | R$ 0,00 |

**Total: ~R$ 5,00** — apenas a chave KMS. Deletar o stack após a apresentação zera o custo.

---

## Roteiro de Apresentação (20 min)

### 1. Visão geral (3 min)
- Abrir o `README.md` e mostrar o diagrama de fluxo completo
- Explicar a divisão entre equipe MVP e equipe CloudFormation
- Explicar o conceito de multi-tenant

### 2. Estrutura do código (3 min)
- Mostrar a estrutura de pastas
- Abrir `main.yaml` — explicar que é o único arquivo que se executa e chama todos os outros
- Mostrar um template de domínio (sugestão: `storage.yaml`) e explicar o que cria

### 3. Validação ao vivo (2 min)
```bash
cfn-lint templates/*.yaml main.yaml
```
- Mostrar zero erros na saída

### 4. Teste local das Lambdas (4 min)
```bash
node lambda/test-local.js
```
- Mostrar JWT decodificado com tenantId
- Explicar o fluxo de isolamento multi-tenant
- Mostrar a extração de tenantId/documentId do caminho S3

### 5. Segurança (3 min)
- Abrir `templates/iam.yaml` — mostrar as 3 Roles com permissões mínimas
- Abrir `docs/security.md` — mostrar as 4 camadas de segurança

### 6. Perguntas (5 min)
