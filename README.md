# Leitores Pique GSsync

Para hospedar com Docker no EasyPanel, siga o guia [EASYPANEL.md](EASYPANEL.md).

Interface do Leitor XML 3.0, com a identidade visual do GSsync GCONT.

## Iniciar

No PowerShell do Windows, com Node.js instalado, prepare e inicie o projeto:

```powershell
npm.cmd install --ignore-scripts
npm.cmd run setup:pdf
npm.cmd start
```

A opção `--ignore-scripts` evita que uma dependência auxiliar tente compilar um validador Java; a geração da DANFE usa o gerador JavaScript. `setup:pdf` instala a ligação nativa do `libxmljs2` usada pelo parser do Wizard.io.

Abra `http://127.0.0.1:4173` (não use uma prévia estática ou Live Server, pois o login depende do servidor Node deste projeto).

## Login e acessos

O login e os acessos são locais deste projeto; não usam usuários nem senhas do GSsync principal. Na primeira inicialização, o servidor cria somente o usuário `admin`. Uma senha aleatória é exibida uma única vez no terminal. Guarde-a para entrar no sistema. Para escolher a senha antes da primeira inicialização, defina `ADMIN_PASSWORD` no ambiente antes de executar `npm start`.

As contas ficam em `%LOCALAPPDATA%\LeitoresPiqueNotaSync\users.json`, fora da pasta pública do site; as senhas são armazenadas como hashes. O menu **Configurações** aparece apenas para administradores. Depois de entrar, o admin pode criar outros acessos, ativar ou desativar usuários e redefinir senhas. O servidor verifica a permissão de administrador em cada operação.

Em **Configurações**, o administrador também pode editar usuário, nome, perfil e status de qualquer conta, inclusive do admin principal, ou excluir contas. A exclusão encerra as sessões do usuário. O sistema impede desativar, rebaixar ou excluir o último administrador ativo.

## Leitores incluídos

- **NF-e:** uma busca por texto localiza notas, itens, clientes e produtos nos XMLs enviados; a ação **PDF** baixa a DANFE A4 em retrato gerada pelo NFeWizard-io.
- **NFS-e fiscal:** uma busca por texto localiza documentos, prestadores, tomadores e serviços.
- **DIFAL:** busca as NF-e enviadas e calcula o resultado com a alíquota interna informada.
- **CST 060:** busca as NF-e enviadas e confere o ICMS ST usando a alíquota interna informada, com alíquota de 4% para pneus.

Os quatro leitores aparecem como opções próprias no menu lateral, agrupados em **Leitor XML 3.0**, dentro da identidade **GCONT Gestão Contábil**. O importador compartilhado aceita múltiplos XMLs de NF-e, CT-e e NFS-e, além de arquivos de evento NF-e. Não é preciso selecionar empresa nem período: cada consulta parte dos XMLs enviados por upload. As consultas e conferências acontecem no navegador, e os arquivos importados ficam na memória da sessão. Ao atualizar ou fechar a página, eles são removidos. Para gerar uma DANFE, o XML da NF-e é enviado somente ao servidor local deste projeto, processado em memória pelo NFeWizard-io, e não é gravado em disco. O PDF fica temporariamente na pasta do sistema e é excluído depois de ser enviado ao navegador.

Os parsers e utilitários `xml-reader30-*` foram copiados do frontend NotaSync. A interface foi adaptada para upload local em vez de consulta ao acervo/API do NotaSync.

A geração de DANFE usa `@nfewizard/danfe`, distribuído sob a licença GPL-3.0; considere essa licença antes de redistribuir o projeto.
