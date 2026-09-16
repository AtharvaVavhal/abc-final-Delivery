import path from 'node:path'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import { DEFAULT_SITE_URL } from './src/seo/siteConfig.constants.ts'
import { buildRobotsTxt, buildSitemapXml } from './src/seo/seoFiles.ts'

/**
 * Emits robots.txt and a static sitemap.xml into the build output. The
 * site origin comes from VITE_SITE_URL (see .env.example) and otherwise
 * falls back to DEFAULT_SITE_URL (local Vite origin). Build-time only
 * — the dev server doesn't need either file.
 */
function seoFiles(siteUrl: string): Plugin {
  return {
    name: 'printforge-seo-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: buildRobotsTxt(siteUrl),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(siteUrl),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const siteUrl = (env.VITE_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, '')

  return {
    plugins: [react(), seoFiles(siteUrl)],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
    },
  }
})
