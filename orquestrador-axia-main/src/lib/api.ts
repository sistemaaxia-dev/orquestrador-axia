const API_BASE_URL = import.meta.env.DEV
  ? import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api'
  : '/api'

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  token?: string
  body?: unknown
  isFormData?: boolean
}

const GET_CACHE_TTL_MS = 15_000
const responseCache = new Map<string, { expiresAt: number; value: unknown }>()
const inFlightRequests = new Map<string, Promise<unknown>>()
let cacheGeneration = 0

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || 'GET'
  const cacheKey = `${options.token ? options.token.slice(-12) : 'public'}:${path}`
  if (method === 'GET') {
    const cached = responseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value as T
    const inFlight = inFlightRequests.get(cacheKey)
    if (inFlight) return inFlight as Promise<T>
  } else {
    cacheGeneration += 1
    responseCache.clear()
    inFlightRequests.clear()
  }

  const execute = async () => {
    const isFormData = options.isFormData && options.body instanceof FormData
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body ? (isFormData ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
    })

    if (!response.ok) {
      const responseText = await response.text()
      let payload: { error?: string; message?: string; details?: string } = {}
      try {
        payload = responseText ? JSON.parse(responseText) : {}
      } catch {
        payload = {}
      }

      const detail = payload.error || payload.message || payload.details
      const fallback = `A API recusou ${method} ${path} (${response.status}).`
      throw new Error(detail || fallback)
    }

    return response.json() as Promise<T>
  }

  if (method !== 'GET') return execute()
  const requestGeneration = cacheGeneration
  const pending = execute()
  inFlightRequests.set(cacheKey, pending)
  try {
    const value = await pending
    if (requestGeneration === cacheGeneration) {
      responseCache.set(cacheKey, { expiresAt: Date.now() + GET_CACHE_TTL_MS, value })
    }
    return value
  } finally {
    if (inFlightRequests.get(cacheKey) === pending) inFlightRequests.delete(cacheKey)
  }
}

