import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type ViewKey = 'home' | 'activities' | 'history' | 'users'
type WorkflowStatus = 'Em andamento' | 'Nao iniciado' | 'Concluido'
type ActivityStatus = 'Liberada' | 'Bloqueada' | 'Concluida' | 'Reprovada'
type ActivityResult = 'Feito' | 'Aprovado' | 'Reprovado' | 'Nao Feito' | ''
type ActivityType = 'Execucao' | 'Validacao' | 'Aprovacao' | 'Liberacao' | 'Envio'
type ActivityActionMode = 'none' | 'readonly' | 'approval' | 'execution'
type StatusFilter = 'Pendentes' | 'Concluidas' | 'Todas'

type Workflow = {
  id: number
  nome: string
  rotina: 'Mensal' | 'Trimestral'
  periodo: string
  descricao: string
  dataInicio: string
  prazo: string
}

type Activity = {
  id: number
  workflowId: number
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
  id: number
  workflowId: number
  workflowNome: string
  atividade: string
  acao: string
  dataHora: string
  observacao: string
}

type UserRole = {
  id: number
  area: string
  perfil: string
  titular: string
  backup: string
  email: string
  online: boolean
  ativo: boolean
}

const currentUser = 'Aline Valle'

const workflowSeed: Workflow[] = [
  {
    id: 1,
    nome: 'Fechamento Agosto',
    rotina: 'Mensal',
    periodo: '08/2026',
    descricao: 'Fechamento mensal com recebimento, apuracao e consolidacao.',
    dataInicio: '2026-08-20T08:00',
    prazo: '2026-08-29T18:00',
  },
  {
    id: 2,
    nome: 'Fechamento Setembro',
    rotina: 'Mensal',
    periodo: '09/2026',
    descricao: 'Workflow aguardando carga operacional das empresas.',
    dataInicio: '2026-09-01T08:30',
    prazo: '2026-09-30T18:00',
  },
  {
    id: 3,
    nome: 'Fechamento 3T',
    rotina: 'Trimestral',
    periodo: '3T/2026',
    descricao: 'Rotina trimestral com consolidacao e frente de RI.',
    dataInicio: '2026-09-15T09:00',
    prazo: '2026-09-28T17:00',
  },
]

const activitySeed: Activity[] = [
  {
    id: 101,
    workflowId: 1,
    workflowNome: 'Fechamento Agosto',
    ordem: 1,
    empresa: 'Holding',
    nome: 'Relatorio de Contingencia',
    etapa: 'Recebimento',
    tipo: 'Envio',
    prazo: '2026-08-21T11:00',
    responsavel: currentUser,
    revisor: 'Leandra Nunes',
    exigeAprovacao: false,
    exigeAnexo: true,
    status: 'Liberada',
    resultado: '',
    dataLiberacao: '2026-08-20T08:00',
  },
  {
    id: 102,
    workflowId: 1,
    workflowNome: 'Fechamento Agosto',
    ordem: 2,
    empresa: 'Holding',
    nome: 'Envio relatorio de depositos',
    etapa: 'Recebimento',
    tipo: 'Envio',
    prazo: '2026-08-21T13:00',
    responsavel: currentUser,
    revisor: 'Leandra Nunes',
    exigeAprovacao: false,
    exigeAnexo: true,
    status: 'Bloqueada',
    resultado: '',
  },
  {
    id: 103,
    workflowId: 1,
    workflowNome: 'Fechamento Agosto',
    ordem: 3,
    empresa: 'Holding',
    nome: 'Fechamento etapa recebimento',
    etapa: 'Recebimento',
    tipo: 'Validacao',
    prazo: '2026-08-21T16:00',
    responsavel: 'Leandra Nunes',
    aprovador: 'Leandra Nunes',
    exigeAprovacao: true,
    exigeAnexo: false,
    status: 'Bloqueada',
    resultado: '',
  },
  {
    id: 104,
    workflowId: 1,
    workflowNome: 'Fechamento Agosto',
    ordem: 4,
    empresa: 'Holding',
    nome: 'Inicio etapa contabilizacao e conciliacao',
    etapa: 'Contabilizacao',
    tipo: 'Execucao',
    prazo: '2026-08-22T09:00',
    responsavel: 'Carlos Contador',
    revisor: currentUser,
    exigeAprovacao: false,
    exigeAnexo: false,
    status: 'Bloqueada',
    resultado: '',
  },
  {
    id: 105,
    workflowId: 1,
    workflowNome: 'Fechamento Agosto',
    ordem: 5,
    empresa: 'Holding',
    nome: 'Contador valida os dados',
    etapa: 'Contabilizacao',
    tipo: 'Validacao',
    prazo: '2026-08-22T11:00',
    responsavel: 'Carlos Contador',
    aprovador: currentUser,
    exigeAprovacao: true,
    exigeAnexo: false,
    status: 'Bloqueada',
    resultado: '',
  },
  {
    id: 201,
    workflowId: 3,
    workflowNome: 'Fechamento 3T',
    ordem: 1,
    empresa: 'Controladora',
    nome: 'Rodar BD e sincronizar para Workiva',
    etapa: 'Consolidacao',
    tipo: 'Execucao',
    prazo: '2026-09-25T18:00',
    responsavel: currentUser,
    revisor: 'Controladoria',
    exigeAprovacao: false,
    exigeAnexo: true,
    status: 'Liberada',
    resultado: '',
    dataLiberacao: '2026-09-15T09:00',
  },
]

