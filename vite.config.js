import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production Content-Security-Policy (injected as a meta tag at build time).
// GitHub Pages cannot set HTTP headers, so meta CSP is used instead.
// Skipped during `npm run dev` so Vite HMR is not blocked.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function productionCspPlugin() {
  return {
    name: 'production-csp',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html
      const tag = `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}">`
      return html.replace('<head>', `<head>\n    ${tag}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), productionCspPlugin()],
  base: '/abtest-calculator-YI5TG7VABC/',
})
