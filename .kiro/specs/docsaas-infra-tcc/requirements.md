# Requirements Document

## Introduction

Este documento descreve os requisitos da infraestrutura AWS para um SaaS de gestão de documentos, desenvolvida como Trabalho de Conclusão de Curso (TCC). A responsabilidade desta equipe é a camada de infraestrutura serverless na AWS, provisionada exclusivamente via CloudFormation, que serve como backend de armazenamento e processamento de documentos para uma aplicação SaaS multi-tenant.

A arquitectura é dividida em dois domínios:

- **Equipe MVP/Aplicação** (fora do escopo deste spec): React + TypeScript (frontend), Node.js/Express (backend de regras de negócio), Supabase Auth (autenticação e gestão de `userId`) e Supabase PostgreSQL (dados de conta, planos e permissões SaaS).
- **Equipe CloudFormation** (escopo deste spec): Amazon API Gateway, AWS Lambda, Amazon S3 (Standard e Glacier Deep Archive), Amazon DynamoDB, AWS KMS, AWS IAM, Amazon CloudWatch e Amazon SNS.

O sistema NÃO realiza deploy real em produção. O objetivo é simular o funcionamento completo da infraestrutura para fins académicos, com código CloudFormation bem estruturado e documentado.

---

## Glossary

- **TCC_Infra**: O sistema de infraestrutura AWS descrito neste documento.
- **Tenant**: Organização ou utilizador pagante que utiliza o SaaS; identificado por um `tenantId`.
- **userId**: Identificador único do utilizador autenticado, emitido pelo Supabase Auth e presente no JWT.
- **tenantId**: Identificador único da organização/tenant, derivado do JWT emitido pelo Supabase Auth.
- **documentId**: Identificador único de um documento armazenado no sistema.
- **JWT**: JSON Web Token emitido pelo Supabase Auth, utilizado para autenticar requisições ao API Gateway.
- **Pre-signed URL**: URL temporária gerada pela AWS que permite upload ou download directo de um objecto no S3 sem expor credenciais.
- **Metadado**: Informação estruturada sobre um documento (nome, tipo, tamanho, datas, estado) armazenada no DynamoDB.
- **Stack CloudFormation**: Conjunto de recursos AWS provisionados e geridos como uma unidade via CloudFormation.
- **Lambda_Access_Verifier**: Função Lambda responsável por verificar o JWT e as permissões de acesso do tenant antes de emitir uma Pre-signed URL.
- **Lambda_Metadata_Handler**: Função Lambda responsável por gerir operações CRUD de metadados de documentos no DynamoDB.
- **Lambda_Archive_Trigger**: Função Lambda responsável por mover documentos do S3 Standard para o S3 Glacier Deep Archive após 365 dias.
- **API_Gateway**: Amazon API Gateway que serve como ponto de entrada REST para todas as requisições de documentos.
- **S3_Standard_Bucket**: Bucket S3 com classe de armazenamento Standard para documentos com menos de 365 dias.
- **S3_Glacier_Bucket**: Bucket S3 com classe de armazenamento Glacier Deep Archive para documentos com mais de 365 dias.
- **DynamoDB_Table**: Tabela DynamoDB que armazena metadados dos documentos.
- **KMS_Key**: Chave AWS KMS utilizada para encriptar dados em repouso no S3 e no DynamoDB.
- **SNS_Topic**: Tópico Amazon SNS utilizado para publicar notificações sobre eventos de processamento de documentos.
- **CloudWatch_LogGroup**: Grupo de logs no Amazon CloudWatch que centraliza os logs de todas as funções Lambda.
- **IAM_Policy**: Política AWS IAM que define permissões com isolamento multi-tenant.
- **Lifecycle_Policy**: Política de ciclo de vida do S3 que automatiza a transição de objectos entre classes de armazenamento.

---

## Requirements

### Requirement 1: Ponto de Entrada REST via API Gateway

**User Story:** Como equipe de aplicação (Node.js/Express), quero um endpoint REST seguro para enviar e receber requisições de documentos, para que o backend da aplicação possa integrar com a infraestrutura AWS sem gerir credenciais AWS directamente.

#### Acceptance Criteria

