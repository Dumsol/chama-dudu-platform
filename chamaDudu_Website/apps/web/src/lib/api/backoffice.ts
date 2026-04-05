import { apiFetch } from './client'

export async function loginDeposito(token: string): Promise<void> {
  await apiFetch('/api/deposito/login', {
    method: 'POST',
    body: { token }
  })
}

export async function logoutDeposito(): Promise<void> {
  await apiFetch('/api/deposito/logout', {
    method: 'POST'
  })
}

export async function updateDepositoStatus(status: 'open' | 'closed'): Promise<void> {
  await apiFetch('/api/deposito/status', {
    method: 'POST',
    body: { status }
  })
}

export async function loginAdmin(password: string): Promise<void> {
  await apiFetch('/admin/login', {
    method: 'POST',
    body: { password }
  })

  // Se o fetch não lançar erro, consideramos autorizado
  const authCookie = useCookie('dudu_admin')
  authCookie.value = 'authorized'
}

export async function logoutAdmin(): Promise<void> {
  await apiFetch('/api/admin/logout', {
    method: 'POST'
  })
}
