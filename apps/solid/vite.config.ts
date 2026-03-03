import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  server: {
    allowedHosts: ['chicks-arch'],
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
