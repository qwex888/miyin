import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    env: {
      MIYIN_SOURCE_CALL_TIMEOUT_MS: '800',
      MIYIN_SOURCE_LOAD_TIMEOUT_MS: '500',
    },
  },
  resolve: {
    alias: {
      '#server': fileURLToPath(new URL('./server', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
})
