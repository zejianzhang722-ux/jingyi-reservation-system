<template>
  <div ref="host" class="space-scene" :class="`space-scene--${variant}`" role="img" aria-label="书院功能房立体场景：阅览室、研讨室和活动室由预约路线相连">
    <div class="space-scene__grid" aria-hidden="true"></div>
    <div class="space-scene__topline" aria-hidden="true"><span class="space-scene__live-dot"></span>JINGYI / SPACE NETWORK <span>LIVE SYSTEM</span></div>
    <div v-if="failed" class="space-scene__fallback" aria-hidden="true">
      <span>阅览室</span><span>研讨室</span><span>活动室</span>
    </div>
    <div class="space-scene__room-labels" aria-hidden="true"><span>01 / 阅览</span><span>02 / 研讨</span><span>03 / 活动</span></div>
    <div class="space-scene__caption" aria-hidden="true">
      <span>空间正在发生</span>
      <strong>让灵感有处发生</strong>
      <small>每一次预约，都点亮一间房间</small>
    </div>
    <div class="space-scene__coordinates" aria-hidden="true">SPACE SYSTEM / 2026 <span>● ● ●</span></div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { getSceneMotion } from './sceneMotion'

const props = defineProps({ variant: { type: String, default: 'full' } })

const host = ref(null)
const failed = ref(false)
let disposeScene = () => {}

