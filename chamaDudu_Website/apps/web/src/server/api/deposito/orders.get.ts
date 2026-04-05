import { getDepositoSession } from '../../utils/auth'
import { readJson } from '../../utils/storage'
import type { Order } from '#shared/types'

export default defineEventHandler(async (event) => {
  const depositoId = getDepositoSession(event)
  if (!depositoId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Nao autorizado'
    })
  }

  const orders = await readJson<Order[]>('orders.json', [])
  return orders.filter((order) => order.depositoId === depositoId)
})
