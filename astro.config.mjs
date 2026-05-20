// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Deployment target: https://aspensig.github.io/aspensig/
// If you later switch to a custom apex domain (e.g. aspensig.asia),
// change `site` and set `base: '/'`.
export default defineConfig({
  site: 'https://aspensig.github.io',
  base: '/aspensig',
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
