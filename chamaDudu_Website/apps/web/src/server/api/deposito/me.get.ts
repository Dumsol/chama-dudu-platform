import { getDepositoSession } from '../../utils/auth'
import { readJson } from '../../utils/storage'
import type { Deposit } from '#shared/types'

export default defineEventHandler(async (event) => {
  const depositoId = getDepositoSession(event)
  if (!depositoId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Nao autorizado'
    })
  }

  const deposits = await readJson<Deposit[]>('deposits.json', [])
  const deposito = deposits.find((item) => item.id === depositoId)
  if (!deposito) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deposito nao encontrado'
    })
  }

  return deposito
})
