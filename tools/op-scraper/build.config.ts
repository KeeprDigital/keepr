import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    // Main library entry
    'src/index',
    // CLI binary
    {
      input: 'src/bin/cli.ts',
      outDir: 'dist/bin',
      format: 'esm',
    },
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: false,
  },
})
