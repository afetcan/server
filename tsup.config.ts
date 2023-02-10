import type { Options } from 'tsup'

const isProduction = process.env.NODE_ENV === 'production'

export default <Options>{
  entryPoints: ['src/index.ts'],
  outDir: 'dist',
  target: 'node18', // needed for working ESM
  format: ['esm'],
  splitting: false,
  sourcemap: true,
  clean: true,
  // noExternal,
  skipNodeModulesBundle: true,
  banner: ({ format }) => {
    if (format === 'esm') {
      return {
        // eslint-disable-next-line @typescript-eslint/quotes
        js: `import {createRequire as __createRequire} from 'module';var require=__createRequire(import\.meta.url);`,
      }
    }
  },
  footer: ({ format }) => {
    if (format === 'cjs') {
      return {
        // eslint-disable-next-line @typescript-eslint/quotes
        js: `if (module.exports.default) module.exports = module.exports.default;`,
      }
    }
  },
}
