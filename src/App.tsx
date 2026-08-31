import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { api } from './lib/api'
import { supabase } from './lib/supabase'
import orquestradorLogo from './assets/orquestrador-logo.jpeg'
import './App.css'

type Profile = {
  id: string
  email: string
  name: string
  role: string
  is_admin: boolean
  first_login_required: boolean
}

type UserOption = {
  id: string
  email: string
  name: string
  role: string
  area?: string | null
  team_name?: string | null
  team_email?: string | null
  is_active: boolean
  first_login_required: boolean
}

type Workflow = {
  id: string
  name: string
  description?: string | null
  routine: string
  month: number
  year: number
  last_business_day: string
  start_date: string
  expected_end_date: string
  status: 'Nao iniciado' | 'Em andamento' | 'Concluido' | string
  is_active?: boolean
  activity_totals: {
    completed: number
    in_progress: number
    total: number
  }
}

type UserRef = {
  id: string
  name: string
  email: string
  area?: string | null
  team_name?: string | null
}

type WorkflowActivity = {
  id: string
  workflow_id: string
  activity_template_id?: string | null
  name_snapshot: string
  stage_snapshot: string
  routine_snapshot: string
  responsible_user_id?: string | null
  responsible_backup_user_id?: string | null
  requires_attachment_snapshot: boolean
  requires_approval_snapshot: boolean
  approver_user_id?: string | null
  start_date: string
  expected_end_date: string
  company_snapshot?: string | null
  deadline_type?: 'business_days' | 'fixed_date'
  deadline_days?: number | null
  notify_team?: boolean
  team_email_snapshot?: string | null
  status: string
  approval_status: string
  completed_at?: string | null
  dependencies: Array<{ depends_on_workflow_activity_id: string }>
  attachments: Array<{ id: string; file_name: string; file_url?: string }>
  responsible_user?: UserRef | null
  responsible_backup_user?: UserRef | null
  approver_user?: UserRef | null
}

type ActivityTemplate = {
  id: string
  name: string
  stage: string
  routine: string
  responsible_user_id?: string | null
  responsible_backup_user_id?: string | null
  requires_attachment: boolean
  requires_approval: boolean
  approver_user_id?: string | null
  start_date?: string | null
  expected_end_date?: string | null
  company?: string | null
  dependencies: Array<{ depends_on_template_id: string }>
}

type StageSetting = {
  id: string
  stage_name: string
  default_responsible_user_id?: string | null
  default_backup_user_id?: string | null
}

type AuditLog = {
  id: string
  user_id?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  workflow_id?: string | null
  details?: Record<string, unknown>
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  created_at: string
  actor_user?: UserRef | null
}

type NamedRegistry = { id: string; name: string; email?: string | null; is_active: boolean }

type RefreshDomain = 'workflows' | 'templates' | 'users' | 'logs' | 'stageSettings' | 'companies' | 'teams' | 'directorates'

type AppContextShape = {
  session: Session | null
  profile: Profile | null
  token: string | null
  workflows: Workflow[]
  templates: ActivityTemplate[]
  users: UserOption[]
  companies: Array<{ id: string; name: string; is_active: boolean }>
  teams: NamedRegistry[]
  directorates: NamedRegistry[]
  stageSettings: StageSetting[]
  logs: AuditLog[]
  selectedWorkflowId: string | null
  selectedWorkflowActivities: WorkflowActivity[]
  error: string
  success: string
  setError: (value: string) => void
  setSuccess: (value: string) => void
  setSelectedWorkflowId: (value: string | null) => void
  refreshData: (domains: RefreshDomain[]) => Promise<void>
  refreshAll: () => Promise<void>
  refreshActivities: (workflowId: string | null) => Promise<void>
}

const STAGES = ['Recebimento', 'Contabilizacao', 'Apuracao', 'Consolidacao']
const ROUTINES = ['mensal', 'trimestral', 'semestral', 'anual']

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function stageLabel(stage: string) {
  return (
    {
      Recebimento: 'Recebimento',
      Contabilizacao: 'Contabilização',
      Apuracao: 'Apuração',
      Consolidacao: 'Consolidação',
    }[stage] || stage
  )
}

function routineLabel(routine: string) {
  return routine.charAt(0).toUpperCase() + routine.slice(1)
}

function userLabel(user?: UserRef | null) {
  return user ? `${user.name} (${user.email})` : 'Não definido'
}

function statusTone(status: string) {
  const normalized = status.toLowerCase()
  if (normalized.includes('concl')) return 'success'
  if (normalized.includes('aprova')) return 'info'
  if (normalized.includes('revis')) return 'warning'
  if (normalized.includes('andamento')) return 'warning'
  if (normalized.includes('atras')) return 'danger'
  return 'neutral'
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'workflow.created': 'Workflow criado',
  'workflow.updated': 'Workflow atualizado',
  'workflow_activity.created': 'Atividade criada',
  'workflow_activity.linked': 'Atividade vinculada',
  'workflow_activity.updated': 'Atividade editada',
  'workflow_activity.deleted': 'Atividade excluída',
  'workflow_activity.completed': 'Atividade concluída',
  'workflow_activity.submitted_for_approval': 'Enviada para aprovação',
  'workflow_activity.approved': 'Atividade aprovada',
  'workflow_activity.rejected': 'Atividade reprovada',
  'workflow_activity.returned_for_review': 'Devolvida para ajuste',
  'workflow_activity.dependencies_updated': 'Predecessoras atualizadas',
  'workflow_activity.attachment_emailed': 'Anexo enviado',
  'activity.status_changed': 'Status atualizado',
  'activity_template.created': 'Modelo de atividade criado',
  'activity_template.updated': 'Modelo de atividade editado',
  'user.created': 'Usuário criado',
  'user.updated': 'Usuário atualizado',
  'stage_setting.updated': 'Responsáveis da etapa atualizados',
  'company.created': 'Empresa cadastrada',
  'company.updated': 'Empresa atualizada',
  'company_holiday.created': 'Feriado cadastrado',
  'company_holiday.updated': 'Feriado atualizado',
  'company_holiday.deleted': 'Feriado excluído',
  'team.created': 'Equipe cadastrada',
  'team.updated': 'Equipe atualizada',
  'team.deleted': 'Equipe excluída',
  'directorate.created': 'Diretoria cadastrada',
  'directorate.updated': 'Diretoria atualizada',
  'directorate.deleted': 'Diretoria excluída',
  'email.sent': 'E-mail enviado',
  'email.failed': 'Falha no envio de e-mail',
}

function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] || action.replaceAll('_', ' ').replaceAll('.', ' · ')
}

function auditCategory(action: string, entityType: string) {
  if (action.startsWith('email.')) return 'email'
  if (entityType === 'workflow') return 'workflow'
  if (entityType.includes('activity')) return action.includes('approv') || action.includes('reject') || action.includes('review') ? 'approval' : 'activity'
  if (entityType === 'user_profile') return 'user'
  return 'settings'
}

function auditTone(action: string) {
  if (action.includes('failed') || action.includes('rejected') || action.includes('deleted')) return 'danger'
  if (action.includes('sent') || action.includes('approved') || action.includes('completed') || action.includes('created')) return 'success'
  if (action.includes('submitted') || action.includes('review') || action.includes('updated')) return 'warning'
  return 'neutral'
}

function auditEntityLabel(entityType: string) {
  return ({ workflow: 'Workflow', workflow_activity: 'Atividade', activity_template: 'Modelo', user_profile: 'Usuário', stage_responsibility_settings: 'Configuração', company: 'Empresa', company_holiday: 'Feriado', team: 'Equipe', directorate: 'Diretoria' } as Record<string, string>)[entityType] || entityType
}

function completionPercent(completed: number, total: number) {
  return total === 0 ? 0 : Math.round((completed / total) * 100)
}

function emptyWorkflowForm() {
  return {
    name: '',
    description: '',
    routine: 'mensal',
    month: String(new Date().getUTCMonth() + 1),
    year: String(new Date().getUTCFullYear()),
    last_business_day: '',
    expected_end_date: '',
  }
}

function emptyTemplateForm() {
  return {
    name: '',
    stage: STAGES[0],
    routine: ROUTINES[0],
    company: '',
    deadline_type: 'fixed_date' as 'business_days' | 'fixed_date',
    deadline_days: '',
    notify_team: false,
    team_email: '',
    start_date: '',
    expected_end_date: '',
    responsible_user_id: '',
    responsible_backup_user_id: '',
    approver_user_id: '',
    requires_attachment: false,
    requires_approval: false,
    dependency_template_ids: [] as string[],
  }
}

function emptyActivityForm() {
  return {
    name: '',
    stage: STAGES[0],
    routine: ROUTINES[0],
    company: '',
    deadline_type: 'fixed_date' as 'business_days' | 'fixed_date',
    deadline_days: '',
    notify_team: false,
    team_email: '',
    start_date: '',
    expected_end_date: '',
    responsible_user_id: '',
    responsible_backup_user_id: '',
    approver_user_id: '',
    requires_attachment: false,
    requires_approval: false,
    dependency_activity_ids: [] as string[],
  }
}