export const api = {
  register: (name: string, email: string, password: string, confirmPassword: string) =>
    request<{ message: string }>('/auth/register', {
      method: 'POST',
      body: { name, email, password, confirm_password: confirmPassword },
    }),
  startAccess: (email: string) => request<{ message: string }>('/auth/start-access', { method: 'POST', body: { email } }),
  profile: (token: string) =>
    request<{
      id: string
      email: string
      name: string
      role: string
      is_admin: boolean
      first_login_required: boolean
    }>('/auth/profile', { token }),
  completeFirstLogin: (token: string, newPassword: string, confirmPassword: string) =>
    request<{ message: string }>('/auth/complete-first-login', {
      method: 'POST',
      token,
      body: { new_password: newPassword, confirm_password: confirmPassword },
    }),
  workflows: (token: string) => request<any[]>('/workflows', { token }),
  createWorkflow: (token: string, body: unknown) => request<any>('/workflows', { method: 'POST', token, body }),
  updateWorkflow: (token: string, workflowId: string, body: unknown) => request<any>(`/workflows/${workflowId}`, { method: 'PATCH', token, body }),
  duplicateWorkflow: (token: string, workflowId: string) => request<any>(`/workflows/${workflowId}/duplicate`, { method: 'POST', token }),
  deleteWorkflow: (token: string, workflowId: string) => request<{ message: string }>(`/workflows/${workflowId}`, { method: 'DELETE', token }),
  workflowActivities: (token: string, workflowId: string) => request<any[]>(`/workflows/${workflowId}/activities`, { token }),
  createWorkflowActivity: (token: string, workflowId: string, body: unknown) =>
    request<any>(`/workflows/${workflowId}/activities`, { method: 'POST', token, body }),
  linkTemplates: (token: string, workflowId: string, templateIds: string[]) =>
    request<any[]>(`/workflows/${workflowId}/activity-links`, { method: 'POST', token, body: { template_ids: templateIds } }),
  templates: (token: string) => request<any[]>('/activity-templates', { token }),
  createTemplate: (token: string, body: unknown) => request<any>('/activity-templates', { method: 'POST', token, body }),
  updateTemplate: (token: string, templateId: string, body: unknown) =>
    request<any>(`/activity-templates/${templateId}`, { method: 'PATCH', token, body }),
  myActivities: (token: string) => request<any[]>('/activities/my', { token }),
  allActivities: (token: string) => request<any[]>('/activities', { token }),
  updateActivity: (token: string, activityId: string, body: unknown) =>
    request<any>(`/workflow-activities/${activityId}`, { method: 'PATCH', token, body }),
  deleteActivity: (token: string, activityId: string) => request<{ message: string }>(`/workflow-activities/${activityId}`, { method: 'DELETE', token }),
  actOnActivity: (token: string, activityId: string, action: string, notes = '') =>
    request<any>(`/workflow-activities/${activityId}/actions`, { method: 'POST', token, body: { action, notes } }),
  completeActivity: (token: string, activityId: string, file?: File) => {
    const formData = new FormData()
    if (file) formData.append('file', file)
    return request<any>(`/workflow-activities/${activityId}/complete`, {
      method: 'POST',
      token,
      body: formData,
      isFormData: true,
    })
  },
  uploadAttachment: (token: string, activityId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<any>(`/workflow-activities/${activityId}/attachments`, {
      method: 'POST',
      token,
      body: formData,
      isFormData: true,
    })
  },
  logs: (token: string, workflowId?: string) =>
    request<any[]>(workflowId ? `/logs?workflow_id=${workflowId}` : '/logs', { token }),
  users: (token: string) => request<any[]>('/users', { token }),
  createUser: (token: string, body: unknown) => request<any>('/users', { method: 'POST', token, body }),
  updateUser: (token: string, userId: string, body: unknown) =>
    request<any>(`/users/${userId}`, { method: 'PATCH', token, body }),
  stageSettings: (token: string) => request<any[]>('/settings/stages', { token }),
  updateStageSetting: (token: string, stageName: string, body: unknown) =>
    request<any>(`/settings/stages/${stageName}`, { method: 'PUT', token, body }),
  companies: (token: string) => request<any[]>('/settings/companies', { token }),
  createCompany: (token: string, body: unknown) => request<any>('/settings/companies', { method: 'POST', token, body }),
  updateCompany: (token: string, companyId: string, body: unknown) => request<any>(`/settings/companies/${companyId}`, { method: 'PATCH', token, body }),
  holidays: (token: string, companyId: string) => request<any[]>(`/settings/companies/${companyId}/holidays`, { token }),
  createHoliday: (token: string, companyId: string, body: unknown) => request<any>(`/settings/companies/${companyId}/holidays`, { method: 'POST', token, body }),
  globalHolidays: (token: string) => request<any[]>('/settings/holidays', { token }),
  createGlobalHoliday: (token: string, body: unknown) => request<any>('/settings/holidays', { method: 'POST', token, body }),
  updateHoliday: (token: string, holidayId: string, body: unknown) => request<any>(`/settings/holidays/${holidayId}`, { method: 'PATCH', token, body }),
  deleteHoliday: (token: string, holidayId: string) => request<{ message: string }>(`/settings/holidays/${holidayId}`, { method: 'DELETE', token }),
  deadlinePreview: (token: string, body: unknown) => request<{ expected_end_date: string }>('/settings/deadline-preview', { method: 'POST', token, body }),
  teams: (token: string) => request<any[]>('/settings/teams', { token }),
  createTeam: (token: string, body: unknown) => request<any>('/settings/teams', { method: 'POST', token, body }),
  updateTeam: (token: string, teamId: string, body: unknown) => request<any>(`/settings/teams/${teamId}`, { method: 'PATCH', token, body }),
  deleteTeam: (token: string, teamId: string) => request<{ message: string }>(`/settings/teams/${teamId}`, { method: 'DELETE', token }),
  directorates: (token: string) => request<any[]>('/settings/directorates', { token }),
  createDirectorate: (token: string, body: unknown) => request<any>('/settings/directorates', { method: 'POST', token, body }),
  updateDirectorate: (token: string, directorateId: string, body: unknown) => request<any>(`/settings/directorates/${directorateId}`, { method: 'PATCH', token, body }),
  deleteDirectorate: (token: string, directorateId: string) => request<{ message: string }>(`/settings/directorates/${directorateId}`, { method: 'DELETE', token }),
}
