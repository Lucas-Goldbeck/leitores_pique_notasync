# Leitores Pique NotaSync

Interface do Leitor XML 3.0, com a identidade visual do NotaSync GCONT.

## Iniciar

No PowerShell do Windows, com Node.js instalado, execute na pasta do projeto:

```bash
npm.cmd start
```

Abra `http://127.0.0.1:4173` (não use uma prévia estática ou Live Server, pois o login depende do servidor Node deste projeto). Não há dependências para instalar.

## Login e acessos

O login e os acessos são locais deste projeto; não usam usuários nem senhas do NotaSync principal. Na primeira inicialização, o servidor cria somente o usuário `admin`. Uma senha aleatória é exibida uma única vez no terminal. Guarde-a para entrar no sistema. Para escolher a senha antes da primeira inicialização, defina `ADMIN_PASSWORD` no ambiente antes de executar `npm start`.

As contas ficam em `%LOCALAPPDATA%\LeitoresPiqueNotaSync\users.json`, fora da pasta pública do site; as senhas são armazenadas como hashes. O menu **Configurações** aparece apenas para administradores. Depois de entrar, o admin pode criar outros acessos, ativar ou desativar usuários e redefinir senhas. O servidor verifica a permissão de administrador em cada operação.

Em **Configurações**, o administrador também pode editar usuário, nome, perfil e status de qualquer conta, inclusive do admin principal, ou excluir contas. A exclusão encerra as sessões do usuário. O sistema impede desativar, rebaixar ou excluir o último administrador ativo.

## Leitores incluídos

- **NF-e:** uma busca por texto localiza notas, itens, clientes e produtos nos XMLs enviados.
- **NFS-e fiscal:** uma busca por texto localiza documentos, prestadores, tomadores e serviços.
- **DIFAL:** busca as NF-e enviadas e calcula o resultado com a alíquota interna informada.
- **CST 060:** busca as NF-e enviadas e confere o ICMS ST usando a alíquota interna informada, com alíquota de 4% para pneus.

Os quatro leitores aparecem como opções próprias no menu lateral, agrupados em **Leitor XML 3.0**, dentro da identidade **GCONT Gestão Contábil**. O importador compartilhado aceita múltiplos XMLs de NF-e, CT-e e NFS-e, além de arquivos de evento NF-e. Não é preciso selecionar empresa nem período: cada consulta parte dos XMLs enviados por upload. O processamento acontece no navegador; os XMLs não são enviados ao servidor nem gravados em disco. Ao atualizar ou fechar a página, os arquivos importados são removidos da memória.

Os parsers e utilitários `xml-reader30-*` foram copiados do frontend NotaSync. A interface foi adaptada para upload local em vez de consulta ao acervo/API do NotaSync.
