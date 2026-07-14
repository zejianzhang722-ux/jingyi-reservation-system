// @vitest-environment happy-dom
import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Layout from '../Layout.vue'
import { useUserStore } from '@/store/user'
import { saveOpenGroups } from '@/utils/navigationState'

vi.mock('@/api/reservation', () => ({
  getPendingCount: vi.fn().mockResolvedValue(0)
}))

const menuCalls = []

const MenuStub = defineComponent({
  name: 'ElMenu',
  inheritAttrs: false,
  emits: ['open', 'close'],
  setup(_, { attrs, emit, expose, slots }) {
    const open = key => {
      menuCalls.push(['open', key])
      emit('open', key)
    }
    const close = key => {
      menuCalls.push(['close', key])
      emit('close', key)
    }
    expose({ open, close })
    return () => h('nav', attrs, slots.default?.())
  }
})

const ButtonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.())
  }
})

const SlotStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, [slots.title?.(), slots.default?.()])
  }
})

async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}

async function mountLayout() {
  localStorage.clear()
  localStorage.setItem('token', 'test-token')
  localStorage.setItem('userInfo', JSON.stringify({ id: 11, username: 'guide-a', role: 'admin' }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/dashboard', name: 'Dashboard', component: SlotStub, meta: { title: '工作台' } },
      { path: '/room/monitor', name: 'RoomMonitor', component: SlotStub, meta: { title: '空间监控' } },
      { path: '/poster/pending', name: 'PosterPending', component: SlotStub, meta: { title: '海报审核' } }
    ]
  })
  await router.push('/dashboard')
  await router.isReady()
  const wrapper = mount(Layout, {
    global: {
      plugins: [pinia, router],
      stubs: {
        ElMenu: MenuStub,
        ElButton: ButtonStub,
        ElSubMenu: SlotStub,
        ElMenuItem: SlotStub,
        ElContainer: SlotStub,
        ElAside: SlotStub,
        ElHeader: SlotStub,
        ElMain: SlotStub,
        ElIcon: SlotStub,
        ElBreadcrumb: SlotStub,
        ElBreadcrumbItem: SlotStub,
        ElTag: SlotStub,
        ElDropdown: SlotStub,
        ElDropdownMenu: SlotStub,
        ElDropdownItem: SlotStub,
        ElDialog: SlotStub,
        ElInput: SlotStub,
        ElEmpty: SlotStub,
        ElAvatar: SlotStub,
        Fold: SlotStub,
        Expand: SlotStub,
        DataBoard: SlotStub,
        SwitchButton: SlotStub,
        ArrowRight: SlotStub,
        Transition: false
      }
    }
  })
  await settle()
  return { wrapper, router, store: useUserStore() }
}

describe('Layout navigation wiring', () => {
  beforeEach(() => {
    menuCalls.length = 0
  })

  it('opens the active group across routes, restores after collapse, and isolates account state', async () => {
    const { wrapper, router, store } = await mountLayout()
    expect(menuCalls).toContainEqual(['open', 'today'])
    expect(menuCalls).toContainEqual(['open', 'reservation'])

    menuCalls.length = 0
    await router.push('/room/monitor')
    await settle()
    expect(menuCalls).toContainEqual(['open', 'space'])
    expect(wrapper.text()).toContain('空间运行')
    expect(wrapper.get('.breadcrumb').text()).toContain('空间运行')

    const collapseButton = wrapper.get('button.collapse-btn')
    expect(collapseButton.attributes('aria-label')).toBe('收起侧栏')
    await collapseButton.trigger('click')
    await settle()
    expect(collapseButton.attributes('aria-label')).toBe('展开侧栏')
    menuCalls.length = 0
    await collapseButton.trigger('click')
    await settle()
    expect(menuCalls).toContainEqual(['open', 'space'])

    const counselor = { id: 22, username: 'counselor-a', role: 'counselor' }
    saveOpenGroups(localStorage, counselor, ['content'])
    menuCalls.length = 0
    store.setUserInfo(counselor)
    await settle()
    expect(menuCalls).toContainEqual(['close', 'today'])
    expect(menuCalls).toContainEqual(['close', 'reservation'])
    expect(menuCalls).toContainEqual(['open', 'content'])
    expect(wrapper.text()).toContain('辅导员工作区')
  })
})
