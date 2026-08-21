import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Served at https://krabbefar.org/volleyball/ (a subpath of the existing
  // single-domain nginx site, not its own subdomain) — asset URLs need this
  // prefix or they'll resolve to the domain root and 404.
  base: '/volleyball/',
  plugins: [react(), tailwindcss()],
})
