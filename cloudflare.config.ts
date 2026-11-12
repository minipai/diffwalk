import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'diffwalk-reports',
    compatibilityDate: '2026-08-28',
    compatibilityFlags: ['nodejs_compat'],
    entrypoint: 'worker/index.ts',
    observability: { enabled: true },
    domains: ['review.diffwalk.dev'],
    env: {
      REPORTS: bindings.r2({ name: 'diffwalk-reports' }),
      ASSETS: bindings.assets(),
    },
  },
})
