# Setup: Supabase + SharePoint

Este projeto foi preparado para usar:

- `Supabase` como banco principal
- `SharePoint Document Library` para anexos
- `Flask` como API intermediaria
- `React + Vite` como frontend

## 1. Subir o schema no Supabase

No painel do Supabase:

1. Abra `SQL Editor`
2. Cole o conteudo de:
   - `C:\Users\fabio\Documents\Projeto_Axiom\supabase\schema.sql`
3. Execute

Isso vai criar:

- `app_users`
- `workflows`
- `workflow_participants`
- `activities`
- `activity_history`
- views auxiliares para dashboard e fila do usuario
- `RLS` com politicas restritivas

## 2. Criar usuarios no Supabase Auth

No painel do Supabase:

1. Abra `Authentication > Users`
2. Crie os usuarios que vao usar o sistema
3. Para cada usuario criado, insira um registro correspondente em `app_users`

Exemplo:

```sql
insert into public.app_users (id, email, full_name, area, role_name, is_active, is_online)
values
  ('UUID_DO_AUTH_USER', 'aline.valle@empresa.com', 'Aline Valle', 'Recebimento', 'ResponsavelRecebimento', true, true);
```

## 3. Variaveis do backend

Copie:

- `C:\Users\fabio\Documents\Projeto_Axiom\backend\.env.example`

para:

- `C:\Users\fabio\Documents\Projeto_Axiom\backend\.env`

Preencha:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SHAREPOINT_TENANT_ID`
- `SHAREPOINT_CLIENT_ID`
- `SHAREPOINT_CLIENT_SECRET`
- `SHAREPOINT_HOSTNAME`
- `SHAREPOINT_SITE_PATH`
- `SHAREPOINT_DOCUMENT_LIBRARY`
- `SHAREPOINT_UPLOAD_FOLDER`

## 4. Preparar SharePoint para anexos

Voce vai precisar:

1. Criar ou escolher uma biblioteca de documentos
2. Criar um `App Registration` no Azure
3. Dar permissao Microsoft Graph para escrita em SharePoint
4. Gerar `client secret`

O backend faz upload por:

- `workflow`
- `atividade`

Exemplo de pasta final:

```text
orquestrador-anexos/Fechamento_Agosto/Relatorio_de_Contingencia/arquivo.pdf
```

## 5. Rodar localmente

### Frontend

```powershell
cd C:\Users\fabio\Documents\Projeto_Axiom
npm install
npm run dev:frontend
```

### Backend

```powershell
cd C:\Users\fabio\Documents\Projeto_Axiom
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
python backend\run.py
```

## 6. Desenvolvimento sem login real

Enquanto o login do Supabase nao estiver plugado no frontend, voce pode testar a API com:

- header `X-Dev-User-Email`

Isso ja esta previsto no backend para facilitar desenvolvimento local.

## 7. Proximo passo recomendado

Depois da base pronta, o ideal e:

1. ligar o frontend aos endpoints reais
2. trocar os mocks do React por dados do Supabase
3. autenticar com Supabase Auth
4. ativar upload real para SharePoint
5. montar dashboard/BI em cima das tabelas
