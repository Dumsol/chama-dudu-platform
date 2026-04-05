import { getAdminSession } from '../../utils/auth'
import { readJson } from '../../utils/storage'
import type { Deposit, Lead, Order } from '#shared/types'

export default defineEventHandler(async (event) => {
  if (!getAdminSession(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Nao autorizado'
    })
  }

  const leads = await readJson<Lead[]>('leads.json', [])
  const deposits = await readJson<Deposit[]>('deposits.json', [])
  const orders = await readJson<Order[]>('orders.json', [])

  return {
    leads,
    deposits,
    orders
  }
})