onMounted(async () => {
  try {
    const THREE = await import('three')
    const { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js')
    if (!host.value) return
    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100)
    camera.position.set(6.3, 5.8, 8.4)
    camera.lookAt(0, 0.48, 0)
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.48
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.value.prepend(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xcfeaff, 2.8))
    const key = new THREE.DirectionalLight(0xffefc6, 4)
    key.position.set(-4, 8, 6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x5caeff, 3.2)
    fill.position.set(5, 5, -4)
    scene.add(fill)

    const model = new THREE.Group()
    scene.add(model)
    const materials = {
      base: new THREE.MeshStandardMaterial({ color: 0x0b2647, metalness: 0.58, roughness: 0.28 }),
      edge: new THREE.MeshStandardMaterial({ color: 0x2389d4, metalness: 0.72, roughness: 0.22, emissive: 0x0c4679, emissiveIntensity: 0.62 }),
      floor: new THREE.MeshStandardMaterial({ color: 0xd4dfdf, roughness: 0.62, metalness: 0.07 }),
      wall: new THREE.MeshPhysicalMaterial({ color: 0x7dd7fa, metalness: 0.18, roughness: 0.1, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      gold: new THREE.MeshStandardMaterial({ color: 0xf0b64f, metalness: 0.62, roughness: 0.22, emissive: 0xba690b, emissiveIntensity: 0.55 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x33b9ea, metalness: 0.24, roughness: 0.25, emissive: 0x0876b6, emissiveIntensity: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x15385c, metalness: 0.22, roughness: 0.47 }),
      mint: new THREE.MeshStandardMaterial({ color: 0x74ead6, metalness: 0.18, roughness: 0.32, emissive: 0x136b61, emissiveIntensity: 0.36 }),
      route: new THREE.MeshBasicMaterial({ color: 0x5edbff }),
      pulse: new THREE.MeshBasicMaterial({ color: 0xffd46e, transparent: true, opacity: 0.9 }),
      neon: new THREE.MeshBasicMaterial({ color: 0x66e4ff, transparent: true, opacity: 0.86, side: THREE.DoubleSide }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xc6f1ff, transparent: true, opacity: 0.2, metalness: 0.05, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false }),
      white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x225c70, emissiveIntensity: 0.18 })
    }
    materials.skin = new THREE.MeshStandardMaterial({ color: 0xe9bb96, roughness: 0.82 })
    materials.fabric = new THREE.MeshStandardMaterial({ color: 0x2267a4, roughness: 0.78 })
    materials.wood = new THREE.MeshStandardMaterial({ color: 0x9e633c, roughness: 0.68 })
    const box = (parent, w, h, d, x, y, z, material) => {
      const radius = Math.min(w, h, d) * 0.14
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), material)
      mesh.position.set(x, y, z)
      parent.add(mesh)
      return mesh
    }
    const cylinder = (parent, radius, height, x, y, z, material, sides = 24) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), material)
      mesh.position.set(x, y, z)
      parent.add(mesh)
      return mesh
    }

    box(model, 8.5, 0.34, 4.5, 0, -0.23, 0, materials.base)
    box(model, 8.34, 0.06, 4.34, 0, -0.02, 0, materials.edge)
    box(model, 8.1, 0.035, 4.05, 0, 0.02, 0, materials.dark)
    for (const side of [-1, 1]) {
      box(model, 0.08, 0.09, 3.88, side * 4.06, 0.07, 0, materials.neon)
      box(model, 0.1, 0.14, 0.74, side * 4.03, 0.1, 1.46, materials.gold)
    }
    box(model, 7.92, 0.09, 0.08, 0, 0.07, 1.98, materials.neon)
    // 后方书院立面给三间开放式功能房一个统一的建筑轮廓。
    box(model, 7.6, 0.22, 0.36, 0, 0.25, -1.95, materials.base)
    for (const x of [-3.8, -2.45, -1.1, 1.1, 2.45, 3.8]) {
      box(model, 0.12, 1.3, 0.18, x, 0.89, -1.94, materials.white)
      box(model, 0.18, 0.14, 0.24, x, 1.55, -1.94, materials.gold)
    }
    box(model, 7.85, 0.11, 0.49, 0, 1.59, -1.95, materials.gold)
    box(model, 2.12, 1.62, 0.42, 0, 1.24, -2.32, materials.base)
    box(model, 1.92, 0.09, 0.48, 0, 2.11, -2.32, materials.neon)
    for (const x of [-0.66, 0, 0.66]) {
      box(model, 0.34, 0.8, 0.05, x, 1.38, -2.08, materials.glass)
      box(model, 0.03, 0.95, 0.08, x + 0.19, 1.35, -2.02, materials.neon)
    }
    const crown = cylinder(model, 0.16, 0.12, 0, 2.28, -2.28, materials.gold)
    const crownLight = new THREE.PointLight(0xffd477, 2.7, 5)
    crownLight.position.copy(crown.position)
    model.add(crownLight)
    const rooms = [-2.62, 0, 2.62]
    rooms.forEach((x, index) => {
      const room = new THREE.Group()
      room.position.x = x
      model.add(room)
      box(room, 2.32, 0.07, 2.16, 0, 0.09, -0.72, materials.floor)
      for (const tileX of [-0.58, 0, 0.58]) box(room, 0.017, 0.014, 2.08, tileX, 0.135, -0.72, materials.wood)
      for (const tileZ of [-1.27, -0.72, -0.17]) box(room, 2.24, 0.014, 0.017, 0, 0.135, tileZ, materials.wood)
      box(room, 1.92, 0.011, 0.028, 0, 0.14, 0.15, index === 1 ? materials.gold : materials.blue)
      box(room, 2.32, 0.82, 0.055, 0, 0.52, -1.79, materials.wall)
      box(room, 0.055, 0.82, 2.16, -1.16, 0.52, -0.72, materials.wall)
      box(room, 0.055, 0.82, 2.16, 1.16, 0.52, -0.72, materials.wall)
      box(room, 2.36, 0.065, 0.065, 0, 0.94, -1.79, materials.gold)
      for (const side of [-1, 1]) {
        box(room, 0.055, 0.87, 0.055, side * 1.16, 0.54, 0.33, materials.neon)
        box(room, 0.19, 0.13, 0.19, side * 0.95, 0.2, 0.16, materials.dark)
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), materials.mint)
        leaves.position.set(side * 0.95, 0.39, 0.16)
        room.add(leaves)
      }
      const light = cylinder(room, 0.1, 0.035, 0, 0.87, -0.77, materials.gold)
      light.rotation.x = Math.PI / 2
      if (index === 0) {
        // 阅览室：一排书架与阅读桌。
        box(room, 1.74, 0.75, 0.28, 0, 0.49, -1.51, materials.dark)
        for (let i = 0; i < 8; i++) box(room, 0.1, 0.38 + (i % 3) * 0.08, 0.18, -0.76 + i * 0.21, 0.56, -1.32, i % 2 ? materials.gold : materials.mint)
        box(room, 0.98, 0.07, 0.52, 0, 0.38, -0.24, materials.gold)
        for (const leg of [-0.38, 0.38]) box(room, 0.06, 0.26, 0.06, leg, 0.23, -0.24, materials.dark)
        box(room, 0.35, 0.025, 0.2, -0.08, 0.43, -0.2, materials.white)
        box(room, 0.12, 0.025, 0.2, 0.18, 0.43, -0.2, materials.blue)
        box(room, 0.32, 0.1, 0.24, -0.62, 0.22, -0.33, materials.wood)
        box(room, 0.32, 0.1, 0.24, 0.62, 0.22, -0.33, materials.wood)
      } else if (index === 1) {
        // 研讨室：圆桌和四张座椅。
        cylinder(room, 0.55, 0.07, 0, 0.42, -0.8, materials.gold)
        cylinder(room, 0.07, 0.3, 0, 0.24, -0.8, materials.dark)
        for (const [cx, cz] of [[-0.8, -0.8], [0.8, -0.8], [0, -0.06], [0, -1.52]]) {
          box(room, 0.31, 0.07, 0.28, cx, 0.28, cz, materials.blue)
          box(room, 0.29, 0.28, 0.045, cx, 0.42, cz - 0.15, materials.blue)
        }
        cylinder(room, 0.18, 0.025, 0, 0.47, -0.8, materials.white)
        for (const [cx, cz] of [[-0.27, -0.8], [0.18, -0.58]]) box(room, 0.22, 0.012, 0.15, cx, 0.49, cz, materials.white)
      } else {
        // 活动室：低台、座椅和演示屏。
        box(room, 1.63, 0.14, 0.52, 0, 0.2, -1.28, materials.gold)
        box(room, 1.28, 0.63, 0.06, 0, 0.63, -1.74, materials.dark)
        box(room, 0.93, 0.38, 0.07, 0, 0.63, -1.69, materials.blue)
        box(room, 0.48, 0.035, 0.08, 0, 0.62, -1.63, materials.neon)
        for (const cx of [-0.67, 0, 0.67]) box(room, 0.33, 0.16, 0.33, cx, 0.18, -0.23, materials.mint)
        for (const cx of [-0.75, 0, 0.75]) cylinder(room, 0.05, 0.2, cx, 0.3, -1.14, materials.gold)
      }
      const beacon = cylinder(room, 0.07, 0.24, 0, 0.2, 1.46, materials.gold)
      beacon.userData.isBeacon = true
    })
    const people = []
    const makePerson = (x, z, shirtMaterial, heading) => {
      const figure = new THREE.Group()
      figure.position.set(x, 0.11, z)
      figure.rotation.y = heading
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), materials.skin)
      head.position.y = 0.69
      figure.add(head)
      box(figure, 0.22, 0.31, 0.15, 0, 0.43, 0, shirtMaterial)
      box(figure, 0.22, 0.18, 0.14, 0, 0.2, 0, materials.dark)
      for (const side of [-1, 1]) {
        const arm = cylinder(figure, 0.035, 0.24, side * 0.16, 0.42, 0, shirtMaterial, 10)
        arm.rotation.z = side * 0.24
        box(figure, 0.065, 0.2, 0.07, side * 0.065, 0.07, 0, materials.dark)
      }
      model.add(figure)
      people.push(figure)
    }
    makePerson(-3.08, 0.19, materials.fabric, -0.32)
    makePerson(-0.81, 0.08, materials.wood, 0.34)
    makePerson(0.82, -0.1, materials.fabric, -0.55)
    makePerson(3.12, 0.15, materials.wood, 0.4)
    const pathPoints = [[-3.2, 1.15], [-1.8, 1.15], [-1.8, 0], [0, 0], [1.8, 0], [1.8, 1.15], [3.2, 1.15]]
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const [ax, az] = pathPoints[i]
      const [bx, bz] = pathPoints[i + 1]
      if (ax !== bx) box(model, Math.abs(bx - ax), 0.02, 0.035, (ax + bx) / 2, 0.08, az, materials.route)
      else box(model, 0.035, 0.02, Math.abs(bz - az), ax, 0.08, (az + bz) / 2, materials.route)
    }
    // 多层光轨把预约状态从平面路径带到空间中。
    const outerOrbit = new THREE.Mesh(new THREE.TorusGeometry(4.08, 0.022, 8, 120), materials.neon)
    outerOrbit.rotation.x = Math.PI / 2
    outerOrbit.scale.y = 0.57
    outerOrbit.position.y = 0.28
    scene.add(outerOrbit)
    const orbitGroup = new THREE.Group()
    orbitGroup.position.set(0, 1.75, -2.36)
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.032, 10, 80), materials.gold)
    ringA.rotation.y = 0.38
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.015, 8, 90), materials.neon)
    ringB.rotation.y = -0.58
    orbitGroup.add(ringA, ringB)
    scene.add(orbitGroup)
    const orbitNode = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), materials.pulse)
    orbitNode.position.set(1.08, 0, 0)
    orbitGroup.add(orbitNode)

    const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x70d9ff, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
    const beams = rooms.map((x, index) => {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.82, 3.5, 24, 1, true), beamMaterial)
      beam.position.set(x, 1.83, -0.72)
      scene.add(beam)
      const top = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 32), index === 1 ? materials.gold : materials.neon)
      top.rotation.x = Math.PI / 2
      top.position.set(x, 3.43, -0.72)
      scene.add(top)
      return { beam, top }
    })
    const sparks = new THREE.Group()
    scene.add(sparks)
    for (let index = 0; index < 30; index++) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(index % 5 === 0 ? 0.048 : 0.025, 8, 6), index % 4 === 0 ? materials.gold : materials.neon)
      const angle = index * 2.39996
      const radius = 3.6 + (index % 5) * 0.4
      spark.position.set(Math.cos(angle) * radius, 0.7 + (index % 7) * 0.42, Math.sin(angle) * radius * 0.56)
      sparks.add(spark)
    }
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), materials.pulse)
    model.add(pulse)
    const halo = new THREE.PointLight(0xffc770, 3.5, 3)
    model.add(halo)

    let frame = 0
    let lastFrame = 0
    const startedAt = performance.now()
    const resize = () => {
      if (!host.value) return
      const width = host.value.clientWidth
      const height = host.value.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.fov = camera.aspect < 1.15 ? 49 : props.variant === 'compact' ? 42 : 39
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      renderer.render(scene, camera)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host.value)
    const render = timestamp => {
      if (document.hidden) { frame = 0; return }
      if (timestamp - lastFrame < 32) { frame = requestAnimationFrame(render); return }
      lastFrame = timestamp
      const motion = getSceneMotion((timestamp - startedAt) / 1000, reduceQuery.matches)
      pulse.position.set(motion.pulseX, 0.2 + motion.float, motion.pulseZ)
      pulse.scale.setScalar(0.85 + motion.glow * 0.32)
      halo.position.copy(pulse.position)
      halo.intensity = 2.2 + motion.glow * 2
      model.rotation.y = motion.turn
      model.position.y = motion.float
      model.scale.setScalar(reduceQuery.matches ? 1 : 0.78 + Math.min(1, (timestamp - startedAt) / 1100) * 0.22)
      orbitGroup.rotation.y = motion.orbitAngle
      orbitGroup.rotation.x = Math.sin(motion.orbitAngle * 0.7) * 0.18
      outerOrbit.rotation.z = motion.orbitAngle * 0.16
      sparks.rotation.y = motion.orbitAngle * 0.18
      beams.forEach(({ beam, top }, index) => {
        beam.scale.y = motion.beamHeight + index * 0.06
        top.position.y = 3.42 + Math.sin(motion.orbitAngle * 2 + index) * 0.12
      })
      people.forEach((figure, index) => {
        figure.position.y = 0.11 + (reduceQuery.matches ? 0 : Math.sin(motion.orbitAngle * 4 + index * 1.2) * 0.018)
      })
      beamMaterial.opacity = 0.1 + motion.glow * 0.09
      camera.position.x = 6.3 + motion.cameraSweep
      camera.position.y = 5.8 + motion.float * 1.8
      camera.lookAt(0, 0.5, 0)
      renderer.render(scene, camera)
      frame = reduceQuery.matches ? 0 : requestAnimationFrame(render)
    }
    const resume = () => {
      resize()
      if (!frame && !document.hidden) frame = requestAnimationFrame(render)
    }
    const pauseForMotion = () => resume()
    reduceQuery.addEventListener?.('change', pauseForMotion)
    document.addEventListener('visibilitychange', resume)
    resize()
    frame = requestAnimationFrame(render)
    disposeScene = () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      reduceQuery.removeEventListener?.('change', pauseForMotion)
      document.removeEventListener('visibilitychange', resume)
      scene.traverse(object => object.geometry?.dispose())
      Object.values(materials).forEach(material => material.dispose())
      beamMaterial.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  } catch (error) {
    failed.value = true
    console.warn('Space scene unavailable:', error)
  }
})

