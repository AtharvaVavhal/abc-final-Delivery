import path from 'node:path'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import { DEFAULT_SITE_URL } from './src/seo/siteConfig.constants.ts'
import { buildRobotsTxt, buildSitemapXml, catalogPublicPaths } from './src/seo/seoFiles.ts'
import { storefrontShellHtmlPlugin } from './vite.storefront-shell-plugin.ts'
import catalogSitemap from './src/generated/sitemap-paths.json' with { type: 'json' }

/**
 * Emits robots.txt and sitemap.xml (static pages + catalog snapshot) into
 * the build. Origin comes from VITE_SITE_URL, else DEFAULT_SITE_URL.
 */
function seoFiles(siteUrl: string): Plugin {
  const origin = siteUrl.replace(/\/+$/, '')
  const sitemapPaths = catalogPublicPaths(catalogSitemap)
  const shareImage =
    typeof catalogSitemap.shareImage === 'string' && catalogSitemap.shareImage.startsWith('http')
      ? catalogSitemap.shareImage
      : `${origin}/catalog/logo.png`

  return {
    name: 'printforge-seo-files',
    apply: 'build',
    transformIndexHtml(html) {
      const extras = [
        `<link rel="canonical" href="${origin}/" />`,
        `<meta property="og:url" content="${origin}/" />`,
        `<meta property="og:image" content="${shareImage}" />`,
        `<meta property="og:locale" content="en_IN" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="AB Creations — Custom prints, made to order" />`,
        `<meta name="twitter:image" content="${shareImage}" />`,
      ].join('\n    ')
      return html.replace('</title>', `</title>\n    ${extras}`)
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: buildRobotsTxt(siteUrl),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(siteUrl, sitemapPaths),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const siteUrl = (env.VITE_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, '')

  return {
    plugins: [react(), seoFiles(siteUrl), storefrontShellHtmlPlugin(process.cwd())],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    },
  }
})
