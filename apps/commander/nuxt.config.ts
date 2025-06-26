export default defineNuxtConfig({
  ssr: false,
  modules: [
    '@nuxthub/core',
    '@nuxt/eslint',
    '@nuxt/ui-pro',
    '@vueuse/nuxt',
  ],

  hub: {},

  eslint: {
    config: {
      standalone: false,
    },
  },

  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2025-03-01',
})
