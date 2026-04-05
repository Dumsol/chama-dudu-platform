export default defineNuxtRouteMiddleware(() => {
  const depositoCookie = useCookie('dudu_deposito')
  if (!depositoCookie.value) {
    return navigateTo('/_ops/deposito-login')
  }
})
