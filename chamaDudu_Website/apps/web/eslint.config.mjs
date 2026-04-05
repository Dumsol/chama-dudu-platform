import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    stylistic: false
  }
}).append({
  ignores: [
    'app/**',
    '.nuxt/**',
    '.output/**',
    'tests/screenshots/**',
    'dev.out.log',
    'dev.err.log'
  ],
  rules: {
    'vue/multi-word-component-names': 'off',
    'vue/singleline-html-element-content-newline': 'off',
    'vue/max-attributes-per-line': 'off',
    '@stylistic/comma-dangle': 'off',
    '@stylistic/brace-style': 'off',
    '@stylistic/member-delimiter-style': 'off'
  }
})
