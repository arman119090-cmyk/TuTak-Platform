// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';

// Публичный адрес сайта. До подключения домена — адрес Render/Railway,
// после — https://elgo.am. Используется для canonical, hreflang, sitemap, OG.
const SITE_URL = process.env.SITE_URL || 'https://elgo.am';

export default defineConfig({
  site: SITE_URL,
  // Страницы собираются статически, серверным остаётся только POST /api/lead.
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'ignore',
  i18n: {
    locales: ['hy', 'ru', 'en'],
    defaultLocale: 'hy',
    routing: {
      prefixDefaultLocale: true,
      // `/` → `/hy/` делает src/pages/index.astro настоящим 301 (встроенный даёт 302).
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      // `/` — только редирект на /hy/, в карту сайта не попадает.
      filter: (page) => !page.includes('/api/') && new URL(page).pathname !== '/',
      i18n: {
        defaultLocale: 'hy',
        // Те же значения, что в <link rel="alternate" hreflang> на страницах.
        locales: { hy: 'hy', ru: 'ru', en: 'en' },
      },
    }),
  ],
  image: {
    responsiveStyles: false,
  },
});
