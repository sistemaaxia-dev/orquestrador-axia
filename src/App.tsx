import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { api } from './lib/api'
import './App.css'

type ViewKey = 'home' | 'activities' | 'history' | 'users'
type WorkflowStatus = 'Em andamento' | 'Nao iniciado' | 'Concluido'
type ActivityStatus = 'Liberada' | 'Bloqueada' | 'Concluida' | 'Reprovada'
type ActivityResult = 'Feito' | 'Aprovado' | 'Reprovado' | 'Nao Feito' | ''
type ActivityType = 'Execucao' | 'Validacao' | 'Aprovacao' | 'Liberacao' | 'Envio'
type ActivityActionMode = 'none' | 'readonly' | 'approval' | 'execution'
type StatusFilter = 'Pendentes' | 'Concluidas' | 'Todas'

type WorkflowCard = {
  id: string
  nome: string
  rotina: 'Mensal' | 'Trimestral'
  periodo: string
  descricao: string
  dataInicio: string
  prazo: string
  status: WorkflowStatus
  concluidas: number
  liberadas: number
  total: number
  etapaAtual: string
  responsavelAtual: string
}

type Activity = {
  id: string
  workflowId: string
  workflowNome: string
  ordem: number
  empresa: string
  nome: string
  etapa: string
  tipo: ActivityType
  prazo: string
  responsavel: string
  revisor?: string
  aprovador?: string
  exigeAprovacao: boolean
  exigeAnexo: boolean
  attachmentName?: string
  status: ActivityStatus
  resultado: ActivityResult
  dataLiberacao?: string
  dataConclusao?: string
  dataAprovacao?: string
  dataReprovacao?: string
}

type HistoryItem = {
  id: string
  workflowId: string
  workflowNome: string
  atividade: string
  acao: string
  dataHora: string
  observacao: string
}

type UserRole = {
  id: string
  area: string
  perfil: string
  titular: string
  backup: string
  email: string
  online: boolean
  ativo: boolean
}

const currentUserEmail = import.meta.env.VITE_DEV_USER_EMAIL || 'aline.valle@empresa.com'
const currentUser =
  import.meta.env.VITE_DEV_USER_NAME ||
  currentUserEmail
    .split('@')[0]
    .split('.')
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

