import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
  resolve: {
    alias: {
      '#server': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },
})
