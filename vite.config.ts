import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { readSupabaseConfig } from './src/lib/supabase/config.ts'

export default defineConfig(({ mode }) => {
  // Refuse unexpected VITE_* names before Vite can expose them in the bundle.
  readSupabaseConfig(loadEnv(mode, process.cwd(), 'VITE_'))

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: { sourcemap: false },
  }
})
