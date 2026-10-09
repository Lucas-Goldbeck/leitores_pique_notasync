# Hospedar no EasyPanel

O projeto já inclui `Dockerfile` e `.dockerignore`. O container escuta na porta `4173`, usa o endpoint `/healthz` para verificação de saúde e grava as contas em `/data/users.json`.

## Criar e configurar o serviço

1. No EasyPanel, crie um serviço do tipo **App** e conecte o repositório ou envie um arquivo compactado do projeto.
2. Na seção **Build**, selecione **Dockerfile** e use `/Dockerfile` como caminho.
3. Em **Environment**, configure:

   ```env
   NODE_ENV=production
   PORT=4173
   HOST=0.0.0.0
   DATA_DIR=/data
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=SUBSTITUA_POR_UM_SEGREDO_FORTE
   ```

   Defina `ADMIN_PASSWORD` como um segredo no EasyPanel. Ela é usada somente quando o arquivo de usuários ainda não existe. A conta e os dados são mantidos no volume depois da primeira inicialização.

4. Faça o deploy. Na inicialização, o servidor cria o schema privado e as tabelas de contas e sessões. Se `app_private.users` estiver vazia e houver `/data/users.json`, as contas existentes são importadas; se não houver arquivo, o administrador inicial é criado.
5. Em **Domains**, associe o domínio ao serviço usando o protocolo HTTP e a porta interna `4173`. O EasyPanel encaminha o tráfego HTTPS do domínio para essa porta.
6. Mantenha uma única réplica e desative implantação sem interrupção. As contas e o histórico de login ficam no Supabase; os tokens das sessões ativas ficam em memória.
7. Faça o deploy e confira os logs. O endpoint `https://seu-dominio/healthz` deve responder com `{"status":"ok"}`.

Configure backups para o volume `/data` no EasyPanel para preservar as contas em caso de falha do servidor.

## Banco de dados Supabase

O script [schema.sql](supabase/schema.sql) cria as tabelas privadas `app_private.users` e `app_private.login_sessions`. O servidor também executa esse script automaticamente ao iniciar com `DATABASE_URL` configurada.

O certificado raiz oficial do Supabase fica em `certs/supabase-ca.crt` e é incluído na imagem Docker pelo `COPY . .` do Dockerfile. O servidor acrescenta `sslmode=verify-full` e `sslrootcert` à conexão: o TLS valida a cadeia usando esse CA e também confere o hostname do Session Pooler. Não é necessário configurar o certificado como variável de ambiente. Se o Supabase substituir o CA, atualize esse arquivo e faça um novo build e deploy.

1. No painel Supabase, abra **Connect** e copie a connection string de **Session Pooler** (Shared Pooler, Session mode). Use o host, usuário e a porta `5432` fornecidos pelo painel; para o pooler compartilhado, o usuário normalmente inclui o project ref, como `postgres.[PROJECT-REF]`.
2. Troque `[YOUR-PASSWORD]` pela senha do banco. Se ela tiver caracteres especiais, use a versão percent-encoded na URI.
3. No EasyPanel, adicione `DATABASE_URL` em **Environment** e marque o valor como segredo. Cole a connection string completa. Não coloque-a no código, em arquivos versionados ou no navegador.
4. Faça o deploy. Na inicialização, o servidor cria o schema privado e as tabelas de contas e sessões. Se `app_private.users` estiver vazia e houver `/data/users.json`, as contas existentes são importadas; se não houver arquivo, o administrador inicial é criado.

O banco armazena contas, hashes de senha, último login, tempo total e histórico por sessão. Os XMLs importados continuam somente no navegador e não são enviados ao Supabase. Os tokens de sessão ativa ficam em memória, por isso mantenha uma única réplica no EasyPanel. O volume `/data` pode continuar ativo como cópia local e fonte de migração.

## Recuperar a senha do administrador

Se perder o acesso, use a redefinição de inicialização para alterar a senha sem editar `/data/users.json` enquanto o servidor está rodando:

1. Atualize o serviço para esta versão do projeto.
2. Em **Environment**, defina `ADMIN_RESET_PASSWORD` com a nova senha. Se o usuário administrador tiver sido renomeado, defina também `ADMIN_RESET_USERNAME` com o nome atual da conta.
3. Faça um deploy. Na inicialização, o servidor atualiza o hash no volume `/data` antes de aceitar logins, preservando as outras contas.
4. Faça o deploy. Na inicialização, o servidor cria o schema privado e as tabelas de contas e sessões. Se `app_private.users` estiver vazia e houver `/data/users.json`, as contas existentes são importadas; se não houver arquivo, o administrador inicial é criado.
5. Entre com o nome configurado e a nova senha.

## Observações

- Não remova nem recrie o volume `/data` se quiser manter os usuários cadastrados.
- Alterar `ADMIN_PASSWORD` não redefine uma conta já criada. Para isso, use **Redefinir senha** em Configurações.
- As sessões ativas podem precisar entrar novamente após um novo deploy, pois são mantidas em memória.
- Use a opção de domínio do EasyPanel para HTTPS; não exponha a porta `4173` diretamente à internet.

Documentação oficial: [App Service](https://easypanel.io/docs/services/app).
