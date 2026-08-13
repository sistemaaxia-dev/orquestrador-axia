const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  token?: string
  devEmail?: string
  isFormData?: boolean
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const isFormData = options.isFormData && options.body instanceof FormData
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.devEmail ? { 'X-Dev-User-Email': options.devEmail } : {}),
    },
    body: options.body ? (isFormData ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
  })

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(errorPayload.error || 'Falha na comunicacao com a API.')
  }

  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  workflows: (devEmail?: string) => request<unknown[]>('/workflows', { devEmail }),
  createWorkflow: (body: unknown, devEmail?: string) =>
    request<unknown>('/workflows', { method: 'POST', body, devEmail }),
  workflowActivities: (workflowId: string, devEmail?: string) =>
    request<unknown[]>(`/workflows/${workflowId}/activities`, { devEmail }),
  createWorkflowActivity: (workflowId: string, body: unknown, devEmail?: string) =>
    request<unknown>(`/workflows/${workflowId}/activities`, { method: 'POST', body, devEmail }),
  reorderWorkflowActivities: (workflowId: string, orderedIds: string[], devEmail?: string) =>
    request<unknown[]>(`/workflows/${workflowId}/activities/reorder`, {
      method: 'PATCH',
      body: { ordered_ids: orderedIds },
      devEmail,
    }),
  logs: (workflowId?: string, devEmail?: string) =>
    request<unknown[]>(workflowId ? `/logs?workflow_id=${workflowId}` : '/logs', { devEmail }),
  myActivities: (devEmail?: string) => request<unknown[]>('/activities/my', { devEmail }),
  decideActivity: (activityId: string, body: unknown, devEmail?: string) =>
    request<unknown>(`/activities/${activityId}/decision`, { method: 'POST', body, devEmail }),
  uploadAttachment: (activityId: string, file: File, devEmail?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<unknown>(`/activities/${activityId}/attachments`, {
      method: 'POST',
      body: formData,
      devEmail,
      isFormData: true,
    })
  },
  users: (devEmail?: string) => request<unknown[]>('/users', { devEmail }),
  updateUser: (userId: string, body: unknown, devEmail?: string) =>
    request<unknown>(`/users/${userId}`, { method: 'PATCH', body, devEmail }),
}
