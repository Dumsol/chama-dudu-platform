import { randomBytes } from 'crypto'
import { z } from 'zod'
import { readJson, writeJsonAtomic } from '../../utils/storage'
import type { Deposit, Order, OrderItem } from '#shared/types'

const schema = z.object({
  depositoId: z.string().optional(),
  clienteNome: z.string().optional(),
  clienteWhatsapp: z.string().optional(),
  bairro: z.string().optional(),
  endereco: z.string().optional(),
  itens: z
    .array(
      z.object({
        nome: z.string(),
        qtd: z.number().int().positive(),
        preco: z.number().positive()
      })
    )
    .optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body || {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dados invalidos',
      data: { message: 'Corpo da requisicao invalido.' }
    })
  }

  const deposits = await readJson<Deposit[]>('deposits.json', [])
  const orders = await readJson<Order[]>('orders.json', [])

  const deposit = deposits.find((item) => item.id === parsed.data.depositoId) || deposits[0]

  const itens: OrderItem[] =
    parsed.data.itens || [
      { nome: 'Cerveja lata', qtd: 6, preco: 2.5 },
      { nome: 'Refrigerante 2L', qtd: 1, preco: 8.9 }
    ]

  const itensTotal = itens.reduce((sum, item) => sum + item.qtd * item.preco, 0)
  const taxa = 0.99
  const total = (itensTotal + taxa).toFixed(2)

  const order: Order = {
    id: `ord_${Date.now()}_${randomBytes(2).toString('hex')}`,
    depositoId: deposit?.id || 'dep_temp',
    depositoNome: deposit?.nome || 'Deposito Dudu',
    depositoWhatsapp: deposit?.whatsapp || '0000000000',
    clienteNome: parsed.data.clienteNome || 'Cliente Dudu',
    clienteWhatsapp: parsed.data.clienteWhatsapp || '0000000000',
    bairro: parsed.data.bairro || 'Centro',
    endereco: parsed.data.endereco || 'Rua principal, 123',
    itens,
    total,
    taxa,
    createdAt: new Date().toISOString()
  }

  orders.unshift(order)
  await writeJsonAtomic('orders.json', orders)

  return order
})
