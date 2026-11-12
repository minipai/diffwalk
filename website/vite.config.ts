import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// The site is static only: Vite's client build copies public/ into the assets the Worker
// serves, so the project has no entrypoint.
export default defineConfig({
  publicDir: 'public',
  plugins: [cloudflare()],
})
