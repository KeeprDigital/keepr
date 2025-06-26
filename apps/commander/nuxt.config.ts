export default defineNuxtConfig({
  ssr: false,
  modules: [
    '@nuxthub/core',
    '@nuxt/eslint',
    '@nuxt/ui-pro',
    '@vueuse/nuxt',
  ],

  hub: {
    workers: true,
    database: true,
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2025-03-01',
})
