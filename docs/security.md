# Modelo de Segurança e Isolamento Multi-Tenant

## Princípios de Segurança

O sistema adopta os seguintes princípios de segurança:

1. **Menor privilégio**: Cada Lambda tem apenas as permissões estritamente necessárias.
2. **Encriptação em repouso**: Todos os dados armazenados são encriptados com KMS CMK.
3. **Encriptação em trânsito**: Todas as comunicações usam HTTPS/TLS.
4. **Isolamento por tenant**: Políticas IAM impedem acesso cross-tenant a nível de prefixo S3.
5. **Eliminação lógica**: Documentos "eliminados" permanecem no S3 para auditoria.

---

## Camadas de Segurança

```
┌────────────────────────────────────────────────────────────┐
│  Camada 1: API Gateway                                     │
│  • Validação de presença do JWT (401 se ausente)           │
│  • HTTPS obrigatório                                       │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  Camada 2: Lambda Access Verifier                          │
│  • Validação da assinatura do JWT                          │
│  • Extracção de tenantId e userId                          │
│  • Verificação de tenant mismatch                          │
│  • Geração de Pre-signed URL limitada ao prefixo do tenant │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  Camada 3: IAM Policies (aplicadas a nível AWS)            │
│  • Role da Lambda restrita ao prefixo {tenantId}/*         │
│  • Deny explícito em recursos fora do prefixo              │
│  • Permissões mínimas por serviço                          │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  Camada 4: Encriptação (KMS)                               │
│  • SSE-KMS em todos os buckets S3                          │
│  • Encriptação DynamoDB em repouso                         │
│  • Rotação automática anual da chave                       │
└────────────────────────────────────────────────────────────┘
```

---

## IAM Roles por Lambda

### Lambda Access Verifier Role

```yaml
Permissões concedidas:
  - s3:GetObject          → apenas prefixo {tenantId}/*
  - s3:PutObject          → apenas prefixo {tenantId}/*
  - kms:GenerateDataKey   → KMS_Key ARN
  - kms:Decrypt           → KMS_Key ARN
  - logs:CreateLogStream  → CloudWatch_LogGroup ARN
  - logs:PutLogEvents     → CloudWatch_LogGroup ARN

Deny explícito:
  - s3:* em qualquer prefixo que não corresponda ao tenantId do JWT
```

### Lambda Metadata Handler Role

```yaml
Permissões concedidas:
  - dynamodb:GetItem      → DynamoDB_Table ARN
  - dynamodb:PutItem      → DynamoDB_Table ARN
  - dynamodb:UpdateItem   → DynamoDB_Table ARN
  - dynamodb:Query        → DynamoDB_Table ARN + GSI ARN
  - kms:GenerateDataKey   → KMS_Key ARN
  - kms:Decrypt           → KMS_Key ARN
  - sns:Publish           → SNS_Topic ARN
  - logs:CreateLogStream  → CloudWatch_LogGroup ARN
  - logs:PutLogEvents     → CloudWatch_LogGroup ARN
```

### Lambda Archive Trigger Role

```yaml
Permissões concedidas:
  - dynamodb:UpdateItem   → DynamoDB_Table ARN
  - sns:Publish           → SNS_Topic ARN
  - logs:CreateLogStream  → CloudWatch_LogGroup ARN
  - logs:PutLogEvents     → CloudWatch_LogGroup ARN
```

---

## Isolamento Multi-Tenant

### Como funciona o isolamento

1. **JWT → tenantId**: O JWT emitido pelo Supabase contém um claim customizado `tenantId`.
2. **Lambda extrai tenantId**: A Lambda Access Verifier lê o claim do JWT sem fazer chamadas externas.
3. **Pre-signed URL restrita**: A URL gerada aponta para `s3://{bucket}/{tenantId}/{documentId}/...` — o cliente não pode mudar o prefixo.
4. **IAM condition**: A Role da Lambda usa `s3:prefix` condition para que mesmo que a Lambda tente aceder a outro prefixo, a AWS negará a operação.

### Exemplo de Condition IAM

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::docsaas-standard-simulation/*",
  "Condition": {
    "StringLike": {
      "s3:prefix": "${aws:PrincipalTag/tenantId}/*"
    }
  }
}
```

*Nota*: Em CloudFormation, esta condition é definida na política inline da IAM Role da Lambda.

---

## Auditoria e Rastreamento

Todos os eventos de acesso (aprovados e negados) são registados no CloudWatch com a seguinte estrutura JSON:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "requestId": "abc-123-def",
  "tenantId": "tenant_acme_corp",
  "userId": "user_abc123",
  "operation": "GENERATE_UPLOAD_URL",
  "documentId": "doc_01HK2X...",
  "status": "APPROVED",
  "reason": null
}
```

Para acessos negados:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "requestId": "abc-123-def",
  "tenantId": "tenant_acme_corp",
  "userId": "user_abc123",
  "operation": "GENERATE_DOWNLOAD_URL",
  "documentId": "doc_OUTRO_TENANT",
  "status": "DENIED",
  "reason": "tenant mismatch"
}
```

---

## Notas sobre Simulação vs Produção

Para fins de TCC (simulação), a validação do JWT é feita na Lambda sem um JWT secret real. Em produção:

| Aspecto | Simulação (TCC) | Produção |
|---------|----------------|----------|
| Validação JWT | Lambda verifica formato básico | Lambda verifica assinatura com chave pública Supabase |
| Secrets | Hardcoded no código Lambda para demo | AWS Secrets Manager |
| WAF | Não implementado | AWS WAF com rate limiting |
| VPC | Lambda fora de VPC | Lambda dentro de VPC privada |
| Endpoints | Públicos | VPC Endpoints para S3/DynamoDB |
