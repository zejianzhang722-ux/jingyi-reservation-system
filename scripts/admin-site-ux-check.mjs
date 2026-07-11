import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  beginLoad,
  createAsyncState,
  failLoad,
  finishLoad
} from '../admin/src/utils/asyncState.js'

const state = createAsyncState([])
assert.equal(state.status, 'idle')
assert.deepEqual(state.value, [])

beginLoad(state)
assert.equal(state.status, 'loading')

finishLoad(state, [{ id: 1 }], false)
assert.equal(state.status, 'success')
assert.deepEqual(state.value, [{ id: 1 }])

beginLoad(state)
finishLoad(state, [], true)
assert.equal(state.status, 'empty')
assert.deepEqual(state.value, [])

finishLoad(state, [{ id: 2 }], false)
failLoad(state, new Error('网络连接失败'))
assert.equal(state.status, 'error')
assert.deepEqual(state.value, [{ id: 2 }])
assert.match(state.errorMessage, /网络连接失败/)

failLoad(state, {})
assert.match(state.errorMessage, /加载失败|稍后重试/)

const component = await readFile(new URL('../admin/src/components/admin/AsyncState.vue', import.meta.url), 'utf8')
assert.match(component, /loading/)
assert.match(component, /error/)
assert.match(component, /empty/)
assert.match(component, /errorMessage/)
assert.match(component, /defineEmits\(\['retry'\]\)/)

const pageShell = await readFile(new URL('../admin/src/components/admin/PageShell.vue', import.meta.url), 'utf8')
assert.doesNotMatch(pageShell, /page-shell-header:hover[\s\S]*?translateY/)
assert.doesNotMatch(pageShell, /animation:\s*jy-soft-float/)

const globalCss = await readFile(new URL('../admin/src/styles/global.css', import.meta.url), 'utf8')
assert.match(globalCss, /:focus-visible/)
assert.match(globalCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)

console.log('admin-site-ux-check passed')
