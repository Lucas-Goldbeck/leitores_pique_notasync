# Leitores Pique NotaSync

Interface do Leitor XML 3.0, com a identidade visual do NotaSync GCONT.

## Iniciar

Com Node.js instalado, execute:

```bash
npm start
```

Abra `http://127.0.0.1:4173`. Não há dependências para instalar.

## Leitores incluídos

- **Dashboard:** total acumulado e da sessão, documentos carregados, operações recentes e estado de uso dos leitores. O acumulado é salvo no armazenamento local do navegador; o conteúdo e os nomes dos XMLs não são gravados.

- **NF-e:** resumo da nota e leitura item a item de produto, CFOP, CST e ICMS.
- **CT-e:** identificação do documento e componentes do serviço.
- **NFS-e fiscal:** campos de prestador, tomador, serviço, ISS e retenções, em XML nacional ou ABRASF.
- **DIFAL:** cálculo por dentro para compras com ICMS interestadual de 4%, usando a alíquota interna informada.
- **CST 060:** conferência do ICMS ST retido, com alíquota de 4% para pneus.

O leitor aceita múltiplos XMLs e arquivos de evento NF-e. O processamento acontece no navegador; os XMLs não são enviados ao servidor nem gravados em disco. Ao atualizar ou fechar a página, os arquivos importados são removidos da memória.

Os parsers e utilitários `xml-reader30-*` foram copiados do frontend NotaSync. A interface foi adaptada para upload local em vez de consulta ao acervo/API do NotaSync.
