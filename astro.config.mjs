// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Deployment target: https://phd-center.github.io/aspensig/
// (GitHub Pages lowercases the organization name in URLs.)
// If you later switch to a custom apex domain (e.g. aspensig.asia),
// change `site` and set `base: '/'`.
export default defineConfig({
  site: 'https://phd-center.github.io',
  base: '/aspensig',
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
