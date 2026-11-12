import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'diffwalk-site',
    compatibilityDate: '2026-08-31',
    workersDev: false,
    domains: ['diffwalk.dev'],
    env: {
      ASSETS: bindings.assets(),
    },
  },
})