const historySeed: HistoryItem[] = [
  {
    id: 1,
    workflowId: 1,
    workflowNome: 'Fechamento Agosto',
    atividade: 'Workflow',
    acao: 'Criado',
    dataHora: '2026-08-12T18:00',
    observacao: 'Workflow criado para o fechamento mensal.',
  },
]

const usersSeed: UserRole[] = [
  {
    id: 1,
    area: 'Recebimento',
    perfil: 'ResponsavelRecebimento',
    titular: currentUser,
    backup: 'Daniele CSC',
    email: 'aline.valle@empresa.com',
    online: true,
    ativo: true,
  },
  {
    id: 2,
    area: 'Apuracao',
    perfil: 'Tributario',
    titular: 'Leandra Nunes',
    backup: currentUser,
    email: 'leandra.nunes@empresa.com',
    online: true,
    ativo: true,
  },
  {
    id: 3,
    area: 'Contabilizacao',
    perfil: 'Contador',
    titular: 'Carlos Contador',
    backup: currentUser,
    email: 'carlos.contador@empresa.com',
    online: false,
    ativo: true,
  },
  {
    id: 4,
    area: 'Consolidacao',
    perfil: 'Controladoria',
    titular: 'Time Controladoria',
    backup: currentUser,
    email: 'controladoria@empresa.com',
    online: true,
    ativo: true,
  },
]

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

