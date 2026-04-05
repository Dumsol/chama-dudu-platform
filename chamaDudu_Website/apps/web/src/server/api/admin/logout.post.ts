import { clearAdminSession } from '../../utils/auth'

export default defineEventHandler((event) => {
  clearAdminSession(event)
  return { ok: true }
})
