import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{vue,js,ts}', './nuxt.config.ts'],
  theme: {
    extend: {
      colors: {
        dudu: {
          green: '#248A3D',
          dark: '#0E0F0F',
          glow: '#50C878'
        }
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0, 0, 0, 0.15)'
      },
      borderRadius: {
        xl: '18px'
      }
    }
  },
  plugins: []
} satisfies Config
