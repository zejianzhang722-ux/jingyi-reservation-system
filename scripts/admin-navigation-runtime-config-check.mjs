import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const viteConfig = await readFile(new URL('../admin/vite.config.js', import.meta.url), 'utf8')
const routerSource = await readFile(new URL('../admin/src/router/index.js', import.meta.url), 'utf8')

assert.doesNotMatch(
  viteConfig,
  /unplugin-vue-components\/vite/,
  'Vite must not scan page components for Element Plus style imports'
)
assert.match(
  viteConfig,
  /ElementPlusResolver\(\{\s*importStyle:\s*false\s*\}\)/,
  'Element Plus auto imports must reuse the globally loaded stylesheet'
)
assert.match(routerSource, /router\.onError\s*\(/, 'route loading failures must be handled without leaving the current page')
assert.doesNotMatch(routerSource, /location\.(?:reload|assign)/, 'route loading failures must not reload or redirect the browser')

console.log('admin-navigation-runtime-config-check passed')
