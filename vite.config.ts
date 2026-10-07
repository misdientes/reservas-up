/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Pruebas de lógica pura (fechas y calendario): sin navegador.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