function formatDateTime(value?: string) {
  if (!value) {
    return 'A definir'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function deriveWorkflowStage(status: WorkflowStatus, released: number, total: number) {
  if (status === 'Concluido') {
    return 'Finalizado'
  }
  if (total === 0) {
    return 'Sem atividades'
  }
  if (released > 0) {
    return 'Em execucao'
  }
  return 'Aguardando'
}

function mapWorkflow(row: Record<string, unknown>): WorkflowCard {
  const status = (row.status as WorkflowStatus) || 'Nao iniciado'
  const liberadas = Number(row.released_activities || 0)
  const total = Number(row.total_activities || 0)

  return {
    id: String(row.id),
    nome: String(row.name || ''),
    rotina: (row.routine as 'Mensal' | 'Trimestral') || 'Mensal',
    periodo: String(row.period || ''),
    descricao: String(row.description || 'Workflow operacional sem descricao detalhada.'),
    dataInicio: String(row.start_at || ''),
    prazo: String(row.due_at || ''),
    status,
    concluidas: Number(row.completed_activities || 0),
    liberadas,
    total,
    etapaAtual: deriveWorkflowStage(status, liberadas, total),
    responsavelAtual: String(row.participant_email || currentUserEmail),
  }
}

function mapActivity(row: Record<string, unknown>): Activity {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowNome: String(row.workflow_name || row.workflow_name || row.workflowNome || ''),
    ordem: Number(row.order_index || 0),
    empresa: String(row.company_name || ''),
    nome: String(row.name || ''),
    etapa: String(row.stage || ''),
    tipo: (row.activity_type as ActivityType) || 'Execucao',
    prazo: String(row.due_at || ''),
    responsavel: String(row.responsible_user_email || ''),
    revisor: row.reviewer_user_email ? String(row.reviewer_user_email) : undefined,
    aprovador: row.approver_user_email ? String(row.approver_user_email) : undefined,
    exigeAprovacao: Boolean(row.requires_approval),
    exigeAnexo: Boolean(row.requires_attachment),
    attachmentName: row.sharepoint_file_name ? String(row.sharepoint_file_name) : undefined,
    status: (row.status as ActivityStatus) || 'Bloqueada',
    resultado: (row.result as ActivityResult) || '',
    dataLiberacao: row.created_at ? String(row.created_at) : undefined,
    dataConclusao: row.updated_at && row.status === 'Concluida' ? String(row.updated_at) : undefined,
    dataAprovacao: row.updated_at && row.result === 'Aprovado' ? String(row.updated_at) : undefined,
    dataReprovacao:
      row.updated_at && (row.result === 'Reprovado' || row.result === 'Nao Feito')
        ? String(row.updated_at)
        : undefined,
  }
}

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('home')
  const [showWorkflowForm, setShowWorkflowForm] = useState(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Pendentes')
  const [logWorkflowFilter, setLogWorkflowFilter] = useState<string | 'all'>('all')
  const [draggedActivityId, setDraggedActivityId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [workflows, setWorkflows] = useState<WorkflowCard[]>([])
  const [workflowActivities, setWorkflowActivities] = useState<Activity[]>([])
  const [myActivitiesState, setMyActivitiesState] = useState<Activity[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [users, setUsers] = useState<UserRole[]>([])

  const [newWorkflow, setNewWorkflow] = useState({
    nome: '',
    rotina: 'Mensal' as WorkflowCard['rotina'],
    periodo: '',
    descricao: '',
    dataInicio: '',
    prazo: '',
  })

  const [newActivity, setNewActivity] = useState({
    empresa: '',
    nome: '',
    etapa: 'Recebimento',
    tipo: 'Execucao' as ActivityType,
    prazo: '',
    responsavel: currentUserEmail,
    revisor: '',
    aprovador: '',
    exigeAprovacao: false,
    exigeAnexo: false,
  })

  const workflowNameMap = useMemo(
    () =>
      workflows.reduce<Record<string, string>>((accumulator, workflow) => {
        accumulator[workflow.id] = workflow.nome
        return accumulator
      }, {}),
    [workflows],
  )

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  )

  const selectedWorkflowActivities = useMemo(
    () => [...workflowActivities].sort((left, right) => left.ordem - right.ordem),
    [workflowActivities],
  )

  const availablePeople = useMemo(() => {
    const emails = users.flatMap((user) => [user.email])
    return Array.from(new Set([currentUserEmail, ...emails])).filter(Boolean)
  }, [users])

  const myActivities = useMemo(() => {
    const byStatus =
      statusFilter === 'Pendentes'
        ? myActivitiesState.filter((activity) => activity.status === 'Liberada')
        : statusFilter === 'Concluidas'
          ? myActivitiesState.filter(
              (activity) => activity.status === 'Concluida' || activity.status === 'Reprovada',
            )
          : myActivitiesState

    return [...byStatus].sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'Liberada' ? -1 : 1
      }
      return left.ordem - right.ordem
    })
  }, [myActivitiesState, statusFilter])

  const selectedActivity = useMemo(
    () => myActivities.find((activity) => activity.id === selectedActivityId) ?? null,
    [myActivities, selectedActivityId],
  )

  const selectedActionMode = useMemo<ActivityActionMode>(() => {
    if (!selectedActivity) {
      return 'none'
    }

    if (selectedActivity.status !== 'Liberada') {
      return 'readonly'
    }

    return selectedActivity.exigeAprovacao ? 'approval' : 'execution'
  }, [selectedActivity])

  const filteredHistory = useMemo(() => {
    const byWorkflow =
      logWorkflowFilter === 'all'
        ? history
        : history.filter((item) => item.workflowId === logWorkflowFilter)

    return [...byWorkflow].sort(
      (left, right) => new Date(right.dataHora).getTime() - new Date(left.dataHora).getTime(),
    )
  }, [history, logWorkflowFilter])

  const selectedWorkflowHistory = useMemo(() => {
    if (!selectedWorkflow) {
      return []
    }

    return history
      .filter((item) => item.workflowId === selectedWorkflow.id)
      .sort((left, right) => new Date(right.dataHora).getTime() - new Date(left.dataHora).getTime())
      .slice(0, 4)
  }, [history, selectedWorkflow])

  const loadBaseData = async () => {
    setErrorMessage('')
    const [workflowRows, myActivityRows, logRows, userRows] = await Promise.all([
      api.workflows(currentUserEmail),
      api.myActivities(currentUserEmail),
      api.logs(undefined, currentUserEmail),
      api.users(currentUserEmail),
    ])

    const mappedWorkflows = (workflowRows as Record<string, unknown>[]).map(mapWorkflow)
    const mappedMyActivities = (myActivityRows as Record<string, unknown>[]).map(mapActivity)
    const mappedUsers = (userRows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      area: String(row.area || ''),
      perfil: String(row.role_name || ''),
      titular: String(row.full_name || ''),
      backup: '',
      email: String(row.email || ''),
      online: Boolean(row.is_online),
      ativo: Boolean(row.is_active),
    }))
    const mappedHistory = (logRows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      workflowId: String(row.workflow_id || ''),
      workflowNome: workflowNameMap[String(row.workflow_id || '')] || String(row.workflow_id || ''),
      atividade: String(row.activity_name || ''),
      acao: String(row.action || ''),
      dataHora: String(row.performed_at || ''),
      observacao: String(row.notes || ''),
    }))

    setWorkflows(mappedWorkflows)
    setMyActivitiesState(mappedMyActivities)
    setUsers(mappedUsers)
    setHistory(mappedHistory)
  }

  const loadWorkflowActivities = async (workflowId: string) => {
    const rows = await api.workflowActivities(workflowId, currentUserEmail)
    const workflowName = workflows.find((workflow) => workflow.id === workflowId)?.nome || ''
    setWorkflowActivities(
      (rows as Record<string, unknown>[]).map((row) =>
        mapActivity({
          ...row,
          workflow_name: workflowName,
        }),
      ),
    )
  }

  const refreshEverything = async (workflowId?: string | null) => {
    await loadBaseData()
    if (workflowId) {
      await loadWorkflowActivities(workflowId)
    }
  }

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setLoading(true)
        await loadBaseData()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Falha ao carregar dados.')
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  useEffect(() => {
    if (!selectedWorkflowId) {
      setWorkflowActivities([])
      return
    }

    const fetchActivities = async () => {
      try {
        await loadWorkflowActivities(selectedWorkflowId)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Falha ao carregar atividades do workflow.')
      }
    }

    void fetchActivities()
  }, [selectedWorkflowId])

  useEffect(() => {
    if (selectedActivityId && !myActivities.some((activity) => activity.id === selectedActivityId)) {
      setSelectedActivityId(myActivities[0]?.id || null)
    }
  }, [myActivities, selectedActivityId])

  const reorderWorkflowActivities = async (draggedId: string, targetId: string) => {
    if (!selectedWorkflow || draggedId === targetId) {
      return
    }

    const workflowItems = [...selectedWorkflowActivities]
    const draggedIndex = workflowItems.findIndex((activity) => activity.id === draggedId)
    const targetIndex = workflowItems.findIndex((activity) => activity.id === targetId)

    if (draggedIndex === -1 || targetIndex === -1) {
      return
    }

    const [draggedItem] = workflowItems.splice(draggedIndex, 1)
    workflowItems.splice(targetIndex, 0, draggedItem)

    const orderedIds = workflowItems.map((activity) => activity.id)

    try {
      setSubmitting(true)
      await api.reorderWorkflowActivities(selectedWorkflow.id, orderedIds, currentUserEmail)
      await loadWorkflowActivities(selectedWorkflow.id)
      await loadBaseData()
      setSuccessMessage('Ordem das atividades atualizada.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao reordenar atividades.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateWorkflow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (
      !newWorkflow.nome.trim() ||
      !newWorkflow.periodo.trim() ||
      !newWorkflow.dataInicio ||
      !newWorkflow.prazo
    ) {
      setErrorMessage('Preencha nome, periodo, data de inicio e prazo.')
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage('')
      await api.createWorkflow(
        {
          name: newWorkflow.nome.trim(),
          routine: newWorkflow.rotina,
          period: newWorkflow.periodo.trim(),
          description: newWorkflow.descricao.trim(),
          start_at: newWorkflow.dataInicio,
          due_at: newWorkflow.prazo,
        },
        currentUserEmail,
      )

      await loadBaseData()
      setShowWorkflowForm(false)
      setNewWorkflow({
        nome: '',
        rotina: 'Mensal',
        periodo: '',
        descricao: '',
        dataInicio: '',
        prazo: '',
      })
      setSuccessMessage('Workflow salvo no Supabase.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao criar workflow.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedWorkflow || !newActivity.empresa.trim() || !newActivity.nome.trim() || !newActivity.prazo) {
      setErrorMessage('Preencha empresa, nome e prazo da atividade.')
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage('')
      await api.createWorkflowActivity(
        selectedWorkflow.id,
        {
          company_name: newActivity.empresa.trim(),
          name: newActivity.nome.trim(),
          stage: newActivity.etapa,
          activity_type: newActivity.tipo,
          due_at: newActivity.prazo,
          responsible_user_email: newActivity.responsavel,
          reviewer_user_email: newActivity.revisor || null,
          approver_user_email: newActivity.aprovador || null,
          requires_approval: newActivity.exigeAprovacao,
          requires_attachment: newActivity.exigeAnexo,
        },
        currentUserEmail,
      )

      await refreshEverything(selectedWorkflow.id)
      setNewActivity({
        empresa: '',
        nome: '',
        etapa: 'Recebimento',
        tipo: 'Execucao',
        prazo: '',
        responsavel: currentUserEmail,
        revisor: '',
        aprovador: '',
        exigeAprovacao: false,
        exigeAnexo: false,
      })
      setSuccessMessage('Atividade registrada no workflow.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao registrar atividade.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecision = async (result: 'Feito' | 'Nao Feito' | 'Aprovado' | 'Reprovado') => {
    if (!selectedActivity) {
      return
    }

    if (selectedActivity.exigeAnexo && !selectedActivity.attachmentName) {
      setErrorMessage('Esta atividade exige anexo antes da decisao.')
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage('')
      await api.decideActivity(
        selectedActivity.id,
        {
          action: result,
          notes: `Acao registrada no app: ${result}`,
        },
        currentUserEmail,
      )
      await refreshEverything(selectedWorkflowId)
      setSuccessMessage(`Acao ${result} registrada com sucesso.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao registrar decisao.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!selectedActivity || !file) {
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage('')
      await api.uploadAttachment(selectedActivity.id, file, currentUserEmail)
      await refreshEverything(selectedWorkflowId)
      setSuccessMessage('Anexo enviado com sucesso.')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Falha ao enviar anexo. A integracao SharePoint pode ainda nao estar configurada.',
      )
    } finally {
      setSubmitting(false)
      event.target.value = ''
    }
  }

  const updateUser = async (id: string, key: keyof UserRole, value: string | boolean) => {
    setUsers((current) =>
      current.map((user) => (user.id === id ? { ...user, [key]: value } : user)),
    )

    const current = users.find((user) => user.id === id)
    if (!current) {
      return
    }

    const payloadByKey: Record<string, unknown> = {
      full_name: key === 'titular' ? value : current.titular,
      email: key === 'email' ? value : current.email,
      area: key === 'area' ? value : current.area,
      role_name: key === 'perfil' ? value : current.perfil,
      is_online: key === 'online' ? value : current.online,
      is_active: key === 'ativo' ? value : current.ativo,
    }

    try {
      await api.updateUser(id, payloadByKey, currentUserEmail)
      setSuccessMessage('Usuario atualizado.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao atualizar usuario.')
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <main className="workspace">
          <section className="content-panel">
            <div className="empty-state hero-empty">
              <strong>Conectando ao Supabase...</strong>
              <span>Estamos carregando workflows, atividades, log e usuarios reais.</span>
            </div>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <strong>Orquestrador</strong>
            <span>Planeje. Organize. Execute.</span>
          </div>
        </div>

        <nav className="nav-links">
          <button
            className={activeView === 'home' ? 'nav-link active' : 'nav-link'}
            onClick={() => setActiveView('home')}
          >
            Home
          </button>
          <button
            className={activeView === 'activities' ? 'nav-link active' : 'nav-link'}
            onClick={() => setActiveView('activities')}
          >
            Atividades
          </button>
          <button
            className={activeView === 'history' ? 'nav-link active' : 'nav-link'}
            onClick={() => setActiveView('history')}
          >
            Log
          </button>
          <button
            className={activeView === 'users' ? 'nav-link active' : 'nav-link'}
            onClick={() => setActiveView('users')}
          >
            Usuarios
          </button>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-strip" />
          <div className="topbar-brandline">
            <small>Portal operacional</small>
            <strong>Fechamento contabil e controle de etapas</strong>
          </div>
          <div className="topbar-user">
            <div>
              <span>{currentUser}</span>
              <small>{currentUserEmail}</small>
            </div>
            <div className="avatar">
              {currentUser
                .split(' ')
                .map((part: string) => part.charAt(0))
                .join('')
                .slice(0, 2)}
            </div>
          </div>
        </header>

        <section className="content-panel">
          {errorMessage && <div className="helper-note">{errorMessage}</div>}
          {successMessage && <div className="helper-note">{successMessage}</div>}

          {activeView === 'home' && (
            <>
              <div className="section-heading">
                <div>
                  <h1>Workflows</h1>
                  <p>Crie o workflow primeiro. Depois clique nele para montar, revisar e ordenar as atividades.</p>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setShowWorkflowForm((current) => !current)}
                >
                  {showWorkflowForm ? 'Fechar criacao' : '+ Novo workflow'}
                </button>
              </div>

              {showWorkflowForm && (
                <section className="modal-panel">
                  <div className="builder-head">
                    <div>
                      <h2>Criar Workflow</h2>
                      <p>Defina a capa do fechamento: nome, rotina, data de inicio e prazo principal.</p>
                    </div>
                    <span className="section-badge">Etapa 1</span>
                  </div>

                  <form className="builder-form" onSubmit={(event) => void handleCreateWorkflow(event)}>
                    <label>
                      <span>Nome do workflow</span>
                      <input
                        value={newWorkflow.nome}
                        onChange={(event) =>
                          setNewWorkflow((current) => ({ ...current, nome: event.target.value }))
                        }
                        placeholder="Ex.: Fechamento Outubro"
                      />
                    </label>

                    <label>
                      <span>Rotina</span>
                      <select
                        value={newWorkflow.rotina}
                        onChange={(event) =>
                          setNewWorkflow((current) => ({
                            ...current,
                            rotina: event.target.value as WorkflowCard['rotina'],
                          }))
                        }
                      >
                        <option value="Mensal">Mensal</option>
                        <option value="Trimestral">Trimestral</option>
                      </select>
                    </label>

                    <label>
                      <span>Periodo</span>
                      <input
                        value={newWorkflow.periodo}
                        onChange={(event) =>
                          setNewWorkflow((current) => ({ ...current, periodo: event.target.value }))
                        }
                        placeholder="08/2026 ou 3T/2026"
                      />
                    </label>

                    <label>
                      <span>Data de inicio</span>
                      <input
                        type="datetime-local"
                        value={newWorkflow.dataInicio}
                        onChange={(event) =>
                          setNewWorkflow((current) => ({ ...current, dataInicio: event.target.value }))
                        }
                      />
                    </label>

                    <label>
                      <span>Prazo</span>
                      <input
                        type="datetime-local"
                        value={newWorkflow.prazo}
                        onChange={(event) =>
                          setNewWorkflow((current) => ({ ...current, prazo: event.target.value }))
                        }
                      />
                    </label>

                    <label className="full-width">
                      <span>Descricao</span>
                      <textarea
                        rows={3}
                        value={newWorkflow.descricao}
                        onChange={(event) =>
                          setNewWorkflow((current) => ({ ...current, descricao: event.target.value }))
                        }
                        placeholder="Resumo executivo do workflow"
                      />
                    </label>

                    <button className="primary-button full-width" type="submit" disabled={submitting}>
                      {submitting ? 'Salvando...' : 'Salvar workflow'}
                    </button>
                  </form>
                </section>
              )}

              <div className="workflow-list">
                {workflows.map((workflow) => (
                  <article
                    key={workflow.id}
                    className={selectedWorkflow?.id === workflow.id ? 'workflow-card selected' : 'workflow-card'}
                    onClick={() => setSelectedWorkflowId(workflow.id)}
                  >
                    <div className="workflow-main">
                      <div>
                        <h2>{workflow.nome}</h2>
                        <div className="workflow-meta">
                          <span>{workflow.rotina}</span>
                          <span>Periodo: {workflow.periodo}</span>
                          <span>Etapa atual: {workflow.etapaAtual}</span>
                        </div>
                      </div>
                      <span className={`status-pill workflow-status ${workflow.status}`}>{workflow.status}</span>
                    </div>

                    <p className="workflow-description">{workflow.descricao}</p>

                    <div className="workflow-dates">
                      <div>
                        <label>Inicio</label>
                        <strong>{formatDateTime(workflow.dataInicio)}</strong>
                      </div>
                      <div>
                        <label>Prazo</label>
                        <strong>{formatDateTime(workflow.prazo)}</strong>
                      </div>
                    </div>

                    <div className="workflow-stats">
                      <div className="stat-box done">
                        <strong>{workflow.concluidas}</strong>
                        <span>Atividades concluidas</span>
                      </div>
                      <div className="stat-box running">
                        <strong>{workflow.liberadas}</strong>
                        <span>Atividades liberadas</span>
                      </div>
                      <div className="stat-box total">
                        <strong>{workflow.total}</strong>
                        <span>Total de atividades</span>
                      </div>
                    </div>

                    <div className="workflow-footer">
                      <span className="workflow-owner">Participante: {workflow.responsavelAtual}</span>
                      <span className="workflow-id">WF #{workflow.id.slice(0, 8)}</span>
                    </div>
                  </article>
                ))}
              </div>

              {selectedWorkflow ? (
                <div className="workflow-detail-board">
                  <section className="builder-panel wide">
                    <div className="builder-head">
                      <div>
                        <h2>Atividades do Workflow</h2>
                        <p>Cliquei no workflow, agora aparece tudo que ja entrou nele e a ordem operacional.</p>
                      </div>
                      <span className="section-badge accent">Etapa 2</span>
                    </div>

                    <div className="workflow-focus-card">
                      <div>
                        <small>Workflow ativo</small>
                        <strong>{selectedWorkflow.nome}</strong>
                        <span>
                          {selectedWorkflow.rotina} • Periodo {selectedWorkflow.periodo} • Inicio{' '}
                          {formatDateTime(selectedWorkflow.dataInicio)}
                        </span>
                      </div>
                      <span className={`status-pill workflow-status ${selectedWorkflow.status}`}>
                        {selectedWorkflow.status}
                      </span>
                    </div>

                    <div className="workflow-activity-list tall">
                      {selectedWorkflowActivities.map((activity) => (
                        <div
                          key={activity.id}
                          className={
                            draggedActivityId === activity.id
                              ? 'workflow-activity-row dragging'
                              : 'workflow-activity-row'
                          }
                          draggable
                          onDragStart={() => setDraggedActivityId(activity.id)}
                          onDragEnd={() => setDraggedActivityId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (draggedActivityId !== null) {
                              void reorderWorkflowActivities(draggedActivityId, activity.id)
                            }
                            setDraggedActivityId(null)
                          }}
                        >
                          <div className="workflow-activity-main">
                            <small>Ordem {activity.ordem}</small>
                            <strong>{activity.nome}</strong>
                            <span>
                              {activity.empresa} • {activity.etapa} • {activity.tipo}
                            </span>
                            <span>Prazo: {formatDateTime(activity.prazo)}</span>
                          </div>

                          <div className="workflow-activity-actions">
                            <button
                              type="button"
                              className="ghost-order"
                              onClick={() => {
                                const previous = selectedWorkflowActivities.find(
                                  (item) => item.ordem === activity.ordem - 1,
                                )
                                if (previous) {
                                  void reorderWorkflowActivities(activity.id, previous.id)
                                }
                              }}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="ghost-order"
                              onClick={() => {
                                const next = selectedWorkflowActivities.find(
                                  (item) => item.ordem === activity.ordem + 1,
                                )
                                if (next) {
                                  void reorderWorkflowActivities(activity.id, next.id)
                                }
                              }}
                            >
                              ↓
                            </button>
                            <span className={`status-pill activity-status ${activity.status}`}>{activity.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="helper-note">
                      Arraste, suba ou desca atividades para montar a trilha real do fechamento.
                    </div>
                  </section>

                  <section className="builder-panel">
                    <div className="builder-head">
                      <div>
                        <h2>Adicionar atividade</h2>
                        <p>Registre novas atividades neste workflow especifico sempre que a cliente pedir mais detalhe.</p>
                      </div>
                    </div>

                    <form className="builder-form" onSubmit={(event) => void handleCreateActivity(event)}>
                      <label>
                        <span>Empresa</span>
                        <input
                          value={newActivity.empresa}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, empresa: event.target.value }))
                          }
                          placeholder="Ex.: Chesf, Eletrosul, Holding"
                        />
                      </label>

                      <label>
                        <span>Nome da atividade</span>
                        <input
                          value={newActivity.nome}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, nome: event.target.value }))
                          }
                          placeholder="Ex.: Envio relatorio de depositos"
                        />
                      </label>

                      <label>
                        <span>Etapa</span>
                        <select
                          value={newActivity.etapa}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, etapa: event.target.value }))
                          }
                        >
                          <option value="Recebimento">Recebimento</option>
                          <option value="Contabilizacao">Contabilizacao</option>
                          <option value="Apuracao">Apuracao</option>
                          <option value="Consolidacao">Consolidacao</option>
                        </select>
                      </label>

                      <label>
                        <span>Tipo</span>
                        <select
                          value={newActivity.tipo}
                          onChange={(event) =>
                            setNewActivity((current) => ({
                              ...current,
                              tipo: event.target.value as ActivityType,
                            }))
                          }
                        >
                          <option value="Execucao">Execucao</option>
                          <option value="Validacao">Validacao</option>
                          <option value="Aprovacao">Aprovacao</option>
                          <option value="Liberacao">Liberacao</option>
                          <option value="Envio">Envio</option>
                        </select>
                      </label>

                      <label>
                        <span>Prazo</span>
                        <input
                          type="datetime-local"
                          value={newActivity.prazo}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, prazo: event.target.value }))
                          }
                        />
                      </label>

                      <label>
                        <span>Responsavel</span>
                        <select
                          value={newActivity.responsavel}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, responsavel: event.target.value }))
                          }
                        >
                          {availablePeople.map((person) => (
                            <option key={person} value={person}>
                              {person}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Revisor</span>
                        <select
                          value={newActivity.revisor}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, revisor: event.target.value }))
                          }
                        >
                          <option value="">Nao definido</option>
                          {availablePeople.map((person) => (
                            <option key={person} value={person}>
                              {person}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Aprovador</span>
                        <select
                          value={newActivity.aprovador}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, aprovador: event.target.value }))
                          }
                        >
                          <option value="">Nao definido</option>
                          {availablePeople.map((person) => (
                            <option key={person} value={person}>
                              {person}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={newActivity.exigeAprovacao}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, exigeAprovacao: event.target.checked }))
                          }
                        />
                        <span>Exige aprovacao</span>
                      </label>

                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={newActivity.exigeAnexo}
                          onChange={(event) =>
                            setNewActivity((current) => ({ ...current, exigeAnexo: event.target.checked }))
                          }
                        />
                        <span>Exige anexo</span>
                      </label>

                      <button className="primary-button full-width" type="submit" disabled={submitting}>
                        {submitting ? 'Registrando...' : 'Registrar atividade neste workflow'}
                      </button>
                    </form>
                  </section>
                </div>
              ) : (
                <div className="empty-state hero-empty">
                  <strong>Escolha um workflow para montar as atividades.</strong>
                  <span>Quando voce clicar em um card acima, a estrutura detalhada dele aparece aqui embaixo.</span>
                </div>
              )}
            </>
          )}

          {activeView === 'activities' && (
            <>
              <div className="section-heading">
                <div>
                  <h1>Minhas Atividades</h1>
                  <p>Somente tarefas em que eu apareco como responsavel, revisor ou aprovador.</p>
                </div>

                <div className="filter-row">
                  <label className="filter-control">
                    <span>Status</span>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    >
                      <option value="Pendentes">Pendentes</option>
                      <option value="Concluidas">Concluidas</option>
                      <option value="Todas">Todas</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="activity-layout">
                <div className="activity-list">
                  {myActivities.map((activity) => (
                    <button
                      key={activity.id}
                      type="button"
                      className={selectedActivity?.id === activity.id ? 'activity-card active' : 'activity-card'}
                      onClick={() => setSelectedActivityId(activity.id)}
                    >
                      <div className="activity-title-row">
                        <div className="activity-heading-stack">
                          <small>{activity.empresa}</small>
                          <strong>{activity.nome}</strong>
                        </div>
                        <span className={`status-pill activity-status ${activity.status}`}>{activity.status}</span>
                      </div>

                      <div className="activity-grid">
                        <span>Etapa: {activity.etapa}</span>
                        <span>Workflow: {activity.workflowNome}</span>
                        <span>Tipo: {activity.tipo}</span>
                        <span>Prazo: {formatDateTime(activity.prazo)}</span>
                      </div>
                    </button>
                  ))}

                  {myActivities.length === 0 && (
                    <div className="empty-state">
                      <strong>Nenhuma atividade neste filtro.</strong>
                      <span>Quando algo for liberado no seu nome, vai aparecer aqui.</span>
                    </div>
                  )}
                </div>

                <aside className="detail-panel">
                  {selectedActivity ? (
                    <>
                      <div className="detail-header">
                        <div>
                          <h2>{selectedActivity.nome}</h2>
                          <p>
                            {selectedActivity.workflowNome} • {selectedActivity.empresa}
                          </p>
                        </div>
                        <span className={`status-pill activity-status ${selectedActivity.status}`}>
                          {selectedActivity.status}
                        </span>
                      </div>

                      <div className="detail-grid">
                        <div>
                          <label>Workflow</label>
                          <span>{selectedActivity.workflowNome}</span>
                        </div>
                        <div>
                          <label>Etapa</label>
                          <span>{selectedActivity.etapa}</span>
                        </div>
                        <div>
                          <label>Empresa</label>
                          <span>{selectedActivity.empresa}</span>
                        </div>
                        <div>
                          <label>Tipo</label>
                          <span>{selectedActivity.tipo}</span>
                        </div>
                        <div>
                          <label>Prazo</label>
                          <span>{formatDateTime(selectedActivity.prazo)}</span>
                        </div>
                        <div>
                          <label>Responsavel</label>
                          <span>{selectedActivity.responsavel}</span>
                        </div>
                        <div>
                          <label>Revisor</label>
                          <span>{selectedActivity.revisor || '-'}</span>
                        </div>
                        <div>
                          <label>Aprovador</label>
                          <span>{selectedActivity.aprovador || '-'}</span>
                        </div>
                        <div>
                          <label>Exige anexo</label>
                          <span>{selectedActivity.exigeAnexo ? 'Sim' : 'Nao'}</span>
                        </div>
                        <div>
                          <label>Resultado atual</label>
                          <span>{selectedActivity.resultado || 'Aguardando tratamento'}</span>
                        </div>
                      </div>

                      {selectedActivity.exigeAnexo && (
                        <div className="upload-panel">
                          <label className="upload-label">
                            <span>Anexo obrigatorio</span>
                            <input type="file" onChange={(event) => void handleAttachmentChange(event)} />
                          </label>
                          <p>{selectedActivity.attachmentName || 'Nenhum arquivo anexado ainda.'}</p>
                        </div>
                      )}

                      <div className="action-bar">
                        {selectedActionMode === 'execution' && (
                          <>
                            <button className="danger-button" type="button" onClick={() => void handleDecision('Nao Feito')}>
                              Nao Feito
                            </button>
                            <button className="success-button" type="button" onClick={() => void handleDecision('Feito')}>
                              Feito
                            </button>
                          </>
                        )}

                        {selectedActionMode === 'approval' && (
                          <>
                            <button className="danger-button" type="button" onClick={() => void handleDecision('Reprovado')}>
                              Reprovado
                            </button>
                            <button className="success-button" type="button" onClick={() => void handleDecision('Aprovado')}>
                              Aprovado
                            </button>
                          </>
                        )}

                        {selectedActionMode === 'readonly' && (
                          <div className="readonly-note">
                            Esta atividade ja foi tratada. O log continua registrando o historico do workflow.
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state detail-empty">
                      <strong>Selecione uma atividade.</strong>
                      <span>O detalhe aparece aqui com prazo, responsaveis, anexo e botoes de acao.</span>
                    </div>
                  )}
                </aside>
              </div>
            </>
          )}

          {activeView === 'history' && (
            <>
              <div className="section-heading">
                <div>
                  <h1>Log operacional</h1>
                  <p>Registro de aprovacoes, feito, nao feito, reprovacoes, anexos e liberacoes por workflow.</p>
                </div>

                <label className="filter-control">
                  <span>Workflow</span>
                  <select
                    value={logWorkflowFilter}
                    onChange={(event) => setLogWorkflowFilter(event.target.value)}
                  >
                    <option value="all">Todos os workflows</option>
                    {workflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="history-list">
                {filteredHistory.map((item) => (
                  <article key={item.id} className="history-card">
                    <div className="history-top">
                      <strong>{item.atividade}</strong>
                      <span className="history-time">{formatDateTime(item.dataHora)}</span>
                    </div>
                    <div className="history-meta">
                      <span>{item.workflowNome || workflowNameMap[item.workflowId] || item.workflowId}</span>
                      <span>{item.acao}</span>
                    </div>
                    <p>{item.observacao}</p>
                  </article>
                ))}
              </div>
            </>
          )}

          {activeView === 'users' && (
            <>
              <div className="section-heading">
                <div>
                  <h1>Usuarios e Perfis</h1>
                  <p>Defina titulares, emails, online e o responsavel por cada area do fluxo.</p>
                </div>
              </div>

              <div className="user-table">
                <div className="user-row user-head">
                  <span>Area</span>
                  <span>Perfil</span>
                  <span>Titular</span>
                  <span>Backup</span>
                  <span>Email</span>
                  <span>Online</span>
                  <span>Ativo</span>
                </div>

                {users.map((user) => (
                  <div key={user.id} className="user-row">
                    <span>{user.area || '-'}</span>
                    <span>{user.perfil || '-'}</span>
                    <input
                      value={user.titular}
                      onChange={(event) => void updateUser(user.id, 'titular', event.target.value)}
                    />
                    <input value={user.backup} readOnly placeholder="Proxima etapa" />
                    <input
                      value={user.email}
                      onChange={(event) => void updateUser(user.id, 'email', event.target.value)}
                    />

                    <label className="toggle-chip">
                      <input
                        type="checkbox"
                        checked={user.online}
                        onChange={(event) => void updateUser(user.id, 'online', event.target.checked)}
                      />
                      <span className={user.online ? 'online-dot live' : 'online-dot'} />
                      {user.online ? 'Online' : 'Offline'}
                    </label>

                    <label className="toggle-chip">
                      <input
                        type="checkbox"
                        checked={user.ativo}
                        onChange={(event) => void updateUser(user.id, 'ativo', event.target.checked)}
                      />
                      {user.ativo ? 'Ativo' : 'Inativo'}
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}

          {selectedWorkflow && activeView === 'home' && selectedWorkflowHistory.length > 0 && (
            <section className="mini-log">
              <div className="section-heading compact">
                <div>
                  <h1>Ultimos eventos do workflow</h1>
                  <p>{selectedWorkflow.nome}</p>
                </div>
              </div>

              <div className="history-list">
                {selectedWorkflowHistory.map((item) => (
                  <article key={item.id} className="history-card">
                    <div className="history-top">
                      <strong>{item.atividade}</strong>
                      <span className="history-time">{formatDateTime(item.dataHora)}</span>
                    </div>
                    <div className="history-meta">
                      <span>{item.workflowNome || selectedWorkflow.nome}</span>
                      <span>{item.acao}</span>
                    </div>
                    <p>{item.observacao}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
