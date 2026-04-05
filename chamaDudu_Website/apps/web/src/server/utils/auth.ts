import { createHash } from 'crypto'
import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'

const ADMIN_COOKIE = 'dudu_admin'
const DEPOSITO_COOKIE = 'dudu_deposito'

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production'
}

export const setAdminSession = (event: H3Event) => {
  setCookie(event, ADMIN_COOKIE, '1', cookieOptions)
}

export const clearAdminSession = (event: H3Event) => {
  deleteCookie(event, ADMIN_COOKIE, { path: '/' })
}

export const getAdminSession = (event: H3Event) => getCookie(event, ADMIN_COOKIE)

export const setDepositoSession = (event: H3Event, depositoId: string) => {
  setCookie(event, DEPOSITO_COOKIE, depositoId, cookieOptions)
}

export const clearDepositoSession = (event: H3Event) => {
  deleteCookie(event, DEPOSITO_COOKIE, { path: '/' })
}

export const getDepositoSession = (event: H3Event) => getCookie(event, DEPOSITO_COOKIE)

export const hashToken = (token: string, salt: string) =>
  createHash('sha256').update(`${token}:${salt}`).digest('hex')
