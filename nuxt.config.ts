// https://nuxt.com/docs/api/configuration/nuxt-config
const appBaseURL = process.env.NUXT_APP_BASE_URL || process.env.GATEWAY_PREFIX || '/'
const normalizedBase = appBaseURL.endsWith('/') ? appBaseURL : `${appBaseURL}/`

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  future: { compatibilityVersion: 4 },
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    // 飞牛统一网关下为 /app/miyin/；本地默认 /
    baseURL: normalizedBase,
    head: {
      htmlAttrs: {
        lang: 'zh-CN',
      },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${normalizedBase}favicon.svg` },
        { rel: 'apple-touch-icon', href: `${normalizedBase}logo-192.png` },
      ],
      meta: [{ name: 'theme-color', content: '#0f766e' }],
    },
  },
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
