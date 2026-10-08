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

4. Em **Storage**, crie um volume persistente e monte-o no caminho `/data`.
5. Em **Domains**, associe o domínio ao serviço usando o protocolo HTTP e a porta interna `4173`. O EasyPanel encaminha o tráfego HTTPS do domínio para essa porta.
6. Mantenha uma única réplica e desative implantação sem interrupção. As sessões ficam em memória e os usuários são armazenados em um arquivo local, portanto várias instâncias não compartilham uma sessão consistente.
7. Faça o deploy e confira os logs. O endpoint `https://seu-dominio/healthz` deve responder com `{"status":"ok"}`.

Configure backups para o volume `/data` no EasyPanel para preservar as contas em caso de falha do servidor.

## Recuperar a senha do administrador

Se perder o acesso, use a redefinição de inicialização para alterar a senha sem editar `/data/users.json` enquanto o servidor está rodando:

1. Atualize o serviço para esta versão do projeto.
2. Em **Environment**, defina `ADMIN_RESET_PASSWORD` com a nova senha. Se o usuário administrador tiver sido renomeado, defina também `ADMIN_RESET_USERNAME` com o nome atual da conta.
3. Faça um deploy. Na inicialização, o servidor atualiza o hash no volume `/data` antes de aceitar logins, preservando as outras contas.
4. Depois que a inicialização concluir, remova `ADMIN_RESET_PASSWORD` do ambiente e faça outro deploy. Se permanecer configurada, a variável reaplicará essa senha em cada reinicialização.
5. Entre com o nome configurado e a nova senha.

## Observações

- Não remova nem recrie o volume `/data` se quiser manter os usuários cadastrados.
- Alterar `ADMIN_PASSWORD` não redefine uma conta já criada. Para isso, use **Redefinir senha** em Configurações.
- As sessões ativas podem precisar entrar novamente após um novo deploy, pois são mantidas em memória.
- Use a opção de domínio do EasyPanel para HTTPS; não exponha a porta `4173` diretamente à internet.

Documentação oficial: [App Service](https://easypanel.io/docs/services/app).
