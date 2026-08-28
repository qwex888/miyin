// https://nuxt.com/docs/api/configuration/nuxt-config
import pkg from './package.json' with { type: 'json' }

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
    // 默认仅占位；运行时优先读 AUTH_TOKEN / SESSION_SECRET 等（见 server/utils/runtimeEnv.ts）
    // Nuxt 亦可被 NUXT_AUTH_TOKEN、NUXT_SESSION_SECRET、NUXT_DATA_DIR、NUXT_DOWNLOAD_DIR 覆盖
    authToken: '',
    dataDir: './data',
    downloadDir: './downloads',
    sessionSecret: '',
    public: {
      appName: '觅音',
      appVersion: pkg.version,
      repoUrl: 'https://github.com/qwex888/miyin',
      feedbackUrl: 'https://github.com/qwex888/miyin/issues/new',
    },
  },
})
