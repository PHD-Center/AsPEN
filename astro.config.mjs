// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// When deploying to https://<owner>.github.io/aspensig-site/ keep `base: '/aspensig-site'`.
// When deploying to a custom apex domain (aspensig.asia) or to `<owner>.github.io` root,
// set base to '/' (or remove it).
export default defineConfig({
  site: 'https://example.github.io',
  base: '/aspensig-site',
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