function deriveWorkflowStatus(items: Activity[]): WorkflowStatus {
  if (items.length === 0) {
    return 'Nao iniciado'
  }

  if (items.every((item) => item.status === 'Concluida')) {
    return 'Concluido'
  }

  if (items.some((item) => item.status === 'Liberada' || item.status === 'Concluida')) {
    return 'Em andamento'
  }

  return 'Nao iniciado'
}

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('home')
  const [showWorkflowForm, setShowWorkflowForm] = useState(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null)
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Pendentes')
  const [logWorkflowFilter, setLogWorkflowFilter] = useState<number | 'all'>('all')
  const [draggedActivityId, setDraggedActivityId] = useState<number | null>(null)

  const [workflows, setWorkflows] = useState<Workflow[]>(workflowSeed)
  const [activitiesState, setActivitiesState] = useState<Activity[]>(activitySeed)
  const [history, setHistory] = useState<HistoryItem[]>(historySeed)
  const [users, setUsers] = useState<UserRole[]>(usersSeed)

  const [newWorkflow, setNewWorkflow] = useState({
    nome: '',
    rotina: 'Mensal' as Workflow['rotina'],
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
    responsavel: currentUser,
    revisor: '',
    aprovador: '',
    exigeAprovacao: false,
    exigeAnexo: false,
  })

  const workflowCards = useMemo(
    () =>
      workflows.map((workflow) => {
        const items = activitiesState
          .filter((activity) => activity.workflowId === workflow.id)
          .sort((left, right) => left.ordem - right.ordem)
        const concluidas = items.filter((activity) => activity.status === 'Concluida').length
        const liberadas = items.filter((activity) => activity.status === 'Liberada').length
        const primeiraPendente = items.find((activity) => activity.status === 'Liberada')
        const proximaBloqueada = items.find((activity) => activity.status === 'Bloqueada')
        const status = deriveWorkflowStatus(items)

        return {
          ...workflow,
          status,
          concluidas,
          liberadas,
          total: items.length,
          etapaAtual:
            primeiraPendente?.etapa ??
            proximaBloqueada?.etapa ??
            (status === 'Concluido' ? 'Finalizado' : 'Recebimento'),
          responsavelAtual:
            primeiraPendente?.responsavel ??
            proximaBloqueada?.responsavel ??
            'A definir',
        }
      }),
    [activitiesState, workflows],
  )

  const selectedWorkflow = useMemo(
    () => workflowCards.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowCards],
  )

  const selectedWorkflowActivities = useMemo(() => {
    if (!selectedWorkflow) {
      return []
    }

    return activitiesState
      .filter((activity) => activity.workflowId === selectedWorkflow.id)
      .sort((left, right) => left.ordem - right.ordem)
  }, [activitiesState, selectedWorkflow])

  const availablePeople = useMemo(() => {
    const names = users.flatMap((user) => [user.titular, user.backup])
    return Array.from(new Set([currentUser, ...names])).filter(Boolean)
  }, [users])

  const myActivities = useMemo(() => {
    const mine = activitiesState.filter(
      (activity) =>
        activity.responsavel === currentUser ||
        activity.revisor === currentUser ||
        activity.aprovador === currentUser,
    )

    const byStatus =
      statusFilter === 'Pendentes'
        ? mine.filter((activity) => activity.status === 'Liberada')
        : statusFilter === 'Concluidas'
          ? mine.filter((activity) => activity.status === 'Concluida' || activity.status === 'Reprovada')
          : mine

    return byStatus.sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'Liberada' ? -1 : 1
      }

      return left.ordem - right.ordem
    })
  }, [activitiesState, statusFilter])

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
    if (logWorkflowFilter === 'all') {
      return [...history].sort((left, right) => right.id - left.id)
    }

    return [...history]
      .filter((item) => item.workflowId === logWorkflowFilter)
      .sort((left, right) => right.id - left.id)
  }, [history, logWorkflowFilter])

  const selectedWorkflowHistory = useMemo(() => {
    if (!selectedWorkflow) {
      return []
    }

    return history
      .filter((item) => item.workflowId === selectedWorkflow.id)
      .sort((left, right) => right.id - left.id)
      .slice(0, 4)
  }, [history, selectedWorkflow])

  const addHistory = (
    workflowId: number,
    workflowNome: string,
    atividade: string,
    acao: string,
    observacao: string,
  ) => {
    setHistory((current) => [
      {
        id: Math.max(0, ...current.map((item) => item.id)) + 1,
        workflowId,
        workflowNome,
        atividade,
        acao,
        dataHora: new Date().toISOString(),
        observacao,
      },
      ...current,
    ])
  }

  const reorderWorkflowActivities = (draggedId: number, targetId: number) => {
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

    const reordered = workflowItems.map((activity, index) => ({
      ...activity,
      ordem: index + 1,
    }))

    setActivitiesState((current) =>
      current.map((activity) => reordered.find((item) => item.id === activity.id) ?? activity),
    )

    addHistory(
      selectedWorkflow.id,
      selectedWorkflow.nome,
      'Workflow',
      'Reordenacao',
      'Ordem das atividades ajustada manualmente.',
    )
  }

  const handleCreateWorkflow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (
      !newWorkflow.nome.trim() ||
      !newWorkflow.periodo.trim() ||
      !newWorkflow.dataInicio ||
      !newWorkflow.prazo
    ) {
      return
    }

    const nextId = Math.max(0, ...workflows.map((workflow) => workflow.id)) + 1
    const created: Workflow = {
      id: nextId,
      nome: newWorkflow.nome.trim(),
      rotina: newWorkflow.rotina,
      periodo: newWorkflow.periodo.trim(),
      descricao: newWorkflow.descricao.trim() || 'Workflow criado manualmente pela operacao.',
      dataInicio: newWorkflow.dataInicio,
      prazo: newWorkflow.prazo,
    }

    setWorkflows((current) => [created, ...current])
    setSelectedWorkflowId(created.id)
    setShowWorkflowForm(false)
    setNewWorkflow({
      nome: '',
      rotina: 'Mensal',
      periodo: '',
      descricao: '',
      dataInicio: '',
      prazo: '',
    })

    addHistory(created.id, created.nome, 'Workflow', 'Criado', 'Workflow criado com sucesso.')
  }

  const handleCreateActivity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedWorkflow || !newActivity.empresa.trim() || !newActivity.nome.trim() || !newActivity.prazo) {
      return
    }

    const nextId = Math.max(0, ...activitiesState.map((activity) => activity.id)) + 1
    const hasAnyReleased = selectedWorkflowActivities.some((activity) => activity.status === 'Liberada')
    const hasAnyCompleted = selectedWorkflowActivities.some((activity) => activity.status === 'Concluida')
    const shouldReleaseNow = selectedWorkflowActivities.length === 0 && !hasAnyReleased && !hasAnyCompleted

    const created: Activity = {
      id: nextId,
      workflowId: selectedWorkflow.id,
      workflowNome: selectedWorkflow.nome,
      ordem: selectedWorkflowActivities.length + 1,
      empresa: newActivity.empresa.trim(),
      nome: newActivity.nome.trim(),
      etapa: newActivity.etapa,
      tipo: newActivity.tipo,
      prazo: newActivity.prazo,
      responsavel: newActivity.responsavel.trim() || currentUser,
      revisor: newActivity.revisor.trim() || undefined,
      aprovador: newActivity.aprovador.trim() || undefined,
      exigeAprovacao: newActivity.exigeAprovacao,
      exigeAnexo: newActivity.exigeAnexo,
      status: shouldReleaseNow ? 'Liberada' : 'Bloqueada',
      resultado: '',
      dataLiberacao: shouldReleaseNow ? new Date().toISOString() : undefined,
    }

    setActivitiesState((current) => [...current, created])
    setNewActivity({
      empresa: '',
      nome: '',
      etapa: 'Recebimento',
      tipo: 'Execucao',
      prazo: '',
      responsavel: currentUser,
      revisor: '',
      aprovador: '',
      exigeAprovacao: false,
      exigeAnexo: false,
    })

    addHistory(
      selectedWorkflow.id,
      selectedWorkflow.nome,
      created.nome,
      'Cadastro',
      shouldReleaseNow
        ? 'Atividade criada e liberada automaticamente.'
        : 'Atividade criada e posicionada na fila do workflow.',
    )
  }

  const updateActivityAndRefreshSelection = (updatedList: Activity[], updatedId?: number) => {
    setActivitiesState(updatedList)

    if (updatedId) {
      setSelectedActivityId(updatedId)
    }
  }

  const unlockNextActivity = (activity: Activity, items: Activity[]) => {
    const next = items
      .filter((item) => item.workflowId === activity.workflowId && item.ordem > activity.ordem)
      .sort((left, right) => left.ordem - right.ordem)
      .find((item) => item.status === 'Bloqueada')

    if (!next) {
      return items
    }

    const updated = items.map((item) =>
      item.id === next.id
        ? {
            ...item,
            status: 'Liberada' as ActivityStatus,
            dataLiberacao: new Date().toISOString(),
          }
        : item,
    )

    addHistory(
      next.workflowId,
      next.workflowNome,
      next.nome,
      'Liberada',
      'Proxima atividade liberada automaticamente.',
    )

    return updated
  }

  const reopenPreviousActivity = (activity: Activity, items: Activity[]) => {
    const previous = items
      .filter((item) => item.workflowId === activity.workflowId && item.ordem < activity.ordem)
      .sort((left, right) => right.ordem - left.ordem)[0]

    if (!previous) {
      return items
    }

    const updated = items.map((item) =>
      item.id === previous.id
        ? {
            ...item,
            status: 'Liberada' as ActivityStatus,
            dataLiberacao: new Date().toISOString(),
          }
        : item,
    )

    addHistory(
      previous.workflowId,
      previous.workflowNome,
      previous.nome,
      'Retorno',
      'Atividade anterior reaberta por reprovacao/nao feito.',
    )

    return updated
  }

  const handleExecutionAction = (result: 'Feito' | 'Nao Feito') => {
    if (!selectedActivity) {
      return
    }

    if (selectedActivity.exigeAnexo && !selectedActivity.attachmentName) {
      return
    }

    const timestamp = new Date().toISOString()
    let updatedList = activitiesState.map((activity) =>
      activity.id === selectedActivity.id
        ? {
            ...activity,
            resultado: result,
            status: result === 'Feito' ? ('Concluida' as ActivityStatus) : ('Reprovada' as ActivityStatus),
            dataConclusao: result === 'Feito' ? timestamp : activity.dataConclusao,
            dataReprovacao: result === 'Nao Feito' ? timestamp : activity.dataReprovacao,
          }
        : activity,
    )

    addHistory(
      selectedActivity.workflowId,
      selectedActivity.workflowNome,
      selectedActivity.nome,
      result,
      result === 'Feito'
        ? 'Atividade concluida pelo responsavel.'
        : 'Atividade marcada como nao feita e fluxo devolvido.',
    )

    updatedList =
      result === 'Feito'
        ? unlockNextActivity(selectedActivity, updatedList)
        : reopenPreviousActivity(selectedActivity, updatedList)

    updateActivityAndRefreshSelection(updatedList, selectedActivity.id)
  }

  const handleApprovalAction = (result: 'Aprovado' | 'Reprovado') => {
    if (!selectedActivity) {
      return
    }

    if (selectedActivity.exigeAnexo && !selectedActivity.attachmentName) {
      return
    }

    const timestamp = new Date().toISOString()
    let updatedList = activitiesState.map((activity) =>
      activity.id === selectedActivity.id
        ? {
            ...activity,
            resultado: result,
            status: result === 'Aprovado' ? ('Concluida' as ActivityStatus) : ('Reprovada' as ActivityStatus),
            dataAprovacao: result === 'Aprovado' ? timestamp : activity.dataAprovacao,
            dataReprovacao: result === 'Reprovado' ? timestamp : activity.dataReprovacao,
          }
        : activity,
    )

    addHistory(
      selectedActivity.workflowId,
      selectedActivity.workflowNome,
      selectedActivity.nome,
      result,
      result === 'Aprovado'
        ? 'Atividade aprovada e fluxo seguiu para a proxima etapa.'
        : 'Atividade reprovada e fluxo retornou para a etapa anterior.',
    )

    updatedList =
      result === 'Aprovado'
        ? unlockNextActivity(selectedActivity, updatedList)
        : reopenPreviousActivity(selectedActivity, updatedList)

    updateActivityAndRefreshSelection(updatedList, selectedActivity.id)
  }

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!selectedActivity || !file) {
      return
    }

    const updated = activitiesState.map((activity) =>
      activity.id === selectedActivity.id ? { ...activity, attachmentName: file.name } : activity,
    )

    updateActivityAndRefreshSelection(updated, selectedActivity.id)

    addHistory(
      selectedActivity.workflowId,
      selectedActivity.workflowNome,
      selectedActivity.nome,
      'Anexo',
      `Arquivo anexado: ${file.name}`,
    )
  }

  const updateUser = (id: number, key: keyof UserRole, value: string | boolean) => {
    setUsers((current) =>
      current.map((user) => (user.id === id ? { ...user, [key]: value } : user)),
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
              <small>Online agora</small>
            </div>
            <div className="avatar">AV</div>
          </div>
        </header>

        <section className="content-panel">
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

                  <form className="builder-form" onSubmit={handleCreateWorkflow}>
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
                            rotina: event.target.value as Workflow['rotina'],
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

                    <button className="primary-button full-width" type="submit">
                      Salvar workflow
                    </button>
                  </form>
                </section>
              )}

              <div className="workflow-list">
                {workflowCards.map((workflow) => (
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
                      <span className="workflow-owner">Responsavel atual: {workflow.responsavelAtual}</span>
                      <span className="workflow-id">WF #{workflow.id}</span>
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
                          className={draggedActivityId === activity.id ? 'workflow-activity-row dragging' : 'workflow-activity-row'}
                          draggable
                          onDragStart={() => setDraggedActivityId(activity.id)}
                          onDragEnd={() => setDraggedActivityId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (draggedActivityId !== null) {
                              reorderWorkflowActivities(draggedActivityId, activity.id)
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
                                if (activity.ordem === 1) {
                                  return
                                }

                                const previous = selectedWorkflowActivities.find(
                                  (item) => item.ordem === activity.ordem - 1,
                                )
                                if (previous) {
                                  reorderWorkflowActivities(activity.id, previous.id)
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
                                  reorderWorkflowActivities(activity.id, next.id)
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
                      Arraste, suba ou desca atividades para montar a trilha real do fechamento. Aqui voce controla o macro do macro e consegue incluir novas tarefas a qualquer momento.
                    </div>
                  </section>

                  <section className="builder-panel">
                    <div className="builder-head">
                      <div>
                        <h2>Adicionar atividade</h2>
                        <p>Registre novas atividades neste workflow especifico sempre que a cliente pedir mais detalhe.</p>
                      </div>
                    </div>

                    <form className="builder-form" onSubmit={handleCreateActivity}>
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

                      <button className="primary-button full-width" type="submit">
                        Registrar atividade neste workflow
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
                            <input type="file" onChange={handleAttachmentChange} />
                          </label>
                          <p>{selectedActivity.attachmentName || 'Nenhum arquivo anexado ainda.'}</p>
                        </div>
                      )}

                      <div className="action-bar">
                        {selectedActionMode === 'execution' && (
                          <>
                            <button className="danger-button" type="button" onClick={() => handleExecutionAction('Nao Feito')}>
                              Nao Feito
                            </button>
                            <button className="success-button" type="button" onClick={() => handleExecutionAction('Feito')}>
                              Feito
                            </button>
                          </>
                        )}

                        {selectedActionMode === 'approval' && (
                          <>
                            <button className="danger-button" type="button" onClick={() => handleApprovalAction('Reprovado')}>
                              Reprovado
                            </button>
                            <button className="success-button" type="button" onClick={() => handleApprovalAction('Aprovado')}>
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
                    onChange={(event) =>
                      setLogWorkflowFilter(
                        event.target.value === 'all' ? 'all' : Number(event.target.value),
                      )
                    }
                  >
                    <option value="all">Todos os workflows</option>
                    {workflowCards.map((workflow) => (
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
                      <span>{item.workflowNome}</span>
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
                  <p>Defina titulares, backups, emails, online e o responsavel por cada area do fluxo.</p>
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
                    <span>{user.area}</span>
                    <span>{user.perfil}</span>
                    <input value={user.titular} onChange={(event) => updateUser(user.id, 'titular', event.target.value)} />
                    <input value={user.backup} onChange={(event) => updateUser(user.id, 'backup', event.target.value)} />
                    <input value={user.email} onChange={(event) => updateUser(user.id, 'email', event.target.value)} />

                    <label className="toggle-chip">
                      <input
                        type="checkbox"
                        checked={user.online}
                        onChange={(event) => updateUser(user.id, 'online', event.target.checked)}
                      />
                      <span className={user.online ? 'online-dot live' : 'online-dot'} />
                      {user.online ? 'Online' : 'Offline'}
                    </label>

                    <label className="toggle-chip">
                      <input
                        type="checkbox"
                        checked={user.ativo}
                        onChange={(event) => updateUser(user.id, 'ativo', event.target.checked)}
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
                      <span>{item.workflowNome}</span>
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
