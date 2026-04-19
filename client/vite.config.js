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
        // New-session startup can legitimately take longer than default proxy limits.
        // Keep the dev proxy alive long enough for the backend's 300s session creation window.
        timeout: 330000,
        proxyTimeout: 330000,
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
        inline: [
          '@asamuzakjp/css-color',
          '@csstools/css-calc',
          '@csstools/css-color-4',
          '@csstools/css-parser-algorithms',
          '@csstools/css-tokenizer',
          '@csstools/color-helpers',
        ],
      },
    },
  },
})
