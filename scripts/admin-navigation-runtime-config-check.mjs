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
function extractCall(source, marker) {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `${marker} must remain directly inspectable`)
  const open = source.indexOf('(', start + marker.length)
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) { if (char === '\n') lineComment = false; continue }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1 }; continue }
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === '(') depth += 1
    if (char === ')' && --depth === 0) return source.slice(start, index + 1)
  }
  assert.fail(`${marker} call could not be fully read`)
}

function normalizedRuntimeAccess(source) {
  return source
    .replace(/\?\.\s*(?=\()/g, '')
    .replace(/\?\.\s*/g, '.')
    .replace(/\?\s*(?=\[)/g, '')
    .replace(/\[\s*['"]([a-zA-Z_$][\w$]*)['"]\s*\]/g, '.$1')
    .replace(/\s+/g, '')
}

function containsForbiddenNavigation(source) {
  const normalized = normalizedRuntimeAccess(source)
  return /(?:(?:window|document|globalThis)\.)?location\.(?:reload|assign|replace)\(/.test(normalized) ||
    /(?:(?:window|document|globalThis)\.)?location\.href=/.test(normalized) ||
    /router\.(?:push|replace)\(/.test(normalized)
}

for (const variant of [
  'location.reload()', "window['location']['assign']('/login')", 'document.location.replace("/")',
  "document['location']['href'] = '/'", 'location?.reload?.()', "router['push']('/403')", 'router?.replace?.("/")'
]) assert.equal(containsForbiddenNavigation(variant), true, `runtime navigation ban must catch ${variant}`)
const nestedVariant = "router.onError(() => { Promise.resolve().then(() => { console.log('nested')\n})\ndocument.location.reload()\n})"
assert.equal(containsForbiddenNavigation(extractCall(nestedVariant, 'router.onError')), true, 'the full route error handler must be inspected after nested callbacks')

const onErrorSource = extractCall(routerSource, 'router.onError')
assert.match(onErrorSource, /ElMessage\.error\(['"]页面暂时未能打开，请稍后重试['"]\)/, 'route errors must show the agreed retry message')
assert.equal(containsForbiddenNavigation(onErrorSource), false, 'route errors must not reload, redirect, assign a URL, or navigate away')
assert.match(mainSource, /import\s+['"]element-plus\/dist\/index\.css['"]/, 'the global Element Plus stylesheet must remain loaded')
assert.match(mainSource, /import\s+['"]\.\/styles\/global\.css['"]/, 'the admin global stylesheet must remain loaded')
assert.match(mainSource, /app\.use\(ElementPlus(?:,\s*\{[\s\S]*?\})?\)/, 'Element Plus must remain globally installed')

console.log('admin-navigation-runtime-config-check passed')
