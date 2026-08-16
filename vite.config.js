import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Multi-página (2026-08-16) -- Reportes se mudó adentro de este mismo
// proyecto (antes era reportes-web, un deploy de Vercel aparte) para
// compartir sesión de verdad con Conteo/Vencimientos, sin ningún token ni
// dominio propio. Es JS plano, no React -- por eso vive como una segunda
// página HTML con su propio bundle, no como una ruta de react-router.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        reportes: resolve(__dirname, 'reportes/index.html'),
      },
    },
  },
})
