# Decisões de Arquitectura

## Visão Geral

Este documento explica as principais decisões de arquitectura do sistema DocSaaS Infra TCC, o raciocínio por detrás de cada escolha e as alternativas consideradas.

---

## 1. Arquitectura Serverless

**Decisão**: Usar AWS Lambda em vez de servidores EC2 ou containers ECS.

**Raciocínio**:
- **TCC académico**: A complexidade de gerir servidores não agrega valor ao objectivo do trabalho.
- **Custo zero em simulação**: Lambda não tem custo sem execuções reais.
- **Demonstra IaC completo**: CloudFormation para Lambda é mais simples e completo do que para EC2.
- **Adequado ao padrão de uso**: Requisições intermitentes de upload/download são ideais para serverless.

**Alternativas rejeitadas**:
- EC2: Complexidade operacional desnecessária para TCC.
- ECS/Fargate: Overhead de orquestração de containers não justificado.

---

## 2. Separação em Nested Stacks

**Decisão**: Dividir o CloudFormation em 6 templates de domínio + 1 template raiz com nested stacks.

**Raciocínio**:
- **Clareza académica**: Avaliadores vêem claramente cada camada da arquitectura.
- **Limites do CloudFormation**: Um único template tem limite de 200 recursos; nested stacks evitam este limite.
- **Manutenção independente**: Cada domínio pode ser actualizado sem afectar os outros.
- **Demonstra boas práticas IaC**: Modularização é uma prática real em empresas.

**Estrutura de dependências**:
```
main.yaml
├── iam.yaml         (sem dependências externas)
├── storage.yaml     (depende de: iam.yaml → KMSKeyArn)
├── database.yaml    (depende de: iam.yaml → KMSKeyArn)
├── monitoring.yaml  (depende de: nada)
├── compute.yaml     (depende de: storage, database, monitoring, iam)
└── api.yaml         (depende de: compute.yaml → Lambda ARNs)
```

---

## 3. Isolamento Multi-Tenant via Prefixos S3

**Decisão**: Usar `{tenantId}/{documentId}/{filename}` como estrutura de prefixo S3.

**Raciocínio**:
- **Isolamento por IAM**: Políticas IAM podem usar `s3:prefix` condition para restringir acesso por tenant.
- **Simplicidade**: Não requer bucket por tenant (o que seria caro e complexo).
- **Auditoria**: A estrutura de prefixo torna trivial identificar a quem pertence cada ficheiro.

**Exemplo de política IAM restritiva**:
```yaml
Condition:
  StringLike:
    s3:prefix: "${tenantId}/*"
```

---

## 4. Pre-signed URLs em vez de Proxy Lambda

**Decisão**: Lambda gera Pre-signed URLs; o cliente faz upload/download directamente para o S3.

**Raciocínio**:
- **Performance**: Evita que a Lambda seja o bottleneck de transferência de ficheiros grandes.
- **Custo**: Lambda cobra por GB processado; S3 directo não tem este custo.
- **Segurança**: Pre-signed URLs têm expiração (900 segundos) e são limitadas ao prefixo do tenant.
- **Simplicidade**: O padrão é amplamente utilizado em produção real.

**Fluxo**:
```
Cliente → API Gateway → Lambda (gera URL) → Cliente → S3 (upload/download directo)
```

---

## 5. DynamoDB para Metadados

**Decisão**: Usar DynamoDB em vez de RDS PostgreSQL para metadados de documentos.

**Raciocínio**:
- **Separação de responsabilidades**: O Supabase PostgreSQL (gerido pela equipe MVP) já gere dados de conta, planos e permissões. DynamoDB fica na camada AWS da equipe CloudFormation.
- **Serverless por natureza**: DynamoDB não requer gestão de servidor, alinhado com o resto da arquitectura.
- **Modelo de acesso**: Consultas por `documentId` e `tenantId` são ideais para chave composta DynamoDB.
- **Escalabilidade**: DynamoDB escala automaticamente com a carga.

**Modelo de chave**:
- Partition Key: `documentId` — acesso directo por documento
- Sort Key: `tenantId` — queries por tenant + isolamento

---

## 6. Dois Buckets S3 (Standard + Glacier)

**Decisão**: Usar dois buckets separados em vez de um único com lifecycle.

**Raciocínio**:
- **Clareza no CloudFormation**: Dois recursos distintos demonstram melhor a separação de responsabilidades.
- **Controlo granular de IAM**: Políticas diferentes podem ser aplicadas a cada bucket.
- **Demonstração académica**: Torna explícita a distinção entre armazenamento activo e arquivo histórico.

**Nota**: Em produção, um único bucket com lifecycle policy e classes de armazenamento seria suficiente. A escolha de dois buckets é deliberada para clareza académica.

---

## 7. SNS para Notificações

**Decisão**: Usar SNS em vez de EventBridge ou SQS.

**Raciocínio**:
- **Simplicidade**: SNS é mais simples de provisionar no CloudFormation.
- **Fan-out**: SNS permite múltiplos subscribers (útil se a equipe MVP quiser subscrever).
- **Adequado ao caso de uso**: Notificações de eventos pontuais (não filas de mensagens persistentes).
- **TCC académico**: Demonstra o padrão de mensageria sem complexidade excessiva.

---

## 8. KMS Customer Managed Key

**Decisão**: Usar CMK (Customer Managed Key) em vez de AWS Managed Key.

**Raciocínio**:
- **Demonstra boas práticas de segurança**: CMK é o padrão recomendado para dados sensíveis.
- **Controlo de políticas**: A política da CMK pode ser definida explicitamente no CloudFormation.
- **Rotação automática**: CMK suporta rotação anual automática.
- **Valor académico**: Demonstra conhecimento sobre gestão de chaves em ambientes cloud.

---

## Limites e Simplificações para TCC

As seguintes simplificações foram feitas conscientemente para manter o projecto elegante:

| Simplificação | Justificação | O que seria em produção |
|--------------|--------------|------------------------|
| Validação do JWT feita na Lambda (não no API Gateway Authorizer) | Simplicidade de CloudFormation | Custom Lambda Authorizer ou Cognito no API Gateway |
| Um único SNS Topic para todos os eventos | Simplicidade | Topics separados por tipo de evento |
| Lambda sem VPC | Simplicidade para TCC | Lambda dentro de VPC com endpoints S3/DynamoDB |
| Sem WAF no API Gateway | Fora do escopo do TCC | AWS WAF integrado ao API Gateway |
| Sem X-Ray tracing | Simplificação | AWS X-Ray em todas as Lambdas |
