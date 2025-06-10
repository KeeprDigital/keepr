import { createBaseConfig } from './index.mjs'

export function createNuxtConfig(options = {}) {
  const {
    nuxtRules = {},
    rules = {},
    ...baseOptions
  } = options

  const baseConfig = createBaseConfig({
    ...baseOptions,
    vue: true,
    rules: {
      'vue/block-order': ['error', {
        order: ['script', 'template', 'style'],
      }],
      'vue/no-multiple-template-root': 'off',
      'vue/max-attributes-per-line': ['error', {
        singleline: { max: 3 },
        multiline: { max: 1 },
      }],
      ...rules,
      ...nuxtRules,
    },
  })

  return baseConfig
}

export default createNuxtConfig()
