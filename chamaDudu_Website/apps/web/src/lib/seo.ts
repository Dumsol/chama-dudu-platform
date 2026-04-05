import type { FaqItem } from '~/content/pt-BR'

type SeoInput = {
  path: string
  title: string
  description: string
  faq?: FaqItem[]
  /** Adiciona schema LocalBusiness para AEO/GEO (páginas de bairro / home) */
  localBusiness?: boolean
}

function buildCanonical(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${cleanBase}${path}`
}

/**
 * SEO completo: On-Page SEO + AEO (Answer Engine) + GEO (Generative Engine)
 * + SXO (Search Experience) + CWI (Core Web Intent) + Brand Search
 *
 * Structured data emitidos:
 *  - Organization (Brand Search: "Chama Dudu")
 *  - WebSite + SearchAction (Sitelinks Search Box no Google)
 *  - LocalBusiness com serviceArea (GEO / Local Pack)
 *  - FAQPage (AEO: respostas diretas no SGE/AI Overview)
 *  - SoftwareApplication (quando aplicável)
 *  - BreadcrumbList (SXO: breadcrumbs ricos)
 */
export function usePageSeo(input: SeoInput): void {
  const config = useRuntimeConfig()
  const siteUrl = (config.public.siteUrl as string) || 'https://chamadudu.web.app'
  const whatsappUrl = computed(() => config.public.whatsappUrl || 'https://wa.me/5581985740561')
  const ogImage = (config.public.ogImageUrl as string) || `${siteUrl}/og.png`
  const canonical = buildCanonical(siteUrl, input.path)

  // ── Meta tags (SEO on-page + OG + Twitter) ──────────────────────────────
  useSeoMeta({
    title:              input.title,
    description:        input.description,
    ogTitle:            input.title,
    ogDescription:      input.description,
    ogType:             'website',
    ogImage,
    ogUrl:              canonical,
    // Twitter / X
    twitterCard:        'summary_large_image',
    twitterTitle:       input.title,
    twitterDescription: input.description,
    twitterImage:       ogImage,
    // Indexação
    robots:             'index,follow',
    // GEO hints (Generative Engine Optimization)
    author:             'Chama Dudu · Kosh Sistemas',
    // CWI: preload hint emitido via link (abaixo em useHead)
  })

  // ── JSON-LD schemas ───────────────────────────────────────────────────────
  const jsonLd: Array<Record<string, unknown>> = []

  // 1. Organization – Brand Search & Knowledge Panel
  jsonLd.push({
    '@context': 'https://schema.org',
    '@type':    'Organization',
    '@id':      `${siteUrl}/#organization`,
    name:       'Chama Dudu',
    alternateName: ['Chama o Dudu', 'ChamaDudu', 'Chama Dudu Paulista', 'Chama Dudu Recife'],
    url:        siteUrl,
    logo: {
      '@type': 'ImageObject',
      url:     `${siteUrl}/images/logo.png`,
      width:   '360',
      height:  '360',
    },
    description: 'O maior delivery de bebidas da Região Metropolitana do Recife e Paulista-PE. Peça cerveja e depósitos pelo WhatsApp sem baixar app.',
    foundingDate: '2024',
    contactPoint: {
      '@type':       'ContactPoint',
      contactType:   'customer support',
      availableLanguage: 'Portuguese',
      url:           'https://wa.me/5581985740561',
    },
    areaServed: [
      {
        '@type': 'City',
        name:    'Paulista',
      },
      {
        '@type': 'City',
        name:    'Recife',
      },
      {
        '@type': 'State',
        name:    'Pernambuco',
      }
    ],
    sameAs: [
      'https://wa.me/5581985740561',
    ],
  })

  // 2. WebSite + SearchAction — Sitelinks Search Box (Brand Search / CWI)
  jsonLd.push({
    '@context': 'https://schema.org',
    '@type':    'WebSite',
    '@id':      `${siteUrl}/#website`,
    name:       'Chama Dudu',
    url:        siteUrl,
    publisher:  { '@id': `${siteUrl}/#organization` },
    potentialAction: {
      '@type':       'SearchAction',
      target:        `${siteUrl}/onde-funciona?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  })

  // 3. LocalBusiness – GEO / Local Pack (só na home e páginas relevantes)
  if (input.localBusiness !== false) {
    jsonLd.push({
      '@context':     'https://schema.org',
      '@type':        ['LocalBusiness', 'FoodEstablishment'],
      '@id':          `${siteUrl}/#localbusiness`,
      name:           'Chama Dudu',
      image:          ogImage,
      url:            siteUrl,
      telephone:      '+5581985740561',
      priceRange:     '$',
      description:    'Delivery de bebidas e depósitos via WhatsApp em Paulista-PE. Sem app, sem cadastro. Atende Janga, Pau Amarelo, Maranguape, Paulista Centro e mais.',
      servesCuisine:  'Bebidas e Depósito',
      address: {
        '@type':           'PostalAddress',
        addressLocality:   'Paulista',
        addressRegion:     'PE',
        postalCode:        '53400-000',
        addressCountry:    'BR',
      },
      geo: {
        '@type':    'GeoCoordinates',
        latitude:   '-7.9403',
        longitude:  '-34.8814',
      },
      hasMap: 'https://chamadudu.web.app/onde-funciona',
      openingHoursSpecification: [
        {
          '@type':     'OpeningHoursSpecification',
          dayOfWeek:   ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
          opens:       '00:00',
          closes:      '23:59',
        }
      ],
      areaServed: [
        {
          '@type': 'GeoCircle',
          geoMidpoint: {
            '@type':     'GeoCoordinates',
            latitude:    '-7.9403',
            longitude:   '-34.8814',
          },
          geoRadius: '20000',
        },
        ...[
          'Paulista Centro', 'Janga', 'Pau Amarelo', 'Maranguape I e II',
          'Paratibe', 'Arthur Lundgren I e II', 'Fragoso', 'Jaguarana',
          'Mirueira', 'Conceição', 'Maria Farinha', 'Vila Torres Galvão',
          'Nobre', 'Jardim Paulista', 'Jaguaribe', 'Jardim Maranguape',
        ].map(b => ({
          '@type': 'AdministrativeArea',
          name: `${b}, Paulista, PE`,
        })),
        {
          '@type': 'AdministrativeArea',
          name: 'Região Metropolitana do Recife',
        }
      ],
      keywords: 'deposito aberto agora, delivery bebidas paulista pe, grande recife delivery, regiao metropolitana recife, ze delivery alternativo, cerveja gelada janga, pau amarelo delivery, maranguape entrega, entrega bebidas 24h paulista',
    })
  }

  // 4. SoftwareApplication – AEO: "o que é o Chama Dudu?"
  jsonLd.push({
    '@context':       'https://schema.org',
    '@type':          'SoftwareApplication',
    name:             'Chama Dudu',
    operatingSystem:  'WhatsApp',
    applicationCategory: 'BusinessApplication',
    offers: {
      '@type':    'Offer',
      price:      '0',
      priceCurrency: 'BRL',
    },
    description: 'Bot no WhatsApp que conecta clientes a depósitos de bebidas abertos em Paulista-PE. Sem app, sem cadastro.',
    url:          siteUrl,
  })

  // 5. FAQPage – AEO: aparece como featured snippet / AI Overview no Google SGE
  if (input.faq?.length) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type':    'FAQPage',
      mainEntity: input.faq.map((item) => ({
        '@type': 'Question',
        name:    item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text:    item.answer,
        },
      })),
    })
  }

  // 6. BreadcrumbList – SXO: breadcrumbs ricos no resultado de busca
  const breadcrumbs: Array<{ name: string; url: string }> = [
    { name: 'Início', url: siteUrl },
  ]
  if (input.path !== '/') {
    const label = {
      '/app':            'Como Funciona',
      '/onde-funciona':  'Onde Funciona',
      '/termos':         'Termos de Uso',
      '/privacidade':    'Privacidade',
    }[input.path] || input.title
    breadcrumbs.push({ name: label, url: canonical })
  }
  jsonLd.push({
    '@context':  'https://schema.org',
    '@type':     'BreadcrumbList',
    itemListElement: breadcrumbs.map((b, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      name:      b.name,
      item:      b.url,
    })),
  })

  // ── useHead ───────────────────────────────────────────────────────────────
  useHead({
    htmlAttrs: { lang: 'pt-BR' },
    link: [
      { rel: 'canonical', href: canonical },
      { rel: 'alternate', hreflang: 'pt-BR', href: canonical },
      // CWI: preconnect hints para recursos críticos
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
      // GEO: hint para crawlers de IA (ex: Perplexity, ChatGPT)
      { rel: 'me', href: 'https://wa.me/5581985740561' },
    ],
    meta: [
      { name: 'robots', content: 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1' },
      // GEO / AEO: hints para motores de IA e LLMs
      { name: 'geo.region',   content: 'BR-PE' },
      { name: 'geo.placename', content: 'Paulista, Pernambuco, Brasil' },
      { name: 'geo.position', content: '-7.9403;-34.8814' },
      { name: 'ICBM',        content: '-7.9403, -34.8814' },
      // Brand Search: explicitamente define o nome da marca
      { name: 'application-name', content: 'Chama Dudu' },
    ],
    script: jsonLd.map((item) => ({
      type:     'application/ld+json',
      children: JSON.stringify(item),
    })),
  })
}
