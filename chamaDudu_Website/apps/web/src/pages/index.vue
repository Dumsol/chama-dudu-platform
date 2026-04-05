<script setup lang="ts">
import { siteContent } from '~/content/pt-BR'
import { usePageSeo } from '~/lib/seo'

usePageSeo({
  path: '/',
  title: siteContent.landing.title,
  description: siteContent.landing.description,
  faq: siteContent.faq,
  localBusiness: true
})
</script>

<template>
  <div class="min-h-screen bg-white">
    <AppHeader />
    <main>
      <LandingHeroSection />
      <HowItWorksSection />
      <BenefitsSection />
      <CoverageSection />
      <PartnerSection />
      <FaqSection />
      <AppCtaSection />
    </main>
    <AppFooter />
  </div>
</template>
