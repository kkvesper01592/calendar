import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 本番ビルドだけに CSP を入れる(開発サーバーはインラインスクリプトを使うため)
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  'frame-src https://accounts.google.com/gsi/',
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  base: '/calendar/',
  plugins: [react(), cspPlugin()],
  server: { port: 5173, strictPort: true },
})
