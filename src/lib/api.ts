const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  token?: string
  devEmail?: string
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.devEmail ? { 'X-Dev-User-Email': options.devEmail } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
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
  workflowActivities: (workflowId: string, devEmail?: string) =>
    request<unknown[]>(`/workflows/${workflowId}/activities`, { devEmail }),
  logs: (workflowId?: string, devEmail?: string) =>
    request<unknown[]>(workflowId ? `/logs?workflow_id=${workflowId}` : '/logs', { devEmail }),
  myActivities: (devEmail?: string) => request<unknown[]>('/activities/my', { devEmail }),
  users: (devEmail?: string) => request<unknown[]>('/users', { devEmail }),
}