1. THE API_Gateway SHALL expor endpoints REST para as operações: geração de Pre-signed URL de upload, geração de Pre-signed URL de download, listagem de metadados de documentos e eliminação lógica de documentos.
2. WHEN uma requisição HTTP chega ao API_Gateway, THE API_Gateway SHALL validar a presença do cabeçalho `Authorization` com um JWT antes de encaminhar a requisição para a Lambda correspondente.
3. IF o cabeçalho `Authorization` estiver ausente ou malformado, THEN THE API_Gateway SHALL retornar uma resposta HTTP 401 com uma mensagem de erro descritiva.
4. THE API_Gateway SHALL encaminhar o JWT não modificado para a Lambda_Access_Verifier para validação de permissões.
5. WHEN a Lambda retorna uma resposta, THE API_Gateway SHALL repassar o corpo e o código HTTP da resposta para o cliente sem modificação.
6. THE API_Gateway SHALL ser provisionado via CloudFormation com um Stage denominado `simulation`.

---

### Requirement 2: Verificação de Acesso e Geração de Pre-signed URL

**User Story:** Como utilizador autenticado de um tenant, quero fazer upload e download de documentos de forma segura, para que os meus documentos sejam armazenados e recuperados com isolamento do meu tenant.

#### Acceptance Criteria

1. WHEN a Lambda_Access_Verifier recebe uma requisição de upload, THE Lambda_Access_Verifier SHALL verificar o `tenantId` e o `userId` extraídos do JWT antes de gerar qualquer Pre-signed URL.
2. WHEN o JWT é válido e o tenant possui permissão de escrita, THE Lambda_Access_Verifier SHALL gerar uma Pre-signed URL de upload para o S3_Standard_Bucket com expiração de 900 segundos.
3. WHEN o JWT é válido e o tenant possui permissão de leitura, THE Lambda_Access_Verifier SHALL gerar uma Pre-signed URL de download para o S3_Standard_Bucket ou S3_Glacier_Bucket conforme a localização actual do documento.
4. IF o JWT for inválido ou expirado, THEN THE Lambda_Access_Verifier SHALL retornar HTTP 403 com a mensagem `"Access denied: invalid token"`.
5. IF o `tenantId` extraído do JWT não corresponder ao `tenantId` associado ao `documentId` solicitado, THEN THE Lambda_Access_Verifier SHALL retornar HTTP 403 com a mensagem `"Access denied: tenant mismatch"`.
6. THE Lambda_Access_Verifier SHALL utilizar a KMS_Key para assinar operações criptográficas quando necessário.
7. THE Lambda_Access_Verifier SHALL registar cada decisão de acesso (aprovado ou negado) no CloudWatch_LogGroup com o `tenantId`, `userId` e `documentId`.

---

### Requirement 3: Armazenamento de Documentos no S3 Standard

**User Story:** Como utilizador do SaaS, quero que os meus documentos sejam armazenados de forma segura e isolada por tenant, para que eu possa aceder aos meus ficheiros com garantia de privacidade.

#### Acceptance Criteria

1. THE S3_Standard_Bucket SHALL armazenar todos os documentos com uma estrutura de prefixo no formato `{tenantId}/{documentId}/{filename}` para garantir isolamento por tenant.
2. THE S3_Standard_Bucket SHALL ter encriptação server-side activada utilizando a KMS_Key.
3. THE S3_Standard_Bucket SHALL ter versionamento de objectos activado.
4. THE S3_Standard_Bucket SHALL ter bloqueio de acesso público (Block Public Access) completamente activado.
5. WHEN um objecto permanece no S3_Standard_Bucket por mais de 365 dias, THE S3_Standard_Bucket SHALL aplicar a Lifecycle_Policy para transitar o objecto para o S3_Glacier_Bucket automaticamente.
6. THE S3_Standard_Bucket SHALL ser provisionado via CloudFormation com todos os atributos acima definidos como código.

---

### Requirement 4: Arquivamento Frio no S3 Glacier Deep Archive

**User Story:** Como gestor do SaaS, quero que documentos antigos sejam arquivados automaticamente para reduzir custos, para que o sistema mantenha retenção histórica sem aumentar custos de armazenamento activo.

#### Acceptance Criteria

