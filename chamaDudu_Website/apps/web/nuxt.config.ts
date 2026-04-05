import { resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  srcDir: 'src',

  // Fix: Generate index.html for SPA deployment
  ssr: false,

  devtools: { enabled: false },

  alias: {
    '#shared': resolve(__dirname, './shared')
  },

  modules: ['@nuxt/image'],

  nitro: {
    output: {
      publicDir: resolve(__dirname, 'dist')
    },
    externals: {
      inline: [
        '@phosphor-icons/vue',
        '@nuxt/image',
        'vue',
        'vue-router',
        'vue/server-renderer'
      ]
    }
  },

  serverHandlers: [
    {
      route: '/api/pre-cadastro',
      handler: '~/server/api/pre-cadastro.post.ts'
    }
  ],


  build: {
    transpile: ['@phosphor-icons/vue', '@nuxt/image']
  },

  image: {
    provider: 'none'
  },

  components: [
    { path: '~/components' },
    { path: '~/sections' }
  ],

  css: ['~/styles/global.css'],

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {}
    }
  },

  app: {
    head: {
      title: 'Chama Dudu | Delivery de Bebida Gelada em Paulista e Grande Recife',
      htmlAttrs: { lang: 'pt-BR' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'O maior delivery de bebidas da Região Metropolitana do Recife e Paulista-PE! Chama o Dudu e peça agora: cerveja gelada, refrigerante, destilados e gelo direto no WhatsApp. Sem app, sem taxas abusivas. Atendemos Janga, Pau Amarelo, Maranguape e mais de 16 bairros no Grande Recife.'
        },
        {
          name: 'keywords',
          content: 'chama dudu, entrega bebidas paulista pe, grande recife delivery, regiao metropolitana recife bebidas, ze delivery paulista alternativo, deposito aberto agora paulista, cerveja gelada paulista, janga delivery, pau amarelo entrega, maranguape deposito, olinda delivery, abreu e lima bebidas, arthur lundgren, maria farinha, bot whatsapp bebidas recife, whatsapp delivery bebidas pernambuco'
        },
        // Open Graph
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: 'https://chamadudu.web.app/' },
        { property: 'og:site_name', content: 'Chama Dudu' },
        { property: 'og:title', content: 'Chama Dudu — Deposito Aberto Agora em Paulista-PE' },
        { property: 'og:description', content: 'Alternativa local ao Ze Delivery. Bebida gelada em minutos via WhatsApp. 16 bairros em Paulista-PE.' },
        { property: 'og:image', content: 'https://chamadudu.web.app/og-image.png' },
        { property: 'og:locale', content: 'pt_BR' },
        // Twitter / X
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'Chama Dudu | Delivery de Bebidas em Paulista-PE' },
        { name: 'twitter:description', content: 'Bora agilizar esse pedido? O Dudu entrega sua gelada em minutos em 16 bairros de Paulista-PE!' },
        { name: 'twitter:image', content: 'https://chamadudu.web.app/og-image.png' },
        // GEO / AEO (motores generativos: Perplexity, ChatGPT SGE, Gemini)
        { name: 'geo.region', content: 'BR-PE' },
        { name: 'geo.placename', content: 'Paulista, Grande Recife, Pernambuco, Brasil' },
        { name: 'geo.position', content: '-7.9403;-34.8814' },
        { name: 'ICBM', content: '-7.9403, -34.8814' },
        // Brand Search / CWI
        { name: 'application-name', content: 'Chama Dudu' },
        { name: 'robots', content: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
        { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/icon-512.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'stylesheet', href: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'dns-prefetch', href: 'https://firebasestorage.googleapis.com' },
        { rel: 'sitemap', type: 'application/xml', title: 'Sitemap', href: '/sitemap.xml' },
      ],
      script: [
        { src: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js' }
      ]
    }
  },

  runtimeConfig: {
    public: {
      apiBaseUrl:
        process.env.VITE_API_BASE_URL ||
        process.env.NUXT_PUBLIC_API_BASE_URL ||
        '',
      siteUrl:
        process.env.VITE_SITE_URL ||
        process.env.NUXT_PUBLIC_SITE_URL ||
        '',
      ogImageUrl:
        process.env.VITE_OG_IMAGE_URL ||
        process.env.NUXT_PUBLIC_OG_IMAGE_URL ||
        '',
      analyticsId:
        process.env.VITE_ANALYTICS_ID ||
        process.env.NUXT_PUBLIC_ANALYTICS_ID ||
        '',
      defaultTenantId:
        process.env.VITE_DEFAULT_TENANT_ID ||
        process.env.NUXT_PUBLIC_DEFAULT_TENANT_ID ||
        '',
      firebaseApiKey:
        process.env.VITE_FIREBASE_API_KEY ||
        process.env.NUXT_PUBLIC_FIREBASE_API_KEY ||
        '',
      firebaseAuthDomain:
        process.env.VITE_FIREBASE_AUTH_DOMAIN ||
        process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
        '',
      firebaseProjectId:
        process.env.VITE_FIREBASE_PROJECT_ID ||
        process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID ||
        '',
      firebaseStorageBucket:
        process.env.VITE_FIREBASE_STORAGE_BUCKET ||
        process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
        '',
      firebaseMessagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
        process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
        '',
      firebaseAppId:
        process.env.VITE_FIREBASE_APP_ID ||
        process.env.NUXT_PUBLIC_FIREBASE_APP_ID ||
        '',
      firebaseMeasurementId:
        process.env.VITE_FIREBASE_MEASUREMENT_ID ||
        process.env.NUXT_PUBLIC_FIREBASE_MEASUREMENT_ID ||
        '',
      whatsappUrl: process.env.NUXT_PUBLIC_WHATSAPP_URL || '',
      cityLabel: process.env.NUXT_PUBLIC_CITY_LABEL || 'Paulista, PE',
      supportedDdds:
        process.env.VITE_SUPPORTED_DDDS ||
        process.env.NUXT_PUBLIC_SUPPORTED_DDDS ||
        '81'
    },
    adminPassword: process.env.ADMIN_PASSWORD || '',
    depositTokenSalt: process.env.DEPOSIT_TOKEN_SALT || '',
    opsAdminApiKey:
      process.env.OPS_ADMIN_API_KEY ||
        '',
  },

  typescript: {
    strict: true
  },

  sourcemap: {
    server: false,
    client: false
  },

  compatibilityDate: '2026-04-03'
})
