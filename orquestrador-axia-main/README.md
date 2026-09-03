# Projeto Axiom

Aplicacao web para migracao do fluxo operacional hoje existente em PowerApps para:

- `React + Vite` no frontend
- `Flask` no backend
- `Supabase` para auth e banco
- `Supabase Storage` para anexos confidenciais

## O que foi estruturado

- login real com `Supabase Auth`
- fluxo de primeiro acesso com senha temporaria enviada por e-mail
- perfil de usuario com `admin` e `user`
- workflows com atividades instanciadas
- base reutilizavel de templates de atividade
- dependencias entre atividades
- anexos privados no `Supabase Storage` com metadados no banco
- auditoria centralizada em `audit_logs`
- configuracoes administrativas de usuarios e responsaveis por etapa
- RLS nas tabelas relevantes

## Frontend

Variaveis em `.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:5000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Comandos:

```powershell
npm.cmd install
npm.cmd run dev:frontend
npm.cmd run build
npm.cmd run lint
```

## Backend

Variaveis em `backend/.env`:

```env
FLASK_DEBUG=true
APP_HOST=127.0.0.1
APP_PORT=5000
FRONTEND_URL=http://127.0.0.1:5173
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_SCHEMA=public
SUPABASE_STORAGE_BUCKET=workflow-attachments
SUPABASE_STORAGE_SIGNED_URL_TTL=3600
ATTACHMENT_PROVIDER=supabase

SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USERNAME=mailer@empresa.com
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=mailer@empresa.com
SMTP_FROM_NAME=Projeto Axiom
SMTP_USE_TLS=true
SMTP_REDIRECT_TO=

## SharePoint opcional

Se voce quiser manter um fallback para SharePoint, troque `ATTACHMENT_PROVIDER=sharepoint` e configure:

```env
SHAREPOINT_TENANT_ID=your-tenant-id
SHAREPOINT_CLIENT_ID=your-client-id
SHAREPOINT_CLIENT_SECRET=your-client-secret
SHAREPOINT_HOSTNAME=yourcompany.sharepoint.com
SHAREPOINT_SITE_PATH=/sites/Financeiro
SHAREPOINT_DOCUMENT_LIBRARY=Documentos
SHAREPOINT_UPLOAD_FOLDER=orquestrador-anexos
```

Comandos:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
python backend\run.py
```

## Banco / Supabase

Execute um destes arquivos no SQL Editor do Supabase:

- `supabase/schema.sql`
- `supabase/migrations/20260816_workflow_rebuild.sql`

## Observacoes

- o frontend depende de usuarios existentes no `Supabase Auth` e seus perfis em `public.user_profiles`
- o backend usa JWT do usuario nas tabelas de negocio para aproveitar RLS e usa `service role` apenas em operacoes administrativas
- as policies de `storage.objects` assumem bucket privado `workflow-attachments`
- o fluxo de primeiro acesso continua sem enumerar usuarios e registra auditoria do envio de senha temporaria
