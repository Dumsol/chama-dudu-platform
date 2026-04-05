import { readJson } from '../../utils/storage'
import type { Order } from '#shared/types'

export default defineEventHandler(async (event) => {
  const orderId = event.context.params?.orderId
  const orders = await readJson<Order[]>('orders.json', [])
  const order = orders.find((item) => item.id === orderId)

  if (!order) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Pedido nao encontrado'
    })
  }

  return order
})
