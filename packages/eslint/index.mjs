import antfu from '@antfu/eslint-config'
import turboConfig from 'eslint-config-turbo/flat'

export function createBaseConfig(options = {}) {
  const {
    formatters = {
      markdown: 'prettier',
      svg: 'prettier',
      css: 'prettier',
    },
    rules = {},
    typescript = true,
    vue = false,
  } = options

  return antfu({
    ...turboConfig,
    pnpm: true,
    typescript,
    vue,
    formatters,
    rules: {
      'ts/consistent-type-definitions': ['error', 'type'],
      ...rules,
    },
  })
}

export default createBaseConfig()
