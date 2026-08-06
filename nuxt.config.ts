// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'node-server',
    esbuild: {
      options: {
        target: 'node20',
      },
    },
    externals: {
      external: ['better-sqlite3'],
    },
  },
  runtimeConfig: {
    authToken: process.env.AUTH_TOKEN || 'changeme',
    dataDir: process.env.DATA_DIR || './data',
    downloadDir: process.env.DOWNLOAD_DIR || './downloads',
    sessionSecret: process.env.SESSION_SECRET || 'dev-change-me',
    public: {
      appName: '觅音',
    },
  },
})
