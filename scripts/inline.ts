/**
 * Turns the Vite build into one HTML file that runs offline from disk: the main script and the
 * stylesheet are inlined, and the workers are already inlined as blob workers by the build.
 * Output: dist-offline/airfield-tycoon.html
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const out = new URL('../dist-offline/', import.meta.url).pathname;
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const assets = join(dist, 'assets');
const files = existsSync(assets) ? readdirSync(assets) : [];

const inlineScripts: string[] = [];
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src: string) => {
  const name = src.split('/').pop() ?? '';
  const code = readFileSync(join(assets, name), 'utf8').replace(/<\/script/gi, '<\\/script');
  // Module scripts run deferred, so the inline script goes at the end of the body.
  inlineScripts.push(code);
  return '';
});
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href: string) => {
  const name = href.split('/').pop() ?? '';
  return `<style>${readFileSync(join(assets, name), 'utf8')}</style>`;
});
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
html = html.replace('</body>', () => `${inlineScripts.map((c) => `<script type="module">${c}</script>`).join('\n')}\n</body>`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'airfield-tycoon.html'), html);
console.log(`Wrote ${join(out, 'airfield-tycoon.html')} (${(html.length / 1024).toFixed(0)} KB) from ${files.length} asset files`);
