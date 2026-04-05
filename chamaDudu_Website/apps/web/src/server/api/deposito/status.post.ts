import { z } from 'zod'
import { getDepositoSession } from '../../utils/auth'
import { readJson, writeJsonAtomic } from '../../utils/storage'
import type { Deposit } from '#shared/types'

const schema = z.object({
  status: z.enum(['open', 'closed'])
})

export default defineEventHandler(async (event) => {
  const depositoId = getDepositoSession(event)
  if (!depositoId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Nao autorizado'
    })
  }

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dados invalidos',
      data: { message: 'Status invalido.' }
    })
  }

  const deposits = await readJson<Deposit[]>('deposits.json', [])
  const index = deposits.findIndex((item) => item.id === depositoId)
  if (index === -1) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deposito nao encontrado'
    })
  }

  deposits[index] = { ...deposits[index], status: parsed.data.status }
  await writeJsonAtomic('deposits.json', deposits)

  return deposits[index]
})
