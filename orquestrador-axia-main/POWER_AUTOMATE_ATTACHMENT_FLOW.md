# Power Automate — anexos do Orquestrador para o SharePoint

## Resultado esperado

Cada anexo incluído em uma atividade é enviado para `aline.valle@axia.com.br` com um contrato de roteamento no corpo do e-mail. O Flow cria esta estrutura na biblioteca de documentos:

```text
Orquestrador-Anexos/
  2026-08__Fechamento Fiscal__workflow-1/
    Eletrobras__Conferir balancete__activity-99/
      6fd9...__balancete-agosto.xlsx
```

O período, o nome e o ID tornam a pasta do workflow legível e única. A empresa, a atividade e o ID tornam a subpasta da atividade única. O UUID no arquivo impede colisões e permite identificar o mesmo envio em uma nova execução do Flow.

## Contrato recebido no e-mail

O assunto começa com:

```text
CHAVE|ENVIO=<uuid>|WORKFLOW=<id>|ATIVIDADE=<id>|PERIODO=<aaaa-mm>
```

O corpo contém uma chave por linha:

```text
CHAVE=AXIOM_ATTACHMENT
VERSAO=1
ENVIO_ID=<uuid>
WORKFLOW_ID=<id>
WORKFLOW_NOME=<nome>
WORKFLOW_PASTA=<pasta pronta>
ATIVIDADE_ID=<id>
ATIVIDADE_NOME=<nome>
ATIVIDADE_PASTA=<pasta pronta>
EMPRESA=<empresa>
PERIODO=<aaaa-mm>
ARQUIVO_NOME=<nome original>
ARQUIVO_CHAVE=<uuid>__<nome seguro>
SHAREPOINT_CAMINHO=<workflow>/<atividade>/<arquivo>
ENVIADO_POR=<e-mail do usuário>
```

## Montagem do Flow

1. Crie um fluxo automatizado usando a conexão real da Aline.
2. Use o gatilho **Office 365 Outlook — Quando um novo e-mail chega (V3)**:
   - Pasta: `Caixa de Entrada`.
   - Somente com anexos: `Sim`.
   - Incluir anexos: `Não`.
   - Filtro de assunto: `CHAVE|ENVIO=`.
3. Adicione **HTML para texto** usando o corpo do e-mail.
4. Crie ações **Compor** para obter `WORKFLOW_PASTA`, `ATIVIDADE_PASTA` e `ARQUIVO_CHAVE`. Exemplo (ajuste `Html_para_texto` para o nome interno da ação):

```text
trim(first(split(last(split(body('Html_para_texto'), 'WORKFLOW_PASTA=')), decodeUriComponent('%0A'))))
```

Repita a expressão trocando somente o nome da chave.

5. No SharePoint, use como caminho-base da biblioteca `Orquestrador-Anexos` e forme:

```text
Orquestrador-Anexos/<WORKFLOW_PASTA>/<ATIVIDADE_PASTA>
```

6. Consulte a pasta com **Obter metadados da pasta usando o caminho**. Configure **Criar nova pasta** para executar quando a consulta falhar. Passe o caminho completo da pasta do workflow e da atividade.
7. Em **Aplicar a cada**, percorra os anexos do gatilho:
   - ignore anexos embutidos (`IsInline = false`);
   - use **Obter anexo (V2)** com `ID da mensagem` e `ID do anexo`;
   - use **Criar arquivo** com a pasta calculada, `ARQUIVO_CHAVE` como nome e o conteúdo retornado por **Obter anexo (V2)**.
8. Opcionalmente consulte o arquivo pelo caminho antes de criá-lo. Se já existir, finalize esse item com sucesso. O UUID mantém esse teste estável em reprocessamentos.
9. Ao final, mova o e-mail para `Processados`. Em caso de falha, mova-o para `Erros` e avise o responsável pelo Flow.

## Envio de notificações como Gestão Contábil

`gestaocontabil@axia.com.br` não deve ser usado como usuário de login se ele é apenas uma chave/alias. Para utilizá-lo como remetente:

1. O administrador do Microsoft 365 deve configurá-lo como caixa compartilhada (ou confirmar que já é uma).
2. A conta real que mantém a conexão do Flow deve receber a permissão **Enviar como** para essa caixa.
3. No fluxo de notificações, use **Enviar um e-mail de uma caixa de correio compartilhada (V2)** e informe `gestaocontabil@axia.com.br`.

Se o app continuar enviando diretamente por SMTP ou Resend, o provedor também precisa autorizar esse remetente/domínio. Apenas preencher o endereço no campo `From` não concede essa permissão.