1. THE S3_Glacier_Bucket SHALL armazenar documentos com mais de 365 dias em classe de armazenamento Glacier Deep Archive.
2. THE S3_Glacier_Bucket SHALL manter a mesma estrutura de prefixo `{tenantId}/{documentId}/{filename}` do S3_Standard_Bucket.
3. THE S3_Glacier_Bucket SHALL ter encriptação server-side activada utilizando a KMS_Key.
4. THE S3_Glacier_Bucket SHALL ter bloqueio de acesso público (Block Public Access) completamente activado.
5. WHEN um documento é transitado para o S3_Glacier_Bucket, THE Lambda_Archive_Trigger SHALL actualizar o metadado `storageClass` do documento no DynamoDB_Table para o valor `"GLACIER"`.
6. WHEN um documento é transitado para o S3_Glacier_Bucket, THE Lambda_Archive_Trigger SHALL publicar uma notificação no SNS_Topic com o `tenantId`, `documentId` e a data de transição.

---

### Requirement 5: Gestão de Metadados no DynamoDB

**User Story:** Como equipe de aplicação, quero consultar e gerir metadados de documentos via API, para que o frontend possa listar, filtrar e apresentar informações sobre os documentos do utilizador.

#### Acceptance Criteria

1. THE DynamoDB_Table SHALL armazenar para cada documento os atributos: `documentId` (partition key), `tenantId` (sort key), `userId`, `filename`, `contentType`, `sizeBytes`, `uploadedAt`, `storageClass`, `s3Key` e `deleted`.
2. WHEN a Lambda_Metadata_Handler recebe uma requisição de criação de metadado, THE Lambda_Metadata_Handler SHALL escrever o item no DynamoDB_Table com o atributo `deleted` igual a `false` e `storageClass` igual a `"STANDARD"`.
3. WHEN a Lambda_Metadata_Handler recebe uma requisição de listagem, THE Lambda_Metadata_Handler SHALL retornar apenas os documentos onde `tenantId` corresponde ao JWT e `deleted` é `false`.
4. WHEN a Lambda_Metadata_Handler recebe uma requisição de eliminação lógica, THE Lambda_Metadata_Handler SHALL actualizar o atributo `deleted` para `true` sem remover o item do DynamoDB_Table.
5. IF uma operação de escrita ou leitura no DynamoDB_Table falhar, THEN THE Lambda_Metadata_Handler SHALL registar o erro no CloudWatch_LogGroup e retornar HTTP 500 com mensagem `"Internal error: metadata operation failed"`.
6. THE DynamoDB_Table SHALL ter encriptação em repouso activada utilizando a KMS_Key.
7. THE DynamoDB_Table SHALL ter Point-in-Time Recovery (PITR) activado.

---

### Requirement 6: Encriptação e Gestão de Chaves com KMS

**User Story:** Como responsável de segurança do TCC, quero que todos os dados em repouso sejam encriptados com chaves geridas, para que o sistema demonstre boas práticas de segurança em ambientes multi-tenant.

#### Acceptance Criteria

1. THE KMS_Key SHALL ser uma chave Customer Managed Key (CMK) provisionada via CloudFormation.
2. THE KMS_Key SHALL ser utilizada para encriptação do S3_Standard_Bucket, S3_Glacier_Bucket e DynamoDB_Table.
3. THE KMS_Key SHALL ter rotação automática anual activada.
4. THE IAM_Policy associada à KMS_Key SHALL permitir uso da chave apenas para as funções Lambda e para os serviços S3 e DynamoDB dentro da mesma Stack CloudFormation.
5. IF uma operação de encriptação ou desencriptação falhar por falta de permissão, THEN THE Lambda_Access_Verifier SHALL registar o erro no CloudWatch_LogGroup e retornar HTTP 500.

---

### Requirement 7: Isolamento Multi-Tenant via IAM

**User Story:** Como arquitecto do sistema, quero que as políticas IAM garantam isolamento entre tenants, para que um tenant nunca possa aceder aos documentos de outro tenant.

#### Acceptance Criteria

1. THE IAM_Policy para cada Lambda SHALL seguir o princípio do menor privilégio, concedendo apenas as permissões necessárias para as operações declaradas neste documento.
2. THE Lambda_Access_Verifier SHALL utilizar uma IAM_Policy que restringe o acesso ao S3_Standard_Bucket e S3_Glacier_Bucket ao prefixo `{tenantId}/*` derivado do JWT validado na requisição.
3. THE IAM_Policy SHALL negar explicitamente acesso cross-tenant através de condições `aws:RequestedRegion` e prefixos S3.
4. THE IAM_Policy de cada Lambda SHALL ser provisionada via CloudFormation como um recurso `AWS::IAM::Role` com política inline.
5. WHEN uma Lambda tenta aceder a um recurso fora do prefixo do seu tenant, THE IAM_Policy SHALL negar a operação e registar a tentativa no CloudWatch_LogGroup.

