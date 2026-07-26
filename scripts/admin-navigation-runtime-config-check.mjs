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

function tokenizeJavaScript(source) {
  const tokens = []
  for (let index = 0; index < source.length;) {
    const char = source[index]
    const next = source[index + 1]
    if (/\s/.test(char)) { index += 1; continue }
    if (char === '/' && next === '/') {
      index += 2
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      let value = ''
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue }
        if (source[index] === quote) { index += 1; break }
        value += source[index]
        index += 1
      }
      tokens.push({ type: 'string', value })
      continue
    }
    if (/[a-zA-Z_$]/.test(char)) {
      const start = index
      while (index < source.length && /[\w$]/.test(source[index])) index += 1
      tokens.push({ type: 'identifier', value: source.slice(start, index) })
      continue
    }
    if (char === '?' && next === '.') { tokens.push({ type: 'punctuation', value: '.' }); index += 2; continue }
    if (char === '=' && next === '>') { tokens.push({ type: 'punctuation', value: '=>' }); index += 2; continue }
    if (char === '=') {
      let value = '='
      while (source[index + value.length] === '=' && value.length < 3) value += '='
      tokens.push({ type: 'punctuation', value })
      index += value.length
      continue
    }
    tokens.push({ type: 'punctuation', value: char })
    index += 1
  }
  return tokens
}

function readPropertyChain(tokens, start) {
  const names = [tokens[start].value]
  let index = start + 1
  while (index < tokens.length) {
    if (tokens[index].value === '.') {
      if (tokens[index + 1]?.type === 'identifier') {
        names.push(tokens[index + 1].value)
        index += 2
        continue
      }
      if (tokens[index + 1]?.value === '[') { index += 1; continue }
      index += 1
      break
    }
    if (tokens[index].value === '[' && tokens[index + 1]?.type === 'string' && tokens[index + 2]?.value === ']') {
      names.push(tokens[index + 1].value)
      index += 3
      continue
    }
    break
  }
  return { names, next: tokens[index]?.value }
}

function containsForbiddenNavigation(source) {
  const tokens = tokenizeJavaScript(source)
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'identifier') continue
    const { names, next } = readPropertyChain(tokens, index)
    if (names[0] === 'router' && ['push', 'replace'].includes(names[1]) && next === '(') return true
    const locationIndex = names[0] === 'location'
      ? 0
      : ['window', 'document', 'globalThis'].includes(names[0]) && names[1] === 'location' ? 1 : -1
    if (locationIndex < 0) continue
    const member = names[locationIndex + 1]
    if (!member && next === '=') return true
    if (member === 'href' && next === '=') return true
    if (['reload', 'assign', 'replace'].includes(member) && next === '(') return true
  }
  return false
}

for (const variant of [
  'location.reload()', "window['location']['assign']('/login')", 'document.location.replace("/")',
  "document['location']['href'] = '/'", 'document.location = nextUrl', "window['location'] = '/login'",
  'location?.reload?.()', "router['push']('/403')", 'router?.replace?.("/")'
]) assert.equal(containsForbiddenNavigation(variant), true, `runtime navigation ban must catch ${variant}`)
for (const harmlessVariant of [
  '// router.push("/login")\nconsole.error(error)',
  '/* location.reload() */ console.error(error)',
  "console.error('router.push() failed')"
]) assert.equal(containsForbiddenNavigation(harmlessVariant), false, `runtime navigation ban must ignore ${harmlessVariant}`)
const nestedVariant = "router.onError(() => { Promise.resolve().then(() => { console.log('nested')\n})\ndocument.location.reload()\n})"
assert.equal(containsForbiddenNavigation(extractCall(nestedVariant, 'router.onError')), true, 'the full route error handler must be inspected after nested callbacks')

const onErrorSource = extractCall(routerSource, 'router.onError')
assert.match(onErrorSource, /ElMessage\.error\(['"]页面暂时未能打开，请稍后重试['"]\)/, 'route errors must show the agreed retry message')
assert.equal(containsForbiddenNavigation(onErrorSource), false, 'route errors must not reload, redirect, assign a URL, or navigate away')
assert.match(mainSource, /import\s+['"]element-plus\/dist\/index\.css['"]/, 'the global Element Plus stylesheet must remain loaded')
assert.match(mainSource, /import\s+['"]\.\/styles\/global\.css['"]/, 'the admin global stylesheet must remain loaded')
assert.match(mainSource, /app\.use\(ElementPlus(?:,\s*\{[\s\S]*?\})?\)/, 'Element Plus must remain globally installed')

console.log('admin-navigation-runtime-config-check passed')
