import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const viteConfig = await readFile(new URL('../admin/vite.config.js', import.meta.url), 'utf8')
const routerSource = await readFile(new URL('../admin/src/router/index.js', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../admin/src/main.js', import.meta.url), 'utf8')

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
const onErrorStart = routerSource.indexOf('router.onError')
const onErrorEnd = routerSource.indexOf('\n})', onErrorStart)
assert.ok(onErrorStart >= 0 && onErrorEnd > onErrorStart, 'route error handler must remain directly inspectable')
const onErrorSource = routerSource.slice(onErrorStart, onErrorEnd + 3)
assert.match(onErrorSource, /ElMessage\.error\(['"]页面暂时未能打开，请稍后重试['"]\)/, 'route errors must show the agreed retry message')
assert.doesNotMatch(onErrorSource, /location\.(?:reload|assign|replace)\s*\(/, 'route errors must not reload or redirect the browser')
assert.doesNotMatch(onErrorSource, /location\.href\s*=/, 'route errors must not assign a replacement URL')
assert.doesNotMatch(onErrorSource, /router\.(?:push|replace)\s*\(/, 'route errors must not navigate away from the current page')
assert.match(mainSource, /import\s+['"]element-plus\/dist\/index\.css['"]/, 'the global Element Plus stylesheet must remain loaded')
assert.match(mainSource, /import\s+['"]\.\/styles\/global\.css['"]/, 'the admin global stylesheet must remain loaded')
assert.match(mainSource, /app\.use\(ElementPlus(?:,\s*\{[\s\S]*?\})?\)/, 'Element Plus must remain globally installed')

console.log('admin-navigation-runtime-config-check passed')
