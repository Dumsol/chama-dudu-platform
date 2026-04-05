import { clearDepositoSession } from '../../utils/auth'

export default defineEventHandler((event) => {
  clearDepositoSession(event)
  return { ok: true }
})