function LoginRegisterPage({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const login = async () => {
    try {
      setBusy(true)
      setError('')
      setMessage('')
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError
      await onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha de autenticação.')
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    try {
      setBusy(true)
      setError('')
      setMessage('')
      const response = await api.register('', email, password, confirmPassword)
      setMessage(response.message)
      setMode('login')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao concluir cadastro.')
    } finally {
      setBusy(false)
    }
  }

  const recoverPassword = async () => {
    if (!email.trim()) {
      setError('Informe seu e-mail para recuperar a senha.')
      return
    }
    try {
      setBusy(true)
      setError('')
      setMessage('')
      const response = await api.startAccess(email.trim())
      setMessage(response.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível solicitar uma nova senha.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-axia-brand">AXIA ENERGIA</div>
        <img className="auth-product-brand" src={orquestradorLogo} alt="Orquestrador — Planeje, organize, execute" />
        <p className="muted-text">
          {mode === 'login'
            ? 'Entre com seu e-mail e senha. Se ainda não tiver acesso, use cadastrar.'
            : 'Crie sua conta para entrar. Se já tiver acesso, volte para login.'}
        </p>

        <div className="auth-mode-switch">
          <button
            type="button"
            className={mode === 'login' ? 'nav-link active auth-mode-button' : 'nav-link auth-mode-button'}
            onClick={() => {
              setMode('login')
              setError('')
              setMessage('')
            }}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'nav-link active auth-mode-button' : 'nav-link auth-mode-button'}
            onClick={() => {
              setMode('register')
              setError('')
              setMessage('')
            }}
          >
            Cadastrar
          </button>
        </div>

        <label>
          <span>E-mail</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>

        <label>
          <span>Senha</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>

        {mode === 'register' && (
          <label>
            <span>Confirmar senha</span>
            <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" />
          </label>
        )}

        {mode === 'login' ? (
          <>
            <button type="button" className="primary-button" onClick={() => void login()} disabled={busy || !email || !password}>
              {busy ? 'Entrando...' : 'Entrar'}
            </button>
            <button type="button" className="secondary-button auth-forgot-password" onClick={() => void recoverPassword()} disabled={busy}>
              Esqueci minha senha
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={() => void register()}
            disabled={busy || !email || !password || !confirmPassword}
          >
            {busy ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        )}

        {message && <p className="success-box">{message}</p>}
        {error && <p className="error-box">{error}</p>}
      </div>
    </div>
  )
}

function FirstLoginPage({ token, onDone }: { token: string; onDone: () => Promise<void> }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    try {
      setBusy(true)
      setError('')
      setSuccess('')
      const response = await api.completeFirstLogin(token, newPassword, confirmPassword)
      setSuccess(response.message)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao concluir o primeiro acesso.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Primeiro acesso</p>
        <h1>Defina sua nova senha</h1>
        <p className="muted-text">A senha temporária será invalidada assim que este passo terminar.</p>
        <label>
          <span>Nova senha</span>
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label>
          <span>Confirmar nova senha</span>
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Salvando...' : 'Salvar nova senha'}
        </button>
        {success && <p className="success-box">{success}</p>}
        {error && <p className="error-box">{error}</p>}
      </div>
    </div>
  )
}

function ProtectedLayout({ context }: { context: AppContextShape }) {
  const location = useLocation()
  const navigate = useNavigate()
  const loadRouteData = useEffectEvent(async (pathname: string) => {
    if (pathname === '/activities') {
      await context.refreshData(['templates', 'users', 'companies', 'teams'])
    } else if (pathname === '/logs') {
      await context.refreshData(['logs'])
    } else if (pathname === '/settings' && context.profile?.is_admin) {
      await context.refreshData(['users', 'stageSettings', 'companies', 'teams', 'directorates'])
    }
  })
  const loadSelectedActivities = useEffectEvent((workflowId: string | null) => context.refreshActivities(workflowId))

  useEffect(() => {
    void loadRouteData(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname === '/activities') void loadSelectedActivities(context.selectedWorkflowId)
  }, [location.pathname, context.selectedWorkflowId])

  const logout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const menu = [
    { label: 'Home', path: '/' },
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Página Inicial', path: '/' },
    { label: 'Atividades', path: '/activities' },
    { label: 'Log', path: '/logs' },
    ...(context.profile?.is_admin ? [{ label: 'Configurações', path: '/settings' }] : []),
  ]
  const pageTitle = {
    '/': 'Home',
    '/dashboard': 'Dashboard operacional',
    '/activities': 'Gestao de atividades',
    '/logs': 'Historico e auditoria',
    '/settings': 'Configuracoes',
  }[location.pathname] || 'Orquestrador'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-panel brand-block" aria-label="AXIA Energia">
          <div className="axia-logo">AXIA <span>ENERGIA</span></div>
        </div>

        <nav className="nav-links">
          {menu.filter((item, index) => item.path !== '/' || index === 0).map((item) => (
            <button
              key={item.path}
              type="button"
              className={location.pathname === item.path ? 'nav-link active' : 'nav-link'}
              onClick={() => navigate(item.path)}
            >
              <span aria-hidden="true">{item.path === '/' ? '⌂' : item.path === '/dashboard' ? '▦' : item.path === '/activities' ? '✓' : item.path === '/settings' ? '⚙' : '≡'}</span>{item.label}
            </button>
          ))}
        </nav>

        <button className="secondary-button" type="button" onClick={() => void logout()}>
          Sair
        </button>
      </aside>

      <main className="workspace">
        <header className="workspace-topbar">
          <div>
            <h1>{pageTitle}</h1>
            <p>Workflows, atividades e prazos em uma visao unica.</p>
          </div>
          <img className="product-brand" src={orquestradorLogo} alt="Orquestrador — Planeje, organize, execute" />
          <div className="session-chip">
            <span>Usuario conectado</span>
            <strong>{context.profile?.name}</strong>
          </div>
        </header>
        {(context.error || context.success) && (
          <div className="message-stack">
            {context.success && <p className="success-box">{context.success}</p>}
            {context.error && <p className="error-box">{context.error}</p>}
          </div>
        )}

        <Routes>
          <Route path="/" element={<HomePage context={context} />} />
          <Route path="/dashboard" element={<DashboardPage context={context} />} />
          <Route path="/activities" element={<ActivitiesPage context={context} />} />
          <Route path="/logs" element={<LogsPage context={context} />} />
          <Route
            path="/settings"
            element={context.profile?.is_admin ? <SettingsPage context={context} /> : <Navigate to="/" replace />}
          />
        </Routes>
      </main>
    </div>
  )
}

function DashboardPage({ context }: { context: AppContextShape }) {
  const totals = context.workflows.reduce((acc, workflow) => ({ total: acc.total + workflow.activity_totals.total, completed: acc.completed + workflow.activity_totals.completed, pending: acc.pending + workflow.activity_totals.in_progress }), { total: 0, completed: 0, pending: 0 })
  const completion = totals.total ? Math.round((totals.completed / totals.total) * 100) : 0
  const activeWorkflows = context.workflows.filter((workflow) => workflow.is_active !== false).length
  const recentWorkflows = context.workflows.slice(0, 5)

  const exportGoalsCsv = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = [
      ['Workflow', 'Rotina', 'Período', 'Status', 'Ativo', 'Total de atividades', 'Concluídas', 'Pendentes', 'Conclusão (%)'],
      ...context.workflows.map((workflow) => [
        workflow.name,
        routineLabel(workflow.routine),
        `${workflow.month}/${workflow.year}`,
        workflow.status,
        workflow.is_active ? 'Sim' : 'Não',
        workflow.activity_totals.total,
        workflow.activity_totals.completed,
        workflow.activity_totals.in_progress,
        completionPercent(workflow.activity_totals.completed, workflow.activity_totals.total),
      ]),
    ]
    const blob = new Blob([`\ufeff${rows.map((row) => row.map(escape).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `metas-workflows-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="dashboard-page">
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">Visao executiva</p>
          <h2>Panorama da operacao</h2>
          <p>Acompanhe a cadencia dos workflows, atividades e entregas em um unico lugar.</p>
        </div>
        <div className="dashboard-intro-actions"><div className="modal-actions"><button className="secondary-button" type="button" onClick={exportGoalsCsv}>Exportar Excel (CSV)</button><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimir / PDF</button></div><div className="dashboard-intro-note"><span>Indice de conclusao</span><strong>{completion}%</strong></div></div>
      </section>

      <section className="metric-grid premium-metric-grid">
        <article className="metric-card metric-card-primary"><span>Workflows ativos</span><strong>{activeWorkflows}</strong><small>{context.workflows.length} workflow(s) no total</small></article>
        <article className="metric-card"><span>Atividades mapeadas</span><strong>{totals.total}</strong><small>Base operacional do periodo</small></article>
        <article className="metric-card metric-card-success"><span>Entregas concluidas</span><strong>{totals.completed}</strong><small>{completion}% de execucao acumulada</small></article>
        <article className="metric-card metric-card-alert"><span>Atencao necessaria</span><strong>{totals.pending}</strong><small>Atividades em andamento ou pendentes</small></article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel dashboard-progress-panel">
          <div className="panel-header"><div><p className="section-kicker">Progresso</p><h2>Execucao dos workflows</h2></div><span>{completion}% concluido</span></div>
          <div className="progress-hero"><div className="progress-ring"><strong>{completion}%</strong><span>concluido</span></div><div className="progress-copy"><strong>Ritmo da operacao</strong><p>{totals.completed} atividades foram finalizadas de um total de {totals.total}.</p><div className="progress-track"><span style={{ width: `${completion}%` }} /></div></div></div>
          <div className="workflow-progress-list">{recentWorkflows.map((workflow) => { const value = completionPercent(workflow.activity_totals.completed, workflow.activity_totals.total); return <div key={workflow.id} className="workflow-progress-row"><div><strong>{workflow.name}</strong><span>{workflow.activity_totals.completed} de {workflow.activity_totals.total} atividades</span></div><b>{value}%</b><div className="mini-progress"><span style={{ width: `${value}%` }} /></div></div> })}</div>
        </article>
        <article className="panel dashboard-focus-panel"><div className="panel-header"><div><p className="section-kicker">Prioridades</p><h2>Resumo rapido</h2></div></div><div className="focus-list"><div><span className="focus-dot focus-dot-teal" /><p><strong>{activeWorkflows} workflows ativos</strong><small>Monitorados no ambiente</small></p></div><div><span className="focus-dot focus-dot-amber" /><p><strong>{totals.pending} itens em andamento</strong><small>Priorize os proximos vencimentos</small></p></div><div><span className="focus-dot focus-dot-slate" /><p><strong>{context.companies.length} empresas cadastradas</strong><small>Base disponivel para as rotinas</small></p></div></div></article>
      </section>
    </section>
  )
}

function HomePage({ context }: { context: AppContextShape }) {
  const navigate = useNavigate()
  const [workflowForm, setWorkflowForm] = useState(emptyWorkflowForm())
  const [creating, setCreating] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [savingWorkflow, setSavingWorkflow] = useState(false)
  const [viewingWorkflow, setViewingWorkflow] = useState<Workflow | null>(null)
  const [previewActivities, setPreviewActivities] = useState<WorkflowActivity[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<WorkflowActivity | null>(null)
  const [workflowFilter, setWorkflowFilter] = useState('Em andamento')
  const [workflowAction, setWorkflowAction] = useState<{ id: string; type: 'duplicate' | 'toggle' | 'delete' } | null>(null)

  useEffect(() => {
    if (!context.selectedWorkflowActivities.some((activity) => activity.id === selectedActivity?.id)) {
      setSelectedActivity(null)
    }
  }, [context.selectedWorkflowActivities, selectedActivity?.id])

  const createWorkflow = async () => {
    if (!context.token) return
    try {
      setSavingWorkflow(true)
      context.setError('')
      context.setSuccess('')
      await api.createWorkflow(context.token, {
        ...workflowForm,
        month: Number(workflowForm.month),
        year: Number(workflowForm.year),
      })
      setWorkflowForm(emptyWorkflowForm())
      setCreating(false)
      context.setSuccess('Workflow criado com sucesso.')
      await context.refreshData(['workflows'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao criar workflow.')
    } finally {
      setSavingWorkflow(false)
    }
  }

  const beginWorkflowEdit = (workflow: Workflow) => {
    setWorkflowForm({
      name: workflow.name,
      description: workflow.description || '',
      routine: workflow.routine,
      month: String(workflow.month),
      year: String(workflow.year),
      last_business_day: workflow.last_business_day || workflow.start_date,
      expected_end_date: workflow.expected_end_date,
    })
    setEditingWorkflow(workflow)
  }

  const saveWorkflowEdit = async () => {
    if (!context.token || !editingWorkflow) return
    try {
      setSavingWorkflow(true)
      context.setError('')
      await api.updateWorkflow(context.token, editingWorkflow.id, {
        ...workflowForm,
        month: Number(workflowForm.month),
        year: Number(workflowForm.year),
      })
      setEditingWorkflow(null)
      setWorkflowForm(emptyWorkflowForm())
      await context.refreshData(['workflows'])
      context.setSuccess('Workflow atualizado com sucesso.')
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao editar workflow.')
    } finally {
      setSavingWorkflow(false)
    }
  }

  const openWorkflowPreview = async (workflow: Workflow) => {
    if (!context.token) return
    setViewingWorkflow(workflow)
    setPreviewActivities([])
    setPreviewLoading(true)
    try {
      setPreviewActivities(await api.workflowActivities(context.token, workflow.id))
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao carregar as atividades do workflow.')
    } finally {
      setPreviewLoading(false)
    }
  }

  const duplicateWorkflow = async (workflow: Workflow) => {
    if (!context.token) return
    try {
      setWorkflowAction({ id: workflow.id, type: 'duplicate' })
      context.setError('')
      context.setSuccess('Duplicando workflow...')
      await api.duplicateWorkflow(context.token, workflow.id)
      await context.refreshData(['workflows'])
      context.setSuccess('Workflow duplicado com as atividades e predecessoras.')
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao duplicar workflow.')
    } finally {
      setWorkflowAction(null)
    }
  }

  const toggleWorkflow = async (workflow: Workflow) => {
    if (!context.token) return
    try {
      setWorkflowAction({ id: workflow.id, type: 'toggle' })
      context.setError('')
      await api.updateWorkflow(context.token, workflow.id, { is_active: !workflow.is_active })
      await context.refreshData(['workflows'])
      context.setSuccess('Workflow ativado e notificacoes enviadas.')
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao atualizar workflow.')
    } finally {
      setWorkflowAction(null)
    }
  }

  const removeWorkflow = async (workflow: Workflow) => {
    if (!context.token || !window.confirm(`Excluir o workflow "${workflow.name}" e todas as suas atividades?`)) return
    try {
      setWorkflowAction({ id: workflow.id, type: 'delete' })
      context.setError('')
      await api.deleteWorkflow(context.token, workflow.id)
      if (context.selectedWorkflowId === workflow.id) context.setSelectedWorkflowId(null)
      await context.refreshData(['workflows'])
      context.setSuccess('Workflow excluído.')
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao excluir workflow.')
    } finally {
      setWorkflowAction(null)
    }
  }

  return (
    <section className="page-stack">
      <div className="home-toolbar">
        <button className="primary-button" type="button" onClick={() => setCreating(true)}>
          CRIAR NOVO WORKFLOW
        </button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Workflows criados</h2>
          <span>{context.workflows.length} workflow(s)</span>
        </div>

        <div className="card-grid workflow-grid">
          <div className="form-grid"><SelectField label="Status do workflow" value={workflowFilter} onChange={setWorkflowFilter} options={[{ value: '', label: 'Todos os status' }, { value: 'Nao iniciado', label: 'Não iniciado' }, { value: 'Em andamento', label: 'Em andamento' }, { value: 'Concluido', label: 'Concluído' }]} /></div>
          {context.workflows.filter((workflow) => !workflowFilter || workflow.status === workflowFilter).map((workflow) => (
            <article key={workflow.id} className="workflow-card workflow-card-shell">
              <div className="workflow-card-top">
                <div>
                  <strong>{workflow.name}</strong>
                  <span>{routineLabel(workflow.routine)} • {workflow.month}/{workflow.year}</span>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void openWorkflowPreview(workflow)}
                  aria-label={`Visualizar workflow ${workflow.name}`}
                  title="Visualizar workflow"
                >
                  <EyeIcon />
                </button>
              </div>

              <div className="workflow-card-meta">
                <span>Último dia útil: {formatDate(workflow.last_business_day || workflow.start_date)}</span>
                <span>Prazo do workflow: {formatDate(workflow.expected_end_date)}</span>
              </div>

              <div className="workflow-card-stats">
                <span className={`status-chip ${statusTone(workflow.status)}`}>{workflow.status}</span>
                <span>Concluídas: {workflow.activity_totals.completed}</span>
                <span>Total: {workflow.activity_totals.total}</span>
              </div>
              <div className="modal-actions"><button className="primary-button" type="button" onClick={() => { context.setSelectedWorkflowId(workflow.id); navigate('/activities') }}>Cadastrar nova atividade</button>{context.profile?.is_admin && <><button className="secondary-button" type="button" onClick={() => beginWorkflowEdit(workflow)}>Editar</button><button className="secondary-button" type="button" onClick={() => void duplicateWorkflow(workflow)} disabled={workflowAction?.id === workflow.id}>{workflowAction?.id === workflow.id && workflowAction.type === 'duplicate' ? 'Duplicando...' : 'Duplicar'}</button>{!workflow.is_active && <button className="secondary-button" type="button" onClick={() => void toggleWorkflow(workflow)} disabled={workflowAction?.id === workflow.id}>{workflowAction?.id === workflow.id && workflowAction.type === 'toggle' ? 'Salvando...' : 'Ativar'}</button>}<button className="danger-button danger-button-quiet" type="button" onClick={() => void removeWorkflow(workflow)} disabled={workflowAction?.id === workflow.id}>{workflowAction?.id === workflow.id && workflowAction.type === 'delete' ? 'Excluindo...' : 'Excluir'}</button></>}</div>
            </article>
          ))}
        </div>
      </div>

      {creating && (
        <Modal title="Criar novo workflow" onClose={() => setCreating(false)}>
          <div className="form-grid">
            <TextField label="Nome do workflow" value={workflowForm.name} onChange={(value) => setWorkflowForm((current) => ({ ...current, name: value.replace(/[^a-zA-Z0-9 ]/g, '') }))} />
            <TextField label="Descrição" value={workflowForm.description} onChange={(value) => setWorkflowForm((current) => ({ ...current, description: value }))} />
            <SelectField label="Rotina" value={workflowForm.routine} onChange={(value) => setWorkflowForm((current) => ({ ...current, routine: value }))} options={ROUTINES.map((item) => ({ value: item, label: routineLabel(item) }))} />
            <TextField label="Mês" value={workflowForm.month} onChange={(value) => setWorkflowForm((current) => ({ ...current, month: value }))} type="number" />
            <TextField label="Ano" value={workflowForm.year} onChange={(value) => setWorkflowForm((current) => ({ ...current, year: value }))} type="number" />
            <TextField label="Último dia útil considerado" value={workflowForm.last_business_day} onChange={(value) => setWorkflowForm((current) => ({ ...current, last_business_day: value }))} type="date" />
            <TextField label="Prazo do workflow" value={workflowForm.expected_end_date} onChange={(value) => setWorkflowForm((current) => ({ ...current, expected_end_date: value }))} type="date" />
          </div>

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="primary-button" type="button" onClick={() => void createWorkflow()} disabled={savingWorkflow}>{savingWorkflow ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </Modal>
      )}

      {editingWorkflow && (
        <Modal title={`Editar ${editingWorkflow.name}`} onClose={() => { setEditingWorkflow(null); setWorkflowForm(emptyWorkflowForm()) }}>
          <div className="form-grid">
            <TextField label="Nome do workflow" value={workflowForm.name} onChange={(value) => setWorkflowForm((current) => ({ ...current, name: value.replace(/[^a-zA-Z0-9 ]/g, '') }))} />
            <TextField label="Descrição" value={workflowForm.description} onChange={(value) => setWorkflowForm((current) => ({ ...current, description: value }))} />
            <SelectField label="Rotina" value={workflowForm.routine} onChange={(value) => setWorkflowForm((current) => ({ ...current, routine: value }))} options={ROUTINES.map((item) => ({ value: item, label: routineLabel(item) }))} />
            <TextField label="Mês" value={workflowForm.month} onChange={(value) => setWorkflowForm((current) => ({ ...current, month: value }))} type="number" />
            <TextField label="Ano" value={workflowForm.year} onChange={(value) => setWorkflowForm((current) => ({ ...current, year: value }))} type="number" />
            <TextField label="Último dia útil considerado" value={workflowForm.last_business_day} onChange={(value) => setWorkflowForm((current) => ({ ...current, last_business_day: value }))} type="date" />
            <TextField label="Prazo do workflow" value={workflowForm.expected_end_date} onChange={(value) => setWorkflowForm((current) => ({ ...current, expected_end_date: value }))} type="date" />
          </div>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => { setEditingWorkflow(null); setWorkflowForm(emptyWorkflowForm()) }}>Cancelar</button>
            <button className="primary-button" type="button" onClick={() => void saveWorkflowEdit()} disabled={savingWorkflow}>{savingWorkflow ? 'Salvando...' : 'Salvar alterações'}</button>
          </div>
        </Modal>
      )}

      {viewingWorkflow && (
        <Modal title={viewingWorkflow.name} onClose={() => setViewingWorkflow(null)} wide>
          {previewLoading ? (
            <div className="modal-loading">Carregando atividades...</div>
          ) : (
            <WorkflowPreviewModalContent
              workflow={viewingWorkflow}
              activities={previewActivities}
              currentUserId={context.profile?.id}
              onSelectActivity={setSelectedActivity}
            />
          )}
        </Modal>
      )}

      {selectedActivity && (
        <ActivityDetailsModal
          activity={selectedActivity}
          context={context}
          workflowActivities={previewActivities}
          onCompleted={async () => {
            if (context.token && viewingWorkflow) {
              setPreviewActivities(await api.workflowActivities(context.token, viewingWorkflow.id))
            }
          }}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </section>
  )
}

function WorkflowPreviewModalContent({
  workflow,
  activities,
  currentUserId,
  onSelectActivity,
}: {
  workflow: Workflow
  activities: WorkflowActivity[]
  currentUserId?: string
  onSelectActivity: (activity: WorkflowActivity) => void
}) {
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [status, setStatus] = useState('')
  const [responsibleId, setResponsibleId] = useState('')
  const [directorate, setDirectorate] = useState('')
  const [company, setCompany] = useState('')
  const responsibleOptions = useMemo(() => {
    const users = new Map<string, UserRef>()
    activities.forEach((activity) => {
      if (activity.responsible_user) users.set(activity.responsible_user.id, activity.responsible_user)
    })
    return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [activities])
  const statuses = useMemo(() => [...new Set(activities.map((activity) => activity.status))].sort(), [activities])
  const directorates = useMemo(() => [...new Set(activities.map((activity) => activity.responsible_user?.area).filter((value): value is string => Boolean(value)))].sort(), [activities])
  const companies = useMemo(() => [...new Set(activities.map((activity) => activity.company_snapshot).filter((value): value is string => Boolean(value)))].sort(), [activities])
  const filteredActivities = useMemo(() => activities.filter((activity) => {
    if (scope === 'mine' && activity.responsible_user_id !== currentUserId && activity.responsible_backup_user_id !== currentUserId) return false
    if (status && activity.status !== status) return false
    if (responsibleId && activity.responsible_user_id !== responsibleId) return false
    if (directorate && activity.responsible_user?.area !== directorate) return false
    if (company && activity.company_snapshot !== company) return false
    return true
  }), [activities, company, currentUserId, directorate, responsibleId, scope, status])
  const filteredCompleted = filteredActivities.filter((activity) => activity.status.toLowerCase().includes('concl')).length

  return (
    <div className="page-stack">
      <div className="workflow-preview-hero">
        <div className="workflow-preview-main">
          <p className="eyebrow">Workflow</p>
          <h3>{workflow.name}</h3>
          <div className="workflow-preview-meta">
            <span>Rotina: {routineLabel(workflow.routine)}</span>
            <span>Período: {workflow.month}/{workflow.year}</span>
            <span>Último dia útil: {formatDate(workflow.last_business_day || workflow.start_date)}</span>
            <span>Prazo do workflow: {formatDate(workflow.expected_end_date)}</span>
          </div>
        </div>

        <div className="workflow-preview-total">
          <strong>
            {filteredCompleted}/{filteredActivities.length}
            <small>{completionPercent(filteredCompleted, filteredActivities.length)}%</small>
          </strong>
          <span>atividades concluídas</span>
        </div>
      </div>

      <div className="form-grid workflow-preview-filters">
        <SelectField label="Exibição" value={scope} onChange={(value) => setScope(value as 'all' | 'mine')} options={[{ value: 'all', label: 'Todas as atividades' }, { value: 'mine', label: 'Minhas atividades' }]} />
        <SelectField label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'Todos os status' }, ...statuses.map((value) => ({ value, label: value }))]} />
        <SelectField label="Responsável" value={responsibleId} onChange={setResponsibleId} options={[{ value: '', label: 'Todos os responsáveis' }, ...responsibleOptions.map((user) => ({ value: user.id, label: userLabel(user) }))]} />
        <SelectField label="Diretoria" value={directorate} onChange={setDirectorate} options={[{ value: '', label: 'Todas as diretorias' }, ...directorates.map((value) => ({ value, label: value }))]} />
        <SelectField label="Empresa" value={company} onChange={setCompany} options={[{ value: '', label: 'Todas as empresas' }, ...companies.map((value) => ({ value, label: value }))]} />
      </div>
      <p className="filter-result-count">{filteredActivities.length} de {activities.length} atividade(s) exibida(s)</p>
      <StageColumns activities={filteredActivities} onSelect={onSelectActivity} />
    </div>
  )
}

function StageColumns({
  activities,
  onSelect,
}: {
  activities: WorkflowActivity[]
  onSelect: (activity: WorkflowActivity) => void
}) {
  return (
    <div className="stage-grid preview-stage-grid">
      {STAGES.map((stage) => {
        const stageActivities = activities.filter((activity) => activity.stage_snapshot === stage)
        const completed = stageActivities.filter((activity) => activity.status.toLowerCase().includes('concl')).length

        return (
          <div key={stage} className={`stage-column stage-column-${stage.toLowerCase()}`}>
            <div className="stage-column-header">
              <h3>{stageLabel(stage)}</h3>
              <span>
                {completed}/{stageActivities.length} concluídas ({completionPercent(completed, stageActivities.length)}%)
              </span>
            </div>

            <div className="stage-column-list">
              {stageActivities.map((activity) => {
                const tone = statusTone(activity.status)

                return (
                  <button key={activity.id} className="activity-tile clickable-card activity-preview-card" type="button" onClick={() => onSelect(activity)}>
                    <div className="activity-preview-top">
                      <strong>{activity.name_snapshot}</strong>
                      <span className={`status-chip ${tone}`}>{activity.status}</span>
                    </div>

                    <div className="activity-preview-grid">
                      <span>Responsável: {userLabel(activity.responsible_user)}</span>
                      <span>Empresa: {activity.company_snapshot || '-'}</span>
                      <span>Início: {formatDate(activity.start_date)}</span>
                      <span>Prazo: {formatDate(activity.expected_end_date)}</span>
                      <span>Data real fim: {activity.completed_at ? new Date(activity.completed_at).toLocaleString('pt-BR') : '-'}</span>
                    </div>

                    <div className="activity-preview-footer">
                      <span>Dependências: {activity.dependencies.length}</span>
                      <span>Abrir detalhes</span>
                    </div>
                  </button>
                )
              })}

              {stageActivities.length === 0 && (
                <div className="stage-empty">
                  <span>Nenhuma atividade nesta etapa.</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function LegacyActivitiesPage({ context }: { context: AppContextShape }) {
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm())
  const [activityForm, setActivityForm] = useState(emptyActivityForm())
  const [selectedActivity, setSelectedActivity] = useState<WorkflowActivity | null>(null)

  const selectedWorkflow = useMemo(
    () => context.workflows.find((workflow) => workflow.id === context.selectedWorkflowId) || null,
    [context.selectedWorkflowId, context.workflows],
  )

  const createTemplate = async () => {
    if (!context.token) return
    try {
      await api.createTemplate(context.token, {
        ...templateForm,
        responsible_user_id: templateForm.responsible_user_id || null,
        responsible_backup_user_id: templateForm.responsible_backup_user_id || null,
        approver_user_id: templateForm.requires_approval ? templateForm.approver_user_id || null : null,
      })
      context.setSuccess('Atividade reutilizável criada.')
      setTemplateForm(emptyTemplateForm())
      await context.refreshData(['templates'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao criar template.')
    }
  }

  const linkTemplates = async () => {
    if (!context.token || !context.selectedWorkflowId || selectedTemplateIds.length === 0) return
    try {
      await api.linkTemplates(context.token, context.selectedWorkflowId, selectedTemplateIds)
      context.setSuccess('Templates vinculados ao workflow.')
      setSelectedTemplateIds([])
      await context.refreshData(['workflows'])
      await context.refreshActivities(context.selectedWorkflowId)
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao vincular templates.')
    }
  }

  const createActivity = async () => {
    if (!context.token || !context.selectedWorkflowId) return
    try {
      await api.createWorkflowActivity(context.token, context.selectedWorkflowId, {
        ...activityForm,
        responsible_user_id: activityForm.responsible_user_id || null,
        responsible_backup_user_id: activityForm.responsible_backup_user_id || null,
        approver_user_id: activityForm.requires_approval ? activityForm.approver_user_id || null : null,
      })
      context.setSuccess('Nova atividade criada e vinculada ao workflow.')
      setActivityForm(emptyActivityForm())
      await context.refreshData(['workflows', 'templates'])
      await context.refreshActivities(context.selectedWorkflowId)
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao criar atividade.')
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <h1>Atividades</h1>
          <span>Escolha um workflow e gerencie as atividades vinculadas.</span>
        </div>

        <div className="list-stack">
          {context.workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              className={context.selectedWorkflowId === workflow.id ? 'workflow-card active' : 'workflow-card'}
              onClick={() => context.setSelectedWorkflowId(workflow.id)}
            >
              <strong>{workflow.name}</strong>
              <span>{routineLabel(workflow.routine)} • {workflow.month}/{workflow.year}</span>
              <span>Atividades cadastradas: {workflow.activity_totals.total}</span>
            </button>
          ))}
        </div>

        <div className="list-stack">
          {context.selectedWorkflowActivities.map((activity) => (
            <button key={activity.id} type="button" className="activity-row clickable-card" onClick={() => setSelectedActivity(activity)}>
              <div>
                <strong>{activity.name_snapshot}</strong>
                <p>{stageLabel(activity.stage_snapshot)} • {activity.company_snapshot || 'Sem empresa'}</p>
              </div>
              <span className={`status-chip ${statusTone(activity.status)}`}>{activity.status}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="page-stack">
        <div className="panel">
          <div className="panel-header">
            <h2>Workflow atual</h2>
            <span>{selectedWorkflow ? selectedWorkflow.name : 'Selecione um workflow'}</span>
          </div>

          <div className="form-grid">
            <TextField label="Nome da atividade" value={activityForm.name} onChange={(value) => setActivityForm((current) => ({ ...current, name: value }))} />
            <TextField label="Empresa" value={activityForm.company} onChange={(value) => setActivityForm((current) => ({ ...current, company: value }))} />
            <SelectField label="Etapa" value={activityForm.stage} onChange={(value) => setActivityForm((current) => ({ ...current, stage: value }))} options={STAGES.map((item) => ({ value: item, label: stageLabel(item) }))} />
            <SelectField label="Rotina" value={activityForm.routine} onChange={(value) => setActivityForm((current) => ({ ...current, routine: value }))} options={ROUTINES.map((item) => ({ value: item, label: routineLabel(item) }))} />
            <TextField label="Prazo" value={activityForm.expected_end_date} onChange={(value) => setActivityForm((current) => ({ ...current, expected_end_date: value }))} type="date" />
            <UserSelect label="Responsável" value={activityForm.responsible_user_id} users={context.users} onChange={(value) => setActivityForm((current) => ({ ...current, responsible_user_id: value }))} />
            <UserSelect label="Suplente" value={activityForm.responsible_backup_user_id} users={context.users} onChange={(value) => setActivityForm((current) => ({ ...current, responsible_backup_user_id: value }))} allowEmpty />
            <CheckField label="Exige anexo" checked={activityForm.requires_attachment} onChange={(checked) => setActivityForm((current) => ({ ...current, requires_attachment: checked }))} />
            <CheckField label="Exige aprovação" checked={activityForm.requires_approval} onChange={(checked) => setActivityForm((current) => ({ ...current, requires_approval: checked }))} />
            {activityForm.requires_approval && (
              <UserSelect label="Aprovador" value={activityForm.approver_user_id} users={context.users} onChange={(value) => setActivityForm((current) => ({ ...current, approver_user_id: value }))} allowEmpty />
            )}
            <MultiSelectField
              label="Dependências"
              value={activityForm.dependency_activity_ids}
              onChange={(value) => setActivityForm((current) => ({ ...current, dependency_activity_ids: value }))}
              options={context.selectedWorkflowActivities.map((activity) => ({ value: activity.id, label: activity.name_snapshot }))}
            />
          </div>

          <div className="modal-actions">
            <button className="primary-button" type="button" onClick={() => void createActivity()} disabled={!context.selectedWorkflowId}>
              Criar nova atividade
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Base reutilizável</h2>
            <span>Crie templates e vincule ao workflow atual.</span>
          </div>

          <div className="form-grid">
            <TextField label="Nome do template" value={templateForm.name} onChange={(value) => setTemplateForm((current) => ({ ...current, name: value }))} />
            <TextField label="Empresa" value={templateForm.company} onChange={(value) => setTemplateForm((current) => ({ ...current, company: value }))} />
            <SelectField label="Etapa" value={templateForm.stage} onChange={(value) => setTemplateForm((current) => ({ ...current, stage: value }))} options={STAGES.map((item) => ({ value: item, label: stageLabel(item) }))} />
            <SelectField label="Rotina" value={templateForm.routine} onChange={(value) => setTemplateForm((current) => ({ ...current, routine: value }))} options={ROUTINES.map((item) => ({ value: item, label: routineLabel(item) }))} />
            <TextField label="Início padrão" value={templateForm.start_date} onChange={(value) => setTemplateForm((current) => ({ ...current, start_date: value }))} type="date" />
            <TextField label="Prazo padrão" value={templateForm.expected_end_date} onChange={(value) => setTemplateForm((current) => ({ ...current, expected_end_date: value }))} type="date" />
            <UserSelect label="Responsável" value={templateForm.responsible_user_id} users={context.users} onChange={(value) => setTemplateForm((current) => ({ ...current, responsible_user_id: value }))} allowEmpty />
            <UserSelect label="Suplente" value={templateForm.responsible_backup_user_id} users={context.users} onChange={(value) => setTemplateForm((current) => ({ ...current, responsible_backup_user_id: value }))} allowEmpty />
            <CheckField label="Exige anexo" checked={templateForm.requires_attachment} onChange={(checked) => setTemplateForm((current) => ({ ...current, requires_attachment: checked }))} />
            <CheckField label="Exige aprovação" checked={templateForm.requires_approval} onChange={(checked) => setTemplateForm((current) => ({ ...current, requires_approval: checked }))} />
            {templateForm.requires_approval && (
              <UserSelect label="Aprovador" value={templateForm.approver_user_id} users={context.users} onChange={(value) => setTemplateForm((current) => ({ ...current, approver_user_id: value }))} allowEmpty />
            )}
            <MultiSelectField
              label="Dependências"
              value={templateForm.dependency_template_ids}
              onChange={(value) => setTemplateForm((current) => ({ ...current, dependency_template_ids: value }))}
              options={context.templates.map((template) => ({ value: template.id, label: template.name }))}
            />
          </div>

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => void createTemplate()}>
              Salvar template
            </button>
            <button className="primary-button" type="button" onClick={() => void linkTemplates()} disabled={!context.selectedWorkflowId || selectedTemplateIds.length === 0}>
              Vincular selecionados
            </button>
          </div>

          <div className="list-stack">
            {context.templates.map((template) => {
              const checked = selectedTemplateIds.includes(template.id)
              return (
                <label key={template.id} className="template-item">
                  <div className="template-card-content">
                    <strong>{template.name}</strong>
                    <span>{stageLabel(template.stage)} • {routineLabel(template.routine)}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setSelectedTemplateIds((current) =>
                        event.target.checked ? [...current, template.id] : current.filter((item) => item !== template.id),
                      )
                    }
                  />
                </label>
              )
            })}
          </div>
        </div>
      </div>

      {selectedActivity && (
        <ActivityDetailsModal
          activity={selectedActivity}
          context={context}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </section>
  )
}

function ActivitiesPage({ context }: { context: AppContextShape }) {
  const [activityForm, setActivityForm] = useState(emptyActivityForm())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const [formError, setFormError] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<WorkflowActivity | null>(null)
  const [allActivities, setAllActivities] = useState<WorkflowActivity[]>([])
  const [activityScope, setActivityScope] = useState<'all' | 'mine' | 'pending'>('all')
  const [savingActivity, setSavingActivity] = useState(false)
  const [addingTemplates, setAddingTemplates] = useState(false)
  const [calculatingDeadline, setCalculatingDeadline] = useState(false)
  const selectedWorkflow = context.workflows.find((workflow) => workflow.id === context.selectedWorkflowId) || null
  const templates = context.templates.filter((template) => template.name.toLowerCase().includes(search.trim().toLowerCase()))
  const companyOptions = [{ value: 'Total das Empresas', label: 'Total das Empresas' }, ...context.companies.filter((company) => company.is_active).map((company) => ({ value: company.name, label: company.name }))]
  const predecessorOptions = context.selectedWorkflowActivities.filter((activity) => !activityForm.company || activityForm.company === 'Total das Empresas' || activity.company_snapshot === activityForm.company).map((activity) => ({ value: activity.id, label: `${activity.name_snapshot} - ${activity.company_snapshot || 'Sem empresa'}` }))
  const requiredActivityFieldsMissing = !activityForm.company
    || !activityForm.name.trim()
    || !activityForm.stage
    || !activityForm.routine
    || !activityForm.deadline_type
    || (activityForm.deadline_type === 'business_days' && (!activityForm.deadline_days || Number(activityForm.deadline_days) <= 0))
    || !activityForm.expected_end_date
    || !activityForm.responsible_user_id
    || !activityForm.responsible_backup_user_id
  const activityToken = context.token
  const reportActivityError = useEffectEvent(context.setError)
  const loadAllActivities = async () => {
    if (!activityToken) return
    setAllActivities(await api.allActivities(activityToken))
  }
  const loadAllActivitiesEvent = useEffectEvent(loadAllActivities)
  useEffect(() => { void loadAllActivitiesEvent().catch((error: unknown) => reportActivityError(error instanceof Error ? error.message : 'Falha ao carregar atividades.')) }, [activityToken])
  useEffect(() => {
    if (activityForm.deadline_type !== 'business_days') return
    if (!context.token || !selectedWorkflow || activityForm.deadline_days === '') {
      setActivityForm((current) => current.expected_end_date ? { ...current, expected_end_date: '' } : current)
      return
    }
    let cancelled = false
    setCalculatingDeadline(true)
    const timer = window.setTimeout(() => {
      void api.deadlinePreview(context.token!, {
        workflow_id: selectedWorkflow.id,
        deadline_days: Number(activityForm.deadline_days),
        company: activityForm.company || null,
      }).then((result) => {
        if (!cancelled) setActivityForm((current) => ({ ...current, expected_end_date: result.expected_end_date }))
      }).catch((err: unknown) => {
        if (!cancelled) setFormError(err instanceof Error ? err.message : 'Não foi possível calcular o prazo.')
      }).finally(() => { if (!cancelled) setCalculatingDeadline(false) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [activityForm.company, activityForm.deadline_days, activityForm.deadline_type, context.token, selectedWorkflow])
  const byDeadline = (left: WorkflowActivity, right: WorkflowActivity) => left.expected_end_date.localeCompare(right.expected_end_date) || left.name_snapshot.localeCompare(right.name_snapshot, 'pt-BR')
  const selectedActivitiesByDeadline = [...context.selectedWorkflowActivities].sort(byDeadline)
  const visibleActivities = allActivities.filter((activity) => activityScope === 'all' || (activityScope === 'mine' && [activity.responsible_user_id, activity.responsible_backup_user_id, activity.approver_user_id].includes(context.profile?.id)) || (activityScope === 'pending' && !['Concluida', 'Reprovada'].includes(activity.status))).sort(byDeadline)

  const refreshActivityViews = async () => {
    await Promise.all([
      context.refreshData(['workflows', 'templates']),
      context.refreshActivities(context.selectedWorkflowId),
      loadAllActivities(),
    ])
  }

  const createActivity = async () => {
    if (!context.token || !context.selectedWorkflowId) return
    setFormError('')
    if (requiredActivityFieldsMissing) {
      setFormError('Preencha todos os campos obrigatórios para criar a atividade.')
      return
    }
    setSavingActivity(true)
    try {
      await api.createWorkflowActivity(context.token, context.selectedWorkflowId, {
        ...activityForm,
        deadline_days: activityForm.deadline_type === 'business_days' ? Number(activityForm.deadline_days) : null,
        responsible_user_id: activityForm.responsible_user_id || null,
        responsible_backup_user_id: activityForm.responsible_backup_user_id || null,
        approver_user_id: activityForm.requires_approval ? activityForm.approver_user_id || null : null,
      })
      setActivityForm(emptyActivityForm())
      context.setSuccess('Atividade criada e adicionada à base reutilizável.')
      await refreshActivityViews()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível criar a atividade.')
    } finally {
      setSavingActivity(false)
    }
  }

  const addTemplates = async () => {
    if (!context.token || !context.selectedWorkflowId || selectedTemplateIds.length === 0) return
    setFormError('')
    setAddingTemplates(true)
    try {
      await api.linkTemplates(context.token, context.selectedWorkflowId, selectedTemplateIds)
      setSelectedTemplateIds([])
      setPickerOpen(false)
      context.setSuccess('Atividades adicionadas ao workflow.')
      await refreshActivityViews()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível adicionar as atividades.')
    } finally {
      setAddingTemplates(false)
    }
  }

  return (
    <section className="activities-workspace">
      <div className="panel activities-gallery-panel">
        <div className="panel-header"><div><p className="eyebrow">Galeria operacional</p><h1>Workflows criados</h1></div><span>{context.workflows.length} workflow(s)</span></div>
        <div className="workflow-gallery">
          {context.workflows.map((workflow) => (
            <article key={workflow.id} className={workflow.id === context.selectedWorkflowId ? 'workflow-gallery-card active' : 'workflow-gallery-card'}>
              <button type="button" className="workflow-select" onClick={() => context.setSelectedWorkflowId(workflow.id)}>
                <strong>{workflow.name}</strong><span>{routineLabel(workflow.routine)} • {workflow.month}/{workflow.year}</span><small>{workflow.activity_totals.total} atividade(s)</small>
              </button>
              <button type="button" className="secondary-button compact-button" onClick={() => { context.setSelectedWorkflowId(workflow.id); setPickerOpen(true) }}>Adicionar atividade</button>
            </article>
          ))}
        </div>
        <div className="activities-gallery-heading"><h2>{selectedWorkflow ? `Atividades de ${selectedWorkflow.name}` : 'Atividades'}</h2><span>{context.selectedWorkflowActivities.length} item(ns)</span></div>
        <div className="workflow-activity-gallery">
          {selectedActivitiesByDeadline.map((activity) => <button key={activity.id} type="button" className="activity-row clickable-card" onClick={() => setSelectedActivity(activity)}><div><strong>{activity.name_snapshot}</strong><p>{stageLabel(activity.stage_snapshot)} • {activity.company_snapshot || 'Sem empresa'} • Prazo: {formatDate(activity.expected_end_date)}</p></div><span className={`status-chip ${statusTone(activity.status)}`}>{activity.status}</span></button>)}
        </div>
        <div className="activities-gallery-heading"><h2>Todas as atividades</h2><SelectField label="Filtro" value={activityScope} onChange={(value) => setActivityScope(value as 'all' | 'mine' | 'pending')} options={[{ value: 'all', label: 'Todas as atividades' }, { value: 'mine', label: 'Minhas atividades' }, { value: 'pending', label: 'Atividades por status pendente' }]} /></div>
        <div className="workflow-activity-gallery">{visibleActivities.map((activity) => <button key={activity.id} type="button" className="activity-row clickable-card" onClick={() => setSelectedActivity(activity)}><div><strong>{activity.name_snapshot}</strong><p>{activity.company_snapshot || 'Sem empresa'} • Prazo: {formatDate(activity.expected_end_date)}</p></div><span className={`status-chip ${statusTone(activity.status)}`}>{activity.status}</span></button>)}</div>
      </div>

      <div className="panel activity-form-panel">
        <div className="panel-header"><div><p className="eyebrow">Nova atividade</p><h2>Dados da atividade</h2></div><span>{selectedWorkflow?.name || 'Selecione um workflow'}</span></div>
        {formError && <p className="form-error">{formError}</p>}
        <div className="form-grid">
          <SelectField label="Empresa cadastrada" value={activityForm.company} onChange={(value) => setActivityForm((current) => ({ ...current, company: value }))} options={companyOptions} required />
          <TextField label="Nome da atividade" value={activityForm.name} onChange={(value) => setActivityForm((current) => ({ ...current, name: value }))} required />
          <SelectField label="Etapa" value={activityForm.stage} onChange={(value) => setActivityForm((current) => ({ ...current, stage: value }))} options={STAGES.map((item) => ({ value: item, label: stageLabel(item) }))} required />
          <SelectField label="Rotina" value={activityForm.routine} onChange={(value) => setActivityForm((current) => ({ ...current, routine: value }))} options={ROUTINES.map((item) => ({ value: item, label: routineLabel(item) }))} required />
          <SelectField label="Tipo de prazo" value={activityForm.deadline_type} onChange={(value) => setActivityForm((current) => ({ ...current, deadline_type: value as 'business_days' | 'fixed_date' }))} options={[{ value: 'fixed_date', label: 'Data fixa' }, { value: 'business_days', label: 'Dias úteis a partir da base do workflow' }]} required />
          {activityForm.deadline_type === 'business_days' && <TextField label="Dias uteis" value={activityForm.deadline_days} onChange={(value) => setActivityForm((current) => ({ ...current, deadline_days: value }))} type="number" required />}
          <TextField label={activityForm.deadline_type === 'business_days' ? 'Prazo (calculado automaticamente)' : 'Prazo'} value={activityForm.expected_end_date} onChange={(value) => setActivityForm((current) => ({ ...current, expected_end_date: value }))} type="date" disabled={activityForm.deadline_type === 'business_days'} readOnly={activityForm.deadline_type === 'business_days'} required />
          {calculatingDeadline && <p className="form-help">Calculando o prazo pela base de último dia útil definida no workflow e pelo calendário global de feriados...</p>}
          {activityForm.deadline_type === 'fixed_date' && <p className="form-help">Se a data fixa cair em fim de semana ou feriado cadastrado, escolha manualmente outra data útil.</p>}
          <UserSelect label="Responsável" value={activityForm.responsible_user_id} users={context.users} onChange={(value) => setActivityForm((current) => ({ ...current, responsible_user_id: value }))} required />
          <UserSelect label="Suplente" value={activityForm.responsible_backup_user_id} users={context.users} onChange={(value) => setActivityForm((current) => ({ ...current, responsible_backup_user_id: value }))} required />
          <CheckField label="Exige anexo" checked={activityForm.requires_attachment} onChange={(checked) => setActivityForm((current) => ({ ...current, requires_attachment: checked }))} />
          <CheckField label="Exige aprovação" checked={activityForm.requires_approval} onChange={(checked) => setActivityForm((current) => ({ ...current, requires_approval: checked }))} />
          {activityForm.requires_approval && <UserSelect label="Aprovador" value={activityForm.approver_user_id} users={context.users} onChange={(value) => setActivityForm((current) => ({ ...current, approver_user_id: value }))} allowEmpty />}
          <MultiSelectField label="Atividade predecessora" value={activityForm.dependency_activity_ids} onChange={(value) => setActivityForm((current) => ({ ...current, dependency_activity_ids: value }))} options={predecessorOptions} />
          <CheckField label="Notificar equipe" checked={activityForm.notify_team} onChange={(checked) => setActivityForm((current) => ({ ...current, notify_team: checked }))} />
          {activityForm.notify_team && <SelectField label="Equipe" value={activityForm.team_email} onChange={(value) => setActivityForm((current) => ({ ...current, team_email: value }))} options={[{ value: '', label: 'Selecione a equipe' }, ...Array.from(new Map(context.users.filter((user) => user.team_email).map((user) => [user.team_email!, `${user.team_name || 'Equipe'} - ${user.team_email}`])).entries()).map(([value, label]) => ({ value, label }))]} />}
        </div>
        <div className="form-footer"><p>Os campos com * são obrigatórios. As atividades são ordenadas automaticamente pelo prazo.</p><button className="primary-button" type="button" onClick={() => void createActivity()} disabled={!selectedWorkflow || savingActivity || calculatingDeadline}>{savingActivity ? 'Salvando atividade...' : 'Criar nova atividade'}</button></div>
      </div>

      {pickerOpen && <Modal title="Adicionar atividades" onClose={() => setPickerOpen(false)} wide><div className="template-picker-header"><p>Selecione atividades já cadastradas para o workflow atual.</p><input placeholder="Pesquisar por nome da atividade" value={search} onChange={(event) => setSearch(event.target.value)} /></div>{formError && <p className="form-error">{formError}</p>}<div className="template-gallery">{templates.map((template) => { const checked = selectedTemplateIds.includes(template.id); return <label key={template.id} className={checked ? 'template-gallery-card selected' : 'template-gallery-card'}><input type="checkbox" checked={checked} onChange={(event) => setSelectedTemplateIds((current) => event.target.checked ? [...current, template.id] : current.filter((id) => id !== template.id))} /><strong>{template.name}</strong><span>{stageLabel(template.stage)} • {routineLabel(template.routine)}</span><small>{template.company || 'Sem empresa'}</small></label> })}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPickerOpen(false)} disabled={addingTemplates}>Voltar</button><button className="primary-button" type="button" onClick={() => void addTemplates()} disabled={selectedTemplateIds.length === 0 || addingTemplates}>{addingTemplates ? 'Adicionando...' : 'Adicionar atividades'}</button></div></Modal>}
      {selectedActivity && <ActivityDetailsModal activity={selectedActivity} context={context} onCompleted={refreshActivityViews} onClose={() => setSelectedActivity(null)} />}
    </section>
  )
}

function ActivityDetailsModal({
  activity,
  context,
  workflowActivities,
  onCompleted,
  onClose,
}: {
  activity: WorkflowActivity
  context: AppContextShape
  workflowActivities?: WorkflowActivity[]
  onCompleted?: () => Promise<void>
  onClose: () => void
}) {
  const [attachment, setAttachment] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [editing, setEditing] = useState(false)
  const [showRejectionForm, setShowRejectionForm] = useState(false)
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [draft, setDraft] = useState({
    name_snapshot: activity.name_snapshot,
    company_snapshot: activity.company_snapshot || '',
    stage_snapshot: activity.stage_snapshot,
    routine_snapshot: activity.routine_snapshot,
    expected_end_date: activity.expected_end_date,
    deadline_type: activity.deadline_type || 'fixed_date' as 'business_days' | 'fixed_date',
    deadline_days: activity.deadline_days ?? '',
    responsible_user_id: activity.responsible_user_id || '',
    responsible_backup_user_id: activity.responsible_backup_user_id || '',
    approver_user_id: activity.approver_user_id || '',
    requires_attachment_snapshot: activity.requires_attachment_snapshot,
    requires_approval_snapshot: activity.requires_approval_snapshot,
    notify_team: activity.notify_team || false,
    team_email: activity.team_email_snapshot || '',
    dependency_activity_ids: activity.dependencies.map((dependency) => dependency.depends_on_workflow_activity_id),
  })
  const relatedActivities = workflowActivities || context.selectedWorkflowActivities
  const isFinal = activity.status === 'Concluida' || activity.status === 'Reprovada'
  const isAwaitingApproval = activity.status === 'Pendente de aprovacao'
  const canManageActivity = context.profile?.role !== 'consulta'
  const canComplete = Boolean(context.profile?.is_admin || context.profile?.id === activity.responsible_user_id || context.profile?.id === activity.responsible_backup_user_id)
  const canApprove = Boolean(context.profile?.is_admin || context.profile?.id === activity.approver_user_id)
  const dependencyNames = activity.dependencies
    .map((dependency) => relatedActivities.find((item) => item.id === dependency.depends_on_workflow_activity_id)?.name_snapshot)
    .filter(Boolean)

  const refreshAfterMutation = async () => {
    await Promise.all([
      context.refreshData(['workflows']),
      onCompleted ? onCompleted() : context.refreshActivities(activity.workflow_id),
    ])
  }

  const complete = async () => {
    if (!context.token) return
    if (activity.requires_attachment_snapshot && !attachment) {
      setActionError('Esta atividade exige um anexo antes da conclusão.')
      return
    }

    setActionError('')
    setBusy(true)
    try {
      const result = await api.completeActivity(context.token, activity.id, attachment || undefined)
      context.setSuccess(activity.requires_approval_snapshot ? 'Atividade enviada para aprovação.' : 'Atividade concluída. O próximo responsável foi notificado por e-mail.')
      await refreshAfterMutation()
      if (result.notification_sent === false) {
        context.setError('A atividade foi salva, mas o e-mail ao aprovador não pôde ser enviado. A falha foi registrada no Log para nova tentativa.')
      }
      onClose()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao concluir atividade.')
    } finally {
      setBusy(false)
    }
  }

  const decideApproval = async (action: 'approve' | 'reject') => {
    if (!context.token) return
    if (action === 'reject' && !rejectionNotes.trim()) {
      setActionError('Informe o motivo da reprovação antes de continuar.')
      return
    }
    setActionError('')
    setBusy(true)
    try {
      const result = await api.actOnActivity(context.token, activity.id, action, action === 'reject' ? rejectionNotes.trim() : '')
      context.setSuccess(action === 'approve' ? 'Atividade aprovada e fluxo atualizado.' : 'Atividade devolvida ao responsável para ajuste e reenvio.')
      await refreshAfterMutation()
      if (result.notification_sent === false) {
        context.setError('A decisão foi salva, mas a notificação por e-mail não pôde ser enviada. Consulte o Log para os detalhes técnicos.')
      }
      onClose()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível registrar a decisão.')
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (!context.token) return
    setBusy(true)
    try {
      await api.updateActivity(context.token, activity.id, draft)
      await refreshAfterMutation()
      context.setSuccess('Atividade atualizada.')
      setEditing(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao atualizar atividade.')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!context.token || !window.confirm('Excluir esta atividade?')) return
    setBusy(true)
    try {
      await api.deleteActivity(context.token, activity.id)
      await refreshAfterMutation()
      context.setSuccess('Atividade excluida.')
      onClose()
    } catch (err) { setActionError(err instanceof Error ? err.message : 'Falha ao excluir atividade.') } finally { setBusy(false) }
  }

  return (
    <Modal title={activity.name_snapshot} onClose={onClose} wide scrollable>
      {actionError && <p className="form-error">{actionError}</p>}
      <div className="readonly-grid">
        <ReadOnlyField label="Nome" value={activity.name_snapshot} />
        <ReadOnlyField label="Empresa" value={activity.company_snapshot || 'Não informada'} />
        <ReadOnlyField label="Etapa" value={stageLabel(activity.stage_snapshot)} />
        <ReadOnlyField label="Rotina" value={routineLabel(activity.routine_snapshot)} />
        <ReadOnlyField label="Início" value={formatDate(activity.start_date)} />
        <ReadOnlyField label="Prazo" value={formatDate(activity.expected_end_date)} />
        <ReadOnlyField label="Data real fim" value={activity.completed_at ? new Date(activity.completed_at).toLocaleString('pt-BR') : 'Não concluída'} />
        <ReadOnlyField label="Responsável" value={userLabel(activity.responsible_user)} />
        <ReadOnlyField label="Suplente" value={userLabel(activity.responsible_backup_user)} />
        <ReadOnlyField label="Aprovador" value={userLabel(activity.approver_user)} />
        <ReadOnlyField label="Exige anexo" value={activity.requires_attachment_snapshot ? 'Sim' : 'Não'} />
        <ReadOnlyField label="Exige aprovação" value={activity.requires_approval_snapshot ? 'Sim' : 'Não'} />
        <ReadOnlyField label="Dependências" value={dependencyNames.join(', ') || 'Nenhuma'} className="readonly-field-wide" />
      </div>
      {editing && <div className="form-grid">
        <TextField label="Nome" value={draft.name_snapshot} onChange={(value) => setDraft((current) => ({ ...current, name_snapshot: value }))} />
        <SelectField label="Empresa" value={draft.company_snapshot} onChange={(value) => setDraft((current) => ({ ...current, company_snapshot: value }))} options={[{ value: 'Total das Empresas', label: 'Total das Empresas' }, ...context.companies.map((company) => ({ value: company.name, label: company.name }))]} />
        <SelectField label="Etapa" value={draft.stage_snapshot} onChange={(value) => setDraft((current) => ({ ...current, stage_snapshot: value }))} options={STAGES.map((value) => ({ value, label: stageLabel(value) }))} />
        <SelectField label="Rotina" value={draft.routine_snapshot} onChange={(value) => setDraft((current) => ({ ...current, routine_snapshot: value }))} options={ROUTINES.map((value) => ({ value, label: routineLabel(value) }))} />
        <SelectField label="Tipo de prazo" value={draft.deadline_type} onChange={(value) => setDraft((current) => ({ ...current, deadline_type: value as 'business_days' | 'fixed_date' }))} options={[{ value: 'fixed_date', label: 'Data fixa' }, { value: 'business_days', label: 'Dias úteis pelo workflow' }]} />
        {draft.deadline_type === 'business_days' && <TextField label="Dias úteis" value={String(draft.deadline_days)} onChange={(value) => setDraft((current) => ({ ...current, deadline_days: value }))} type="number" />}
        <TextField label={draft.deadline_type === 'business_days' ? 'Prazo (automático)' : 'Prazo'} value={draft.expected_end_date} onChange={(value) => setDraft((current) => ({ ...current, expected_end_date: value }))} type="date" disabled={draft.deadline_type === 'business_days'} readOnly={draft.deadline_type === 'business_days'} />
        <UserSelect label="Responsável" value={draft.responsible_user_id} users={context.users} onChange={(value) => setDraft((current) => ({ ...current, responsible_user_id: value }))} />
        <UserSelect label="Suplente" value={draft.responsible_backup_user_id} users={context.users} onChange={(value) => setDraft((current) => ({ ...current, responsible_backup_user_id: value }))} allowEmpty />
        <CheckField label="Exige anexo" checked={draft.requires_attachment_snapshot} onChange={(value) => setDraft((current) => ({ ...current, requires_attachment_snapshot: value }))} />
        <CheckField label="Exige aprovação" checked={draft.requires_approval_snapshot} onChange={(value) => setDraft((current) => ({ ...current, requires_approval_snapshot: value }))} />
        {draft.requires_approval_snapshot && <UserSelect label="Aprovador" value={draft.approver_user_id} users={context.users} onChange={(value) => setDraft((current) => ({ ...current, approver_user_id: value }))} allowEmpty />}
        <CheckField label="Notificar equipe" checked={draft.notify_team} onChange={(value) => setDraft((current) => ({ ...current, notify_team: value }))} />
        {draft.notify_team && <SelectField label="Equipe" value={draft.team_email} onChange={(value) => setDraft((current) => ({ ...current, team_email: value }))} options={[{ value: '', label: 'Selecione a equipe' }, ...Array.from(new Map(context.users.filter((user) => user.team_email).map((user) => [user.team_email!, `${user.team_name || 'Equipe'} - ${user.team_email}`])).entries()).map(([value, label]) => ({ value, label }))]} />}
        <MultiSelectField label="Atividades predecessoras" value={draft.dependency_activity_ids} onChange={(value) => setDraft((current) => ({ ...current, dependency_activity_ids: value }))} options={relatedActivities.filter((item) => item.id !== activity.id).map((item) => ({ value: item.id, label: `${item.name_snapshot} - ${item.company_snapshot || 'Sem empresa'}` }))} />
      </div>}

      <div className="detail-grid">
        <div className="detail-card">
          <h3>Execução atual</h3>
          <p>Status: {activity.status}</p>
          <p>Aprovação: {activity.approval_status}</p>
          <p>Responsável: {userLabel(activity.responsible_user)}</p>
          <p>Suplente: {userLabel(activity.responsible_backup_user)}</p>
        </div>

        <div className="detail-card">
          <h3>Anexo</h3>
          {activity.requires_attachment_snapshot && !isFinal && !isAwaitingApproval ? (
            <>
              <p>O arquivo será enviado por e-mail ao concluir e não ficará salvo no app.</p>
              <input type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} disabled={busy} />
              {attachment && <p className="attachment-name">Selecionado: {attachment.name}</p>}
            </>
          ) : activity.requires_attachment_snapshot ? (
            <p>O anexo já foi encaminhado para o fluxo desta atividade.</p>
          ) : (
            <p>Esta atividade não exige anexo.</p>
          )}
        </div>
      </div>

      {isAwaitingApproval && showRejectionForm && canApprove && (
        <div className="decision-panel decision-panel-danger">
          <div>
            <strong>Motivo da reprovação</strong>
            <p>Descreva objetivamente o ajuste necessário. O responsável receberá esta orientação por e-mail.</p>
          </div>
          <label>
            <span>Motivo obrigatório</span>
            <textarea value={rejectionNotes} onChange={(event) => setRejectionNotes(event.target.value)} rows={4} placeholder="Ex.: Corrigir os valores informados e reenviar para aprovação." disabled={busy} />
          </label>
        </div>
      )}

      {!isFinal && (
        <div className="modal-actions activity-modal-actions" aria-busy={busy}>
          {isAwaitingApproval ? (
            <>
              <button className="secondary-button" type="button" onClick={showRejectionForm ? () => { setShowRejectionForm(false); setActionError('') } : onClose} disabled={busy}>{showRejectionForm ? 'Voltar' : 'Cancelar'}</button>
              {canApprove && (showRejectionForm ? (
                <button className="danger-button" type="button" onClick={() => void decideApproval('reject')} disabled={busy || !rejectionNotes.trim()}>{busy ? 'Reprovando...' : 'Confirmar reprovação'}</button>
              ) : (
                <>
                  <button className="danger-button" type="button" onClick={() => setShowRejectionForm(true)} disabled={busy}>Reprovar</button>
                  <button className="primary-button" type="button" onClick={() => void decideApproval('approve')} disabled={busy}>{busy ? 'Aprovando...' : 'Aprovar'}</button>
                </>
              ))}
            </>
          ) : (
            <>
              {canManageActivity && <><button className="secondary-button" type="button" onClick={() => setEditing((value) => !value)} disabled={busy}>{editing ? 'Cancelar edição' : 'Editar'}</button>{editing && <button className="primary-button" type="button" onClick={() => void saveEdit()} disabled={busy}>{busy ? 'Salvando...' : 'Salvar edição'}</button>}<button className="danger-button danger-button-quiet" type="button" onClick={() => void remove()} disabled={busy}>Excluir</button></>}
              {canComplete && <button className="primary-button" type="button" onClick={() => void complete()} disabled={busy}>
                {busy ? 'Processando...' : activity.requires_approval_snapshot ? 'Enviar para aprovação' : 'Concluir atividade'}
              </button>}
            </>
          )}
        </div>
      )}
      {isFinal && context.profile?.is_admin && (
        <div className="modal-actions activity-modal-actions" aria-busy={busy}>
          <button className="danger-button danger-button-quiet" type="button" onClick={() => void remove()} disabled={busy}>{busy ? 'Excluindo...' : 'Excluir atividade'}</button>
        </div>
      )}
    </Modal>
  )
}

function LogsPage({ context }: { context: AppContextShape }) {
  const [workflowFilter, setWorkflowFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const workflowNames = useMemo(() => new Map(context.workflows.map((workflow) => [workflow.id, workflow.name])), [context.workflows])

  const filteredLogs = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')
    return context.logs.filter((log) => {
      if (workflowFilter && log.workflow_id !== workflowFilter) return false
      if (categoryFilter && auditCategory(log.action, log.entity_type) !== categoryFilter) return false
      if (!normalizedSearch) return true
      const searchable = [auditActionLabel(log.action), log.actor_user?.name, log.actor_user?.email, log.workflow_id ? workflowNames.get(log.workflow_id) : '', log.entity_type, JSON.stringify(log.details || {})].join(' ').toLocaleLowerCase('pt-BR')
      return searchable.includes(normalizedSearch)
    })
  }, [categoryFilter, context.logs, search, workflowFilter, workflowNames])

  const today = new Date().toLocaleDateString('pt-BR')
  const todayCount = context.logs.filter((log) => new Date(log.created_at).toLocaleDateString('pt-BR') === today).length
  const emailCount = context.logs.filter((log) => log.action === 'email.sent').length
  const failureCount = context.logs.filter((log) => log.action === 'email.failed').length

  const refresh = async () => {
    try {
      setRefreshing(true)
      context.setError('')
      await context.refreshData(['logs'])
    } finally {
      setRefreshing(false)
    }
  }

  const exportAuditCsv = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = [
      ['Data e hora', 'Ação', 'Categoria', 'Workflow', 'Responsável', 'Detalhes'],
      ...filteredLogs.map((log) => [new Date(log.created_at).toLocaleString('pt-BR'), auditActionLabel(log.action), auditCategory(log.action, log.entity_type), log.workflow_id ? workflowNames.get(log.workflow_id) || '' : '', log.actor_user?.name || 'Sistema', JSON.stringify(log.details || {})]),
    ]
    const blob = new Blob([`\ufeff${rows.map((row) => row.map(escape).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `auditoria-orquestrador-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="audit-page page-stack">
      <div className="audit-hero">
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={exportAuditCsv}>Exportar Excel (CSV)</button><button className="secondary-button" type="button" onClick={() => window.print()}>Imprimir / PDF</button></div>
        <div><p className="section-kicker">Rastreabilidade</p><h1>Central de auditoria</h1><p>Acompanhe alterações, aprovações e notificações sem precisar interpretar códigos técnicos.</p></div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Atualizando...' : 'Atualizar histórico'}</button>
      </div>

      <div className="audit-metrics">
        <article><span>Total de eventos</span><strong>{context.logs.length}</strong><small>Histórico disponível</small></article>
        <article><span>Movimentações hoje</span><strong>{todayCount}</strong><small>Desde 00:00</small></article>
        <article className="audit-metric-success"><span>E-mails enviados</span><strong>{emailCount}</strong><small>Entregues ao provedor</small></article>
        <article className={failureCount ? 'audit-metric-danger' : ''}><span>Falhas de e-mail</span><strong>{failureCount}</strong><small>{failureCount ? 'Requer atenção' : 'Nenhuma falha registrada'}</small></article>
      </div>

      <section className="panel audit-panel">
        <div className="audit-toolbar">
          <TextField label="Buscar no histórico" value={search} onChange={setSearch} placeholder="Ação, usuário, workflow..." />
          <SelectField label="Workflow" value={workflowFilter} onChange={setWorkflowFilter} options={[{ value: '', label: 'Todos os workflows' }, ...context.workflows.map((workflow) => ({ value: workflow.id, label: workflow.name }))]} />
          <SelectField label="Categoria" value={categoryFilter} onChange={setCategoryFilter} options={[{ value: '', label: 'Todas as categorias' }, { value: 'workflow', label: 'Workflows' }, { value: 'activity', label: 'Atividades' }, { value: 'approval', label: 'Aprovações' }, { value: 'email', label: 'E-mails' }, { value: 'user', label: 'Usuários' }, { value: 'settings', label: 'Configurações' }]} />
        </div>

        <div className="audit-results-header"><div><strong>{filteredLogs.length} evento(s)</strong><span>Ordenados do mais recente para o mais antigo</span></div>{(search || workflowFilter || categoryFilter) && <button className="text-button" type="button" onClick={() => { setSearch(''); setWorkflowFilter(''); setCategoryFilter('') }}>Limpar filtros</button>}</div>

        <div className="audit-timeline">
          {filteredLogs.map((log) => {
            const category = auditCategory(log.action, log.entity_type)
            const tone = auditTone(log.action)
            return <article key={log.id} className={`audit-event audit-event-${tone}`}>
              <div className={`audit-event-icon audit-icon-${category}`} aria-hidden="true">{category === 'workflow' ? 'WF' : category === 'activity' ? 'AT' : category === 'approval' ? 'AP' : category === 'email' ? 'EM' : category === 'user' ? 'US' : 'CF'}</div>
              <div className="audit-event-content"><div className="audit-event-title"><strong>{auditActionLabel(log.action)}</strong><span className={`status-chip ${tone}`}>{auditEntityLabel(log.entity_type)}</span></div><div className="audit-event-meta"><span>{log.actor_user?.name || 'Sistema'}</span><span>{log.workflow_id ? workflowNames.get(log.workflow_id) || 'Workflow removido' : 'Ação geral'}</span><time>{new Date(log.created_at).toLocaleString('pt-BR')}</time></div></div>
              <button className="secondary-button compact-button" type="button" onClick={() => setSelectedLog(log)}>Ver detalhes</button>
            </article>
          })}
          {!filteredLogs.length && <div className="audit-empty"><strong>Nenhum evento encontrado</strong><span>Ajuste os filtros ou atualize o histórico.</span></div>}
        </div>
      </section>

      {selectedLog && <Modal title={auditActionLabel(selectedLog.action)} onClose={() => setSelectedLog(null)} wide scrollable>
        <div className="audit-detail-grid"><div><span>Executado por</span><strong>{selectedLog.actor_user ? userLabel(selectedLog.actor_user) : 'Sistema'}</strong></div><div><span>Data e hora</span><strong>{new Date(selectedLog.created_at).toLocaleString('pt-BR')}</strong></div><div><span>Tipo de registro</span><strong>{auditEntityLabel(selectedLog.entity_type)}</strong></div><div><span>Workflow</span><strong>{selectedLog.workflow_id ? workflowNames.get(selectedLog.workflow_id) || 'Workflow removido' : 'Não aplicável'}</strong></div></div>
        <div className="audit-detail-sections">
          {selectedLog.details && Object.keys(selectedLog.details).length > 0 && <section><h3>Informações da ação</h3><pre>{JSON.stringify(selectedLog.details, null, 2)}</pre></section>}
          {selectedLog.old_values && <section><h3>Antes da alteração</h3><pre>{JSON.stringify(selectedLog.old_values, null, 2)}</pre></section>}
          {selectedLog.new_values && <section><h3>Depois da alteração</h3><pre>{JSON.stringify(selectedLog.new_values, null, 2)}</pre></section>}
          {!selectedLog.details && !selectedLog.old_values && !selectedLog.new_values && <div className="audit-empty"><span>Este evento não possui informações complementares.</span></div>}
        </div>
        <div className="modal-actions"><button className="primary-button" type="button" onClick={() => setSelectedLog(null)}>Fechar</button></div>
      </Modal>}
    </section>
  )
}

function SettingsPage({ context }: { context: AppContextShape }) {
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'consulta', area: '', team_name: '', team_email: '' })
  const [showUsers, setShowUsers] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  const teamOptions = [
    { value: '', label: 'Selecione uma equipe' },
    ...context.teams.filter((team) => team.is_active || team.name === newUser.team_name).map((team) => ({ value: team.name, label: team.email ? `${team.name} — ${team.email}` : team.name })),
    ...(newUser.team_name && !context.teams.some((team) => team.name === newUser.team_name) ? [{ value: newUser.team_name, label: `${newUser.team_name} (cadastro legado)` }] : []),
  ]
  const directorateOptions = [
    { value: '', label: 'Selecione uma diretoria' },
    ...context.directorates.filter((item) => item.is_active || item.name === newUser.area).map((item) => ({ value: item.name, label: item.name })),
    ...(newUser.area && !context.directorates.some((item) => item.name === newUser.area) ? [{ value: newUser.area, label: `${newUser.area} (cadastro legado)` }] : []),
  ]

  const createUser = async () => {
    if (!context.token) return
    setSavingUser(true)
    context.setError('')
    try {
      await api.createUser(context.token, newUser)
      context.setSuccess('Usuário criado. O primeiro acesso poderá ser solicitado pelo e-mail cadastrado.')
      setNewUser({ email: '', name: '', role: 'consulta', area: '', team_name: '', team_email: '' })
      await context.refreshData(['users'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao criar usuário.')
    } finally {
      setSavingUser(false)
    }
  }

  const updateUser = async (userId: string) => {
    if (!context.token) return
    setSavingUser(true)
    context.setError('')
    try {
      await api.updateUser(context.token, userId, newUser)
      setEditingUserId(null)
      setNewUser({ email: '', name: '', role: 'consulta', area: '', team_name: '', team_email: '' })
      context.setSuccess('Usuário atualizado com sucesso.')
      await context.refreshData(['users'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao atualizar usuário.')
    } finally {
      setSavingUser(false)
    }
  }

  const editUser = (user: UserOption) => {
    context.setError('')
    context.setSuccess('')
    setEditingUserId(user.id)
    setNewUser({ email: user.email, name: user.name, role: user.role, area: user.area || '', team_name: user.team_name || '', team_email: user.team_email || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleActive = async (user: UserOption) => {
    if (!context.token) return
    setUpdatingUserId(user.id)
    try {
      await api.updateUser(context.token, user.id, { is_active: !user.is_active })
      context.setSuccess('Usuário atualizado.')
      await context.refreshData(['users'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao atualizar usuário.')
    } finally {
      setUpdatingUserId(null)
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <h1>Gestão de usuários e acessos</h1>
          <span>Perfis, ativação e preparo para permissões futuras.</span>
        </div>

        <div className="form-grid">
          <TextField label="Nome" value={newUser.name} onChange={(value) => setNewUser((current) => ({ ...current, name: value }))} />
          <TextField label="E-mail" value={newUser.email} onChange={(value) => setNewUser((current) => ({ ...current, email: value }))} type="email" />
          <SelectField label="Perfil operacional" value={newUser.role} onChange={(value) => setNewUser((current) => ({ ...current, role: value }))} options={[{ value: 'consulta', label: 'Consulta' }, { value: 'usuario', label: 'Usuario' }, { value: 'usuario_chave', label: 'Usuario-chave' }]} />
          <SelectField label="Equipe" value={newUser.team_name} onChange={(value) => { const team = context.teams.find((item) => item.name === value); setNewUser((current) => ({ ...current, team_name: value, team_email: team?.email || '' })) }} options={teamOptions} />
          <TextField label="E-mail da equipe" value={newUser.team_email} onChange={(value) => setNewUser((current) => ({ ...current, team_email: value }))} type="email" disabled readOnly />
          <SelectField label="Diretoria" value={newUser.area} onChange={(value) => setNewUser((current) => ({ ...current, area: value }))} options={directorateOptions} />
        </div>

        <div className="modal-actions">
          {editingUserId && <button className="secondary-button" type="button" onClick={() => { setEditingUserId(null); setNewUser({ email: '', name: '', role: 'consulta', area: '', team_name: '', team_email: '' }) }} disabled={savingUser}>Cancelar edição</button>}
          <button className="secondary-button" type="button" onClick={() => setShowUsers(true)}>Ver usuários cadastrados</button>
          {editingUserId
            ? <button className="primary-button" type="button" onClick={() => void updateUser(editingUserId)} disabled={savingUser}>{savingUser ? 'Salvando alterações...' : 'Salvar alterações'}</button>
            : <button className="primary-button" type="button" onClick={() => void createUser()} disabled={savingUser}>{savingUser ? 'Criando usuário...' : 'Criar usuário'}</button>}
        </div>
      </div>

      <RegistrySettings context={context} />

      <CompanySettings context={context} />
      {showUsers && <SettingsUsersModal users={context.users} updatingUserId={updatingUserId} onEdit={editUser} onToggle={toggleActive} onClose={() => setShowUsers(false)} />}
    </section>
  )
}

function RegistrySettings({ context }: { context: AppContextShape }) {
  return (
    <section className="registry-master-grid">
      <NamedRegistryCard context={context} kind="team" title="Equipes" items={context.teams} />
      <NamedRegistryCard context={context} kind="directorate" title="Diretorias" items={context.directorates} />
    </section>
  )
}

function NamedRegistryCard({ context, kind, title, items }: { context: AppContextShape; kind: 'team' | 'directorate'; title: string; items: NamedRegistry[] }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [editing, setEditing] = useState<NamedRegistry | null>(null)
  const [busy, setBusy] = useState(false)
  const domain: RefreshDomain = kind === 'team' ? 'teams' : 'directorates'
  const create = async () => {
    if (!context.token || !name.trim()) return
    setBusy(true)
    context.setError('')
    try {
      if (kind === 'team') await api.createTeam(context.token, { name: name.trim(), email: email.trim() || null })
      else await api.createDirectorate(context.token, { name: name.trim() })
      setName('')
      setEmail('')
      await context.refreshData([domain])
      context.setSuccess(`${kind === 'team' ? 'Equipe' : 'Diretoria'} cadastrada.`)
    } catch (err) { context.setError(err instanceof Error ? err.message : 'Falha ao salvar cadastro.') } finally { setBusy(false) }
  }
  const saveEdit = async () => {
    if (!context.token || !editing?.name.trim()) return
    setBusy(true)
    try {
      if (kind === 'team') await api.updateTeam(context.token, editing.id, { name: editing.name.trim(), email: editing.email || null })
      else await api.updateDirectorate(context.token, editing.id, { name: editing.name.trim() })
      setEditing(null)
      await context.refreshData([domain])
      context.setSuccess('Cadastro atualizado.')
    } catch (err) { context.setError(err instanceof Error ? err.message : 'Falha ao atualizar cadastro.') } finally { setBusy(false) }
  }
  const remove = async (item: NamedRegistry) => {
    if (!context.token || !window.confirm(`Excluir "${item.name}" da lista?`)) return
    setBusy(true)
    try {
      if (kind === 'team') await api.deleteTeam(context.token, item.id)
      else await api.deleteDirectorate(context.token, item.id)
      await context.refreshData([domain])
      context.setSuccess('Cadastro excluído.')
    } catch (err) { context.setError(err instanceof Error ? err.message : 'Falha ao excluir cadastro.') } finally { setBusy(false) }
  }
  return <div className="panel"><div className="panel-header"><div><p className="section-kicker">Lista de seleção</p><h2>{title}</h2></div><span>{items.length} cadastro(s)</span></div><div className="form-grid"><TextField label={`Nova ${kind === 'team' ? 'equipe' : 'diretoria'}`} value={name} onChange={setName} />{kind === 'team' && <TextField label="E-mail da equipe" value={email} onChange={setEmail} type="email" />}</div><div className="modal-actions settings-form-actions"><button className="primary-button" type="button" onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? 'Salvando...' : 'Cadastrar'}</button></div><div className="settings-registry table-scroll"><table><thead><tr><th>Nome</th>{kind === 'team' && <th>E-mail</th>}<th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.name}</td>{kind === 'team' && <td>{item.email || '-'}</td>}<td><div className="table-actions"><button className="secondary-button compact-button" type="button" onClick={() => setEditing(item)} disabled={busy}>Editar</button><button className="danger-button danger-button-quiet compact-button" type="button" onClick={() => void remove(item)} disabled={busy}>Excluir</button></div></td></tr>)}{!items.length && <tr><td colSpan={kind === 'team' ? 3 : 2}>Nenhum cadastro ainda.</td></tr>}</tbody></table></div>{editing && <Modal title={`Editar ${editing.name}`} onClose={() => setEditing(null)}><div className="form-grid"><TextField label="Nome" value={editing.name} onChange={(value) => setEditing((current) => current ? { ...current, name: value } : null)} />{kind === 'team' && <TextField label="E-mail" value={editing.email || ''} onChange={(value) => setEditing((current) => current ? { ...current, email: value } : null)} type="email" />}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary-button" type="button" onClick={() => void saveEdit()} disabled={busy}>Salvar alterações</button></div></Modal>}</div>
}

function CompanySettings({ context }: { context: AppContextShape }) {
  const [name, setName] = useState('')
  const [holidays, setHolidays] = useState<Array<{ id: string; holiday_date: string; description?: string | null }>>([])
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayDescription, setHolidayDescription] = useState('')
  const [savingCompany, setSavingCompany] = useState(false)
  const [savingHoliday, setSavingHoliday] = useState(false)
  const loadHolidays = async () => {
    if (!context.token) {
      setHolidays([])
      return
    }
    try {
      setHolidays(await api.globalHolidays(context.token))
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao carregar feriados.')
    }
  }
  useEffect(() => { void loadHolidays() }, [context.token])
  const saveCompany = async () => {
    if (!context.token || !name.trim()) {
      context.setError('Informe o nome da empresa.')
      return
    }
    setSavingCompany(true)
    context.setError('')
    try {
      await api.createCompany(context.token, { name: name.trim() })
      setName('')
      context.setSuccess('Empresa cadastrada.')
      await context.refreshData(['companies'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao salvar empresa.')
    } finally {
      setSavingCompany(false)
    }
  }
  const saveHoliday = async () => {
    if (!context.token || !holidayDate) {
      context.setError('Informe a data do feriado.')
      return
    }
    setSavingHoliday(true)
    context.setError('')
    try {
      await api.createGlobalHoliday(context.token, { holiday_date: holidayDate, description: holidayDescription.trim() })
      setHolidayDate('')
      setHolidayDescription('')
      context.setSuccess('Feriado cadastrado.')
      await loadHolidays()
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao salvar feriado.')
    } finally {
      setSavingHoliday(false)
    }
  }
  return <section className="page-grid"><div className="panel"><div className="panel-header"><h2>Empresas</h2><span>Cadastro independente usado nas atividades.</span></div><div className="form-grid"><TextField label="Nova empresa" value={name} onChange={setName} /><div className="field-action"><button className="primary-button" type="button" onClick={() => void saveCompany()} disabled={savingCompany}>{savingCompany ? 'Salvando...' : 'Salvar empresa'}</button></div></div><CompanyRegistry context={context} /></div><HolidayRegistry context={context} holidays={holidays} holidayDate={holidayDate} holidayDescription={holidayDescription} saving={savingHoliday} onDateChange={setHolidayDate} onDescriptionChange={setHolidayDescription} onSave={saveHoliday} onRefresh={loadHolidays} /></section>
}

function SettingsUsersModal({ users, updatingUserId, onEdit, onToggle, onClose }: { users: UserOption[]; updatingUserId: string | null; onEdit: (user: UserOption) => void; onToggle: (user: UserOption) => Promise<void>; onClose: () => void }) {
  return <Modal title="Usuários cadastrados" onClose={onClose} wide scrollable><div className="settings-registry table-scroll"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Equipe</th><th>Status</th><th>Ações</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.role}</td><td>{user.team_name || '-'}</td><td><span className={user.is_active ? 'status-chip success' : 'status-chip neutral'}>{user.is_active ? 'Ativo' : 'Inativo'}</span></td><td><div className="table-actions"><button className="secondary-button compact-button" type="button" onClick={() => { onEdit(user); onClose() }} disabled={updatingUserId === user.id}>Editar</button><button className="secondary-button compact-button" type="button" onClick={() => void onToggle(user)} disabled={updatingUserId === user.id}>{updatingUserId === user.id ? 'Salvando...' : user.is_active ? 'Remover' : 'Ativar'}</button></div></td></tr>)}</tbody></table></div></Modal>
}

function CompanyRegistry({ context }: { context: AppContextShape }) {
  const [showTable, setShowTable] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const saveEdit = async () => {
    if (!context.token || !editing?.name.trim()) return
    setBusyId(editing.id)
    try {
      await api.updateCompany(context.token, editing.id, { name: editing.name.trim() })
      setEditing(null)
      context.setSuccess('Empresa atualizada.')
      await context.refreshData(['companies'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao atualizar empresa.')
    } finally {
      setBusyId(null)
    }
  }
  const toggle = async (company: { id: string; is_active: boolean }) => {
    if (!context.token) return
    setBusyId(company.id)
    try {
      await api.updateCompany(context.token, company.id, { is_active: !company.is_active })
      context.setSuccess(company.is_active ? 'Empresa inativada.' : 'Empresa ativada.')
      await context.refreshData(['companies'])
    } catch (err) {
      context.setError(err instanceof Error ? err.message : 'Falha ao atualizar empresa.')
    } finally {
      setBusyId(null)
    }
  }
  return <><div className="modal-actions settings-form-actions"><button className="secondary-button" type="button" onClick={() => setShowTable((value) => !value)}>{showTable ? 'Ocultar empresas' : 'Ver empresas cadastradas'}</button></div>{showTable && <div className="settings-registry table-scroll"><table><thead><tr><th>Empresa</th><th>Status</th><th>Ações</th></tr></thead><tbody>{context.companies.map((company) => <tr key={company.id}><td>{company.name}</td><td><span className={company.is_active ? 'status-chip success' : 'status-chip neutral'}>{company.is_active ? 'Ativa' : 'Inativa'}</span></td><td><div className="table-actions"><button className="secondary-button compact-button" type="button" onClick={() => setEditing({ id: company.id, name: company.name })} disabled={busyId === company.id}>Editar</button><button className="secondary-button compact-button" type="button" onClick={() => void toggle(company)} disabled={busyId === company.id}>{busyId === company.id ? 'Salvando...' : company.is_active ? 'Remover' : 'Ativar'}</button></div></td></tr>)}</tbody></table></div>}{editing && <Modal title="Editar empresa" onClose={() => setEditing(null)}><TextField label="Nome da empresa" value={editing.name} onChange={(name) => setEditing((current) => current ? { ...current, name } : current)} /><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditing(null)} disabled={busyId === editing.id}>Cancelar</button><button className="primary-button" type="button" onClick={() => void saveEdit()} disabled={busyId === editing.id}>{busyId === editing.id ? 'Salvando...' : 'Salvar alterações'}</button></div></Modal>}</>
}

function HolidayRegistry({ context, holidays, holidayDate, holidayDescription, saving, onDateChange, onDescriptionChange, onSave, onRefresh }: { context: AppContextShape; holidays: Array<{ id: string; holiday_date: string; description?: string | null }>; holidayDate: string; holidayDescription: string; saving: boolean; onDateChange: (value: string) => void; onDescriptionChange: (value: string) => void; onSave: () => Promise<void>; onRefresh: () => Promise<void> }) {
  const [showTable, setShowTable] = useState(false)
  const [editing, setEditing] = useState<{ id: string; holiday_date: string; description: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const saveEdit = async () => { if (!context.token || !editing) return; setBusyId(editing.id); try { await api.updateHoliday(context.token, editing.id, { holiday_date: editing.holiday_date, description: editing.description.trim() }); setEditing(null); context.setSuccess('Feriado atualizado.'); await onRefresh() } catch (err) { context.setError(err instanceof Error ? err.message : 'Falha ao atualizar feriado.') } finally { setBusyId(null) } }
  const remove = async (holidayId: string) => { if (!context.token || !window.confirm('Remover este feriado?')) return; setBusyId(holidayId); try { await api.deleteHoliday(context.token, holidayId); context.setSuccess('Feriado removido.'); await onRefresh() } catch (err) { context.setError(err instanceof Error ? err.message : 'Falha ao remover feriado.') } finally { setBusyId(null) } }
  return <div className="panel"><div className="panel-header"><h2>Calendário global de feriados</h2><span>Aplicado a todas as empresas e workflows.</span></div><div className="form-grid"><TextField label="Data" value={holidayDate} onChange={onDateChange} type="date" /><TextField label="Descrição" value={holidayDescription} onChange={onDescriptionChange} /><div className="field-action"><button className="primary-button" type="button" onClick={() => void onSave()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar feriado'}</button></div></div><div className="modal-actions settings-form-actions"><button className="secondary-button" type="button" onClick={() => setShowTable((value) => !value)}>{showTable ? 'Ocultar feriados' : 'Ver feriados cadastrados'}</button></div>{showTable && <div className="settings-registry table-scroll"><table><thead><tr><th>Data</th><th>Descrição</th><th>Ações</th></tr></thead><tbody>{holidays.map((holiday) => <tr key={holiday.id}><td>{formatDate(holiday.holiday_date)}</td><td>{holiday.description || '-'}</td><td><div className="table-actions"><button className="secondary-button compact-button" type="button" onClick={() => setEditing({ id: holiday.id, holiday_date: holiday.holiday_date, description: holiday.description || '' })} disabled={busyId === holiday.id}>Editar</button><button className="secondary-button compact-button" type="button" onClick={() => void remove(holiday.id)} disabled={busyId === holiday.id}>{busyId === holiday.id ? 'Removendo...' : 'Remover'}</button></div></td></tr>)}</tbody></table></div>}{editing && <Modal title="Editar feriado" onClose={() => setEditing(null)}><div className="form-grid"><TextField label="Data" value={editing.holiday_date} onChange={(holiday_date) => setEditing((current) => current ? { ...current, holiday_date } : current)} type="date" /><TextField label="Descrição" value={editing.description} onChange={(description) => setEditing((current) => current ? { ...current, description } : current)} /></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditing(null)} disabled={busyId === editing.id}>Cancelar</button><button className="primary-button" type="button" onClick={() => void saveEdit()} disabled={busyId === editing.id}>{busyId === editing.id ? 'Salvando...' : 'Salvar alterações'}</button></div></Modal>}</div>
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled = false,
  readOnly = false,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
}) {
  return (
    <label>
      <span>{label}{required ? ' *' : ''}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled} readOnly={readOnly} required={required} />
    </label>
  )
}

function ReadOnlyField({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`readonly-field ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
}) {
  return (
    <label>
      <span>{label}{required ? ' *' : ''}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function UserSelect({
  label,
  value,
  users,
  onChange,
  allowEmpty = false,
  required = false,
}: {
  label: string
  value: string
  users: UserOption[]
  onChange: (value: string) => void
  allowEmpty?: boolean
  required?: boolean
}) {
  return (
    <label>
      <span>{label}{required ? ' *' : ''}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        <option value="">{allowEmpty ? 'Não definido' : 'Selecione'}</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({user.email}){user.team_name ? ` - ${user.team_name}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function MultiSelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        multiple
        value={value}
        onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Modal({
  title,
  onClose,
  wide = false,
  scrollable = false,
  children,
}: {
  title: string
  onClose: () => void
  wide?: boolean
  scrollable?: boolean
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className={`${wide ? 'modal-card modal-card-wide' : 'modal-card'}${scrollable ? ' modal-card-scrollable' : ''}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{title}</h2>
          <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5C6.5 5 2.1 8.4 1 12c1.1 3.6 5.5 7 11 7s9.9-3.4 11-7c-1.1-3.6-5.5-7-11-7Zm0 11.2A4.2 4.2 0 1 1 12 7.8a4.2 4.2 0 0 1 0 8.4Zm0-1.9a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z"
        fill="currentColor"
      />
    </svg>
  )
}

function AppShell() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [templates, setTemplates] = useState<ActivityTemplate[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; is_active: boolean }>>([])
  const [teams, setTeams] = useState<NamedRegistry[]>([])
  const [directorates, setDirectorates] = useState<NamedRegistry[]>([])
  const [stageSettings, setStageSettings] = useState<StageSetting[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const [selectedWorkflowActivities, setSelectedWorkflowActivities] = useState<WorkflowActivity[]>([])

  const token = session?.access_token || null

  const loadProfile = async (accessToken: string) => {
    const nextProfile = await api.profile(accessToken)
    setProfile(nextProfile)
    return nextProfile
  }

  const refreshData = async (domains: RefreshDomain[]) => {
    if (!token) return
    const uniqueDomains = [...new Set(domains)]
    const requests = uniqueDomains.map((domain) => {
      const promise: Promise<unknown> = domain === 'workflows'
        ? api.workflows(token)
        : domain === 'templates'
          ? api.templates(token)
          : domain === 'users'
            ? api.users(token)
            : domain === 'logs'
              ? api.logs(token)
              : domain === 'stageSettings'
                ? profile?.is_admin ? api.stageSettings(token) : Promise.resolve([])
                : domain === 'companies'
                  ? api.companies(token)
                  : domain === 'teams'
                    ? api.teams(token)
                    : api.directorates(token)
      return { domain, promise }
    })
    const results = await Promise.allSettled(requests.map(({ promise }) => promise))
    const failures: string[] = []

    results.forEach((result, index) => {
      const domain = requests[index].domain
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : 'erro desconhecido'
        failures.push(`${domain}: ${reason}`)
        return
      }
      if (domain === 'workflows') {
        const rows = result.value as Workflow[]
        setWorkflows(rows)
        if (!selectedWorkflowId && rows[0]?.id) setSelectedWorkflowId(rows[0].id)
      } else if (domain === 'templates') setTemplates(result.value as ActivityTemplate[])
      else if (domain === 'users') setUsers(result.value as UserOption[])
      else if (domain === 'logs') setLogs(result.value as AuditLog[])
      else if (domain === 'stageSettings') setStageSettings(result.value as StageSetting[])
      else if (domain === 'companies') setCompanies(result.value as Array<{ id: string; name: string; is_active: boolean }>)
      else if (domain === 'teams') setTeams(result.value as NamedRegistry[])
      else setDirectorates(result.value as NamedRegistry[])
    })

    if (failures.length) setError(`Não foi possível atualizar: ${failures.join(' | ')}`)
  }

  const refreshAll = () => refreshData(['workflows', 'templates', 'users', 'logs', 'stageSettings', 'companies', 'teams', 'directorates'])

  const refreshActivities = async (workflowId: string | null) => {
    if (!token || !workflowId) {
      setSelectedWorkflowActivities([])
      return
    }
    const rows = await api.workflowActivities(token, workflowId)
    setSelectedWorkflowActivities(rows)
  }

  const refreshInitialData = useEffectEvent(() => refreshData(['workflows']))

  useEffect(() => {
    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)
      if (data.session?.access_token) {
        await loadProfile(data.session.access_token)
      }
      setLoading(false)
    }
    void bootstrap()

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setProfile(null)
      }
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!token || !profile || profile.first_login_required) return
    void refreshInitialData()
  }, [token, profile])

  if (loading) {
    return <div className="auth-shell"><div className="auth-card"><p>Carregando sessão...</p></div></div>
  }

  if (!session || !token) {
    return (
      <LoginRegisterPage
        onAuthenticated={async () => {
          const activeSession = (await supabase.auth.getSession()).data.session
          if (activeSession?.access_token) {
            await loadProfile(activeSession.access_token)
          }
        }}
      />
    )
  }

  if (profile?.first_login_required) {
    return <FirstLoginPage token={token} onDone={async () => { await loadProfile(token); await refreshAll() }} />
  }

  const context: AppContextShape = {
    session,
    profile,
    token,
    workflows,
    templates,
    users,
      companies,
      teams,
      directorates,
    stageSettings,
    logs,
    selectedWorkflowId,
    selectedWorkflowActivities,
    error,
    success,
    setError,
    setSuccess,
    setSelectedWorkflowId,
    refreshData,
    refreshAll,
    refreshActivities,
  }

  return (
    <BrowserRouter>
      <ProtectedLayout context={context} />
    </BrowserRouter>
  )
}

export default function App() {
  return <AppShell />
}
