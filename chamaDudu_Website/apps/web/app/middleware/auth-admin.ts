export default defineNuxtRouteMiddleware(() => {
  const adminCookie = useCookie('dudu_admin')
  if (!adminCookie.value) {
    return navigateTo('/admin/login')
  }
})