---

### Requirement 8: Monitorização e Logs com CloudWatch

**User Story:** Como desenvolvedor do TCC, quero logs estruturados de todas as operações, para que eu possa demonstrar o rastreamento de actividades e depurar o sistema durante a apresentação.

#### Acceptance Criteria

1. THE CloudWatch_LogGroup SHALL centralizar logs de todas as funções Lambda com um período de retenção de 30 dias.
2. WHEN qualquer Lambda é invocada, THE Lambda SHALL registar um log estruturado em JSON com os campos: `timestamp`, `requestId`, `tenantId`, `userId`, `operation` e `status`.
3. WHEN uma operação falha, THE Lambda SHALL registar o log de erro com o campo `errorMessage` e o stack trace da excepção.
4. THE CloudWatch_LogGroup SHALL ser provisionado via CloudFormation com o período de retenção de 30 dias definido como código.
5. WHERE monitorização de métricas é necessária, THE TCC_Infra SHALL provisionar um CloudWatch Dashboard via CloudFormation com métricas de invocações Lambda, erros e latência.

---

### Requirement 9: Notificações via SNS

**User Story:** Como equipe de aplicação, quero receber notificações sobre eventos de processamento de documentos, para que o backend Node.js possa reagir a transições de armazenamento e informar o utilizador.

#### Acceptance Criteria

1. THE SNS_Topic SHALL receber publicações para os seguintes eventos: documento enviado com sucesso (`UPLOADED`), documento transitado para Glacier (`ARCHIVED`) e erro no processamento (`ERROR`).
2. WHEN a Lambda_Archive_Trigger transita um documento para o S3_Glacier_Bucket, THE Lambda_Archive_Trigger SHALL publicar uma mensagem no SNS_Topic com o schema: `{ "event": "ARCHIVED", "tenantId": "...", "documentId": "...", "archivedAt": "..." }`.
3. WHEN a Lambda_Metadata_Handler cria um metadado com sucesso, THE Lambda_Metadata_Handler SHALL publicar uma mensagem no SNS_Topic com o schema: `{ "event": "UPLOADED", "tenantId": "...", "documentId": "...", "uploadedAt": "..." }`.
4. IF qualquer Lambda encontrar um erro crítico, THEN THE Lambda SHALL publicar uma mensagem no SNS_Topic com o schema: `{ "event": "ERROR", "tenantId": "...", "documentId": "...", "errorMessage": "..." }`.
5. THE SNS_Topic SHALL ser provisionado via CloudFormation e a sua ARN SHALL ser disponibilizada como Output da Stack CloudFormation.

---

### Requirement 10: Estrutura e Organização do Código CloudFormation

**User Story:** Como avaliador do TCC, quero que o código CloudFormation seja bem organizado e documentado, para que a arquitectura seja compreensível e demonstre boas práticas de IaC (Infrastructure as Code).

#### Acceptance Criteria

1. THE TCC_Infra SHALL organizar o código CloudFormation em templates separados por domínio: `storage.yaml` (S3 e KMS), `database.yaml` (DynamoDB), `compute.yaml` (Lambda), `api.yaml` (API Gateway), `iam.yaml` (IAM Roles e Policies), `monitoring.yaml` (CloudWatch e SNS) e `main.yaml` (template raiz com nested stacks).
2. THE TCC_Infra SHALL utilizar nested stacks CloudFormation para compor o `main.yaml` a partir dos templates de domínio.
3. THE TCC_Infra SHALL definir parâmetros CloudFormation para: `Environment` (ex: `simulation`), `ProjectName` (ex: `docsaas`), `RetentionDays` (padrão: `30`) e `ArchiveDays` (padrão: `365`).
4. THE TCC_Infra SHALL exportar Outputs CloudFormation para todos os recursos partilhados entre stacks: ARN da KMS_Key, ARN do SNS_Topic, nome do S3_Standard_Bucket, nome do S3_Glacier_Bucket, nome da DynamoDB_Table e URL do API_Gateway.
5. THE TCC_Infra SHALL incluir comentários em cada template CloudFormation explicando o propósito de cada recurso.
6. THE TCC_Infra SHALL incluir um ficheiro `README.md` na raiz do projecto com diagrama de arquitectura em texto (ASCII art ou Mermaid), instruções de como validar os templates com `aws cloudformation validate-template` e descrição de cada template e recurso.
