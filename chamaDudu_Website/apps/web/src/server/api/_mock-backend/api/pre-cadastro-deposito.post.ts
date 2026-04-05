export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const nomeDeposito = String(body?.nomeDeposito ?? '').toLowerCase()

  if (nomeDeposito.includes('erro')) {
    throw createError({
      statusCode: 503,
      statusMessage: 'mock_backend_unavailable',
      data: { message: 'Mock backend indisponivel.' }
    })
  }

  return {
    ok: true,
    id: `mock_${Date.now().toString(36)}`
  }
})