onBeforeUnmount(() => disposeScene())
</script>

<style scoped>
.space-scene {
  position: relative;
  width: 100%;
  height: 380px;
  overflow: hidden;
  border: 1px solid rgba(137, 214, 255, .36);
  border-radius: 24px;
  background: #081b33;
  box-shadow: inset 0 1px rgba(255,255,255,.19), 0 28px 70px rgba(2, 12, 31, .3), 0 0 55px rgba(39, 160, 221, .1);
}
.space-scene::before {
  content: '';
  position: absolute;
  inset: -5%;
  z-index: 0;
  background: linear-gradient(180deg, rgba(4,22,46,.18), rgba(4,19,40,.46) 76%, rgba(4,19,40,.84)), url('/space-campus-night.png') center / cover;
  animation: scene-backdrop-drift 20s ease-in-out infinite alternate;
}
.space-scene::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  box-shadow: inset 0 0 70px rgba(2,16,38,.48), inset 0 0 0 1px rgba(119,220,255,.12);
  background: radial-gradient(ellipse at 50% 53%, rgba(0,127,209,.09), transparent 58%);
}
.space-scene :deep(canvas) { position: relative; z-index: 1; display: block; width: 100%; height: 100%; filter: drop-shadow(0 18px 18px rgba(0,8,24,.55)); }
.space-scene__grid { position: absolute; inset: 0; z-index: 1; opacity: .22; pointer-events: none; background-image: linear-gradient(90deg, transparent 98%, rgba(90,198,255,.3) 100%), linear-gradient(transparent 98%, rgba(90,198,255,.3) 100%); background-size: 36px 36px; mask-image: linear-gradient(to top, black, transparent 65%); }
.space-scene__topline { position: absolute; z-index: 3; top: 21px; left: 22px; right: 22px; display: flex; align-items: center; gap: 9px; color: #d3edfa; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-shadow: 0 1px 5px #081b33; }
.space-scene__topline > span:last-child { margin-left: auto; color: #9ed7ed; font-weight: 600; }
.space-scene__live-dot { width: 7px; height: 7px; border-radius: 50%; background: #7cf4ca; box-shadow: 0 0 12px #7cf4ca; animation: scene-beacon 2s ease-in-out infinite; }
.space-scene__room-labels { position: absolute; z-index: 3; top: 66px; left: 9%; right: 9%; display: flex; justify-content: space-between; pointer-events: none; }
.space-scene__room-labels span { padding: 6px 10px; border: 1px solid rgba(132,219,253,.36); border-radius: 6px; background: rgba(3,30,57,.58); color: #d8f7ff; box-shadow: 0 5px 18px rgba(1,16,40,.22); font-size: 10px; font-weight: 700; letter-spacing: .08em; backdrop-filter: blur(6px); }
.space-scene__caption { position: absolute; z-index: 3; left: 22px; bottom: 23px; display: grid; gap: 4px; pointer-events: none; color: white; text-shadow: 0 3px 12px rgba(0,0,0,.7); }
.space-scene__caption span { color: #f1c573; font-size: 11px; font-weight: 800; letter-spacing: .16em; }
.space-scene__caption strong { font-size: 23px; letter-spacing: .05em; line-height: 1.2; }
.space-scene__caption small { color: rgba(236,249,255,.83); font-size: 12px; }
.space-scene__coordinates { position: absolute; z-index: 3; right: 20px; bottom: 21px; color: rgba(197,234,250,.72); font-size: 9px; letter-spacing: .1em; }
.space-scene__coordinates span { margin-left: 6px; color: #ffc366; }
.space-scene__fallback { position: absolute; z-index: 2; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; color: white; }
.space-scene__fallback span { padding: 14px; border: 1px solid rgba(255,255,255,.3); border-radius: 10px; background: rgba(255,255,255,.08); }
.space-scene--compact { height: 330px; }
.space-scene--compact .space-scene__room-labels { top: 61px; }
.space-scene--compact .space-scene__caption { left: 18px; bottom: 15px; }
.space-scene--compact .space-scene__caption strong { font-size: 18px; }
.space-scene--compact .space-scene__caption small { display: none; }
@keyframes scene-backdrop-drift { from { transform: scale(1) translateX(-1.2%); } to { transform: scale(1.06) translateX(1.2%); } }
@keyframes scene-beacon { 50% { opacity: .45; box-shadow: 0 0 22px #7cf4ca; } }
@media (max-width: 600px) {
  .space-scene { height: 265px; }
  .space-scene--compact { height: 260px; }
  .space-scene__room-labels { top: 48px; left: 5%; right: 5%; }
  .space-scene__room-labels span { padding: 4px 6px; font-size: 8px; }
  .space-scene__caption strong { font-size: 16px; }
  .space-scene__caption small, .space-scene__coordinates, .space-scene__topline > span:last-child { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .space-scene::before, .space-scene__live-dot { animation: none; }
}
</style>
