import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/tests/**/*.test.{js,jsx}'],
    server: {
      deps: {
        inline: ['@asamuzakjp/css-color', '@csstools/css-calc', '@csstools/css-color-4', '@csstools/css-parser-algorithms', '@csstools/css-tokenizer', '@csstools/color-helpers'],
      },
    },
  },
})
