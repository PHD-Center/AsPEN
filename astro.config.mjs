// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Deployment target: https://phd-center.github.io/AsPEN/
// (GitHub Pages lowercases the organization name but preserves the repo name's case.)
// If you later switch to a custom apex domain (e.g. aspensig.asia),
// change `site` and set `base: '/'`.
export default defineConfig({
  site: 'https://phd-center.github.io',
  base: '/AsPEN',
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
