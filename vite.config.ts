import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// The Worker has no client app: the report stylesheet and browser bundle are prebuilt into
// worker/public, and Vite copies that directory into the client build output that becomes
// the Worker's static assets.
export default defineConfig({
  publicDir: 'worker/public',
  plugins: [cloudflare()],
})
