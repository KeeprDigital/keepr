export default defineNuxtConfig({
  ssr: false,
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/test-utils/module',
    '@nuxt/ui-pro',
    '@nuxthub/core',
    '@pinia/nuxt',
    '@pinia/nuxt',
    '@vueuse/nuxt',
  ],
  hub: {
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
    storage: {
      local: {
        driver: 'fs',
        base: './.data/db',
      },
    },
  },
  css: ['~/assets/css/main.css'],
  devtools: {
    enabled: true,
  },
  compatibilityDate: '2024-11-01',
  future: {
    compatibilityVersion: 4,
  },
})
