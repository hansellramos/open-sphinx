<script setup>
// Fotos a pantalla completa: pellizcar para zoom (y doble toque), arrastrar para moverse dentro de la foto,
// deslizar a los lados para pasar a la anterior/siguiente y hacia abajo para cerrar. Los videos de la
// secuencia salen con su miniatura; al tocarlos se cierra y se reproducen en la vista normal.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { useCompartir } from '@/lib/compartir'

const props = defineProps({ ids: { type: Array, required: true }, inicial: { type: String, required: true } })
const emit = defineEmits(['cerrar'])
const boveda = useBovedaStore()
const { progreso, compartir } = useCompartir()

const MAX = 6
const idx = ref(Math.max(0, props.ids.indexOf(props.inicial)))
const cargados = reactive({}) // id → { url, file } (foto) | { url } (miniatura de video)
const ui = ref(true)
const animando = ref(false)
const z = reactive({ s: 1, tx: 0, ty: 0 }) // zoom de la foto actual
const desliz = reactive({ dx: 0, dy: 0 })

const itemDe = (id) => boveda.items.find((v) => v.id === id)
const actual = computed(() => itemDe(props.ids[idx.value]))
const vecinos = computed(() => [-1, 0, 1].map((k) => ({ k, id: props.ids[idx.value + k] })).filter((x) => x.id && itemDe(x.id)?.m))
const fondo = computed(() => Math.max(0, 1 - desliz.dy / 400))

async function cargar(id) {
  if (cargados[id]) return
  const v = itemDe(id)
  if (!v?.m) return
  cargados[id] = { url: null }
  try {
    if (boveda.tipo(v) === 'imagen') {
      const file = await boveda.paraCompartir(v)
      cargados[id] = { url: URL.createObjectURL(file), file }
    } else cargados[id] = { url: await boveda.thumbUrl(v) } // la miniatura la guarda y libera el store
  } catch {
    delete cargados[id]
  }
}
// Se mantienen la actual y dos a cada lado; el resto se libera.
watch(
  idx,
  (i) => {
    for (const k of [0, 1, -1, 2, -2]) props.ids[i + k] && cargar(props.ids[i + k])
    for (const [id, c] of Object.entries(cargados)) {
      if (Math.abs(props.ids.indexOf(id) - i) > 2) {
        if (c.file && c.url) URL.revokeObjectURL(c.url)
        delete cargados[id]
      }
    }
  },
  { immediate: true },
)

// ---------- zoom ----------

const centro = () => ({ w: window.innerWidth, h: window.innerHeight })
function limites(s) {
  const el = document.querySelector('.vc-actual')
  const { w, h } = centro()
  if (!el) return { x: 0, y: 0 }
  return { x: Math.max(0, (s * el.offsetWidth - w) / 2), y: Math.max(0, (s * el.offsetHeight - h) / 2) }
}
function acomodar() {
  if (z.s < 1) Object.assign(z, { s: 1, tx: 0, ty: 0 })
  const l = limites(z.s)
  z.tx = Math.min(l.x, Math.max(-l.x, z.tx))
  z.ty = Math.min(l.y, Math.max(-l.y, z.ty))
}
function animar(fn, ms = 250) {
  animando.value = true
  fn()
  return new Promise((r) => setTimeout(() => ((animando.value = false), r()), ms))
}
// Zoom a `s` dejando quieto el punto p (relativo al centro de la pantalla).
function zoomEn(s, p) {
  s = Math.min(MAX, s)
  const c = { x: (p.x - z.tx) / z.s, y: (p.y - z.ty) / z.s }
  Object.assign(z, { s, tx: p.x - s * c.x, ty: p.y - s * c.y })
}
const esFoto = () => actual.value && boveda.tipo(actual.value) === 'imagen'

// ---------- pasar / cerrar ----------

let pasando = false
async function ir(dir) {
  if (!props.ids[idx.value + dir] || pasando) return
  pasando = true
  await animar(() => (desliz.dx = -dir * centro().w))
  pasando = false
  idx.value += dir
  Object.assign(desliz, { dx: 0, dy: 0 })
  Object.assign(z, { s: 1, tx: 0, ty: 0 })
}
const cerrar = (id = props.ids[idx.value]) => emit('cerrar', id)

// ---------- gestos ----------

const dedos = new Map()
let g = null // gesto en curso
let ultimoToque = null
let timerToque = null
const rel = (p) => ({ x: p.x - centro().w / 2, y: p.y - centro().h / 2 })

function abajo(e) {
  if (e.target.closest('button')) return
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY })
  e.currentTarget.setPointerCapture?.(e.pointerId)
  if (dedos.size === 2 && esFoto()) {
    const [a, b] = [...dedos.values()]
    Object.assign(desliz, { dx: 0, dy: 0 })
    g = { tipo: 'pellizco', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: z.s, c: null }
    const m = rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    g.c = { x: (m.x - z.tx) / z.s, y: (m.y - z.ty) / z.s }
  } else if (dedos.size === 1) g = { tipo: null, x0: e.clientX, y0: e.clientY, tx0: z.tx, ty0: z.ty, t0: performance.now() }
}

function mover(e) {
  if (!dedos.has(e.pointerId) || !g) return
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (g.tipo === 'pellizco') {
    if (dedos.size < 2) return
    const [a, b] = [...dedos.values()]
    const s = Math.min(MAX * 1.2, Math.max(0.6, (g.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0))
    const m = rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    Object.assign(z, { s, tx: m.x - s * g.c.x, ty: m.y - s * g.c.y })
    return
  }
  const dx = e.clientX - g.x0
  const dy = e.clientY - g.y0
  if (!g.tipo && Math.hypot(dx, dy) > 8) g.tipo = z.s > 1.01 ? 'mover' : Math.abs(dx) > Math.abs(dy) ? 'pasar' : dy > 0 ? 'cerrar' : 'nada'
  if (g.tipo === 'mover') Object.assign(z, { tx: g.tx0 + dx, ty: g.ty0 + dy })
  else if (g.tipo === 'pasar') desliz.dx = props.ids[idx.value + (dx < 0 ? 1 : -1)] ? dx : dx / 3
  else if (g.tipo === 'cerrar') desliz.dy = Math.max(0, dy)
}

function arriba(e) {
  if (!dedos.delete(e.pointerId) || !g) return
  if (g.tipo === 'pellizco') {
    if (dedos.size === 1) {
      const [r] = [...dedos.values()] // sigue un dedo: ahora mueve
      g = { tipo: 'mover', x0: r.x, y0: r.y, tx0: z.tx, ty0: z.ty }
    } else if (!dedos.size) {
      if (z.s > MAX) zoomEn(MAX, { x: 0, y: 0 })
      animar(acomodar)
      g = null
    }
    return
  }
  if (dedos.size) return
  const fin = g
  g = null
  const dt = performance.now() - fin.t0
  if (fin.tipo === 'pasar') {
    const rapido = Math.abs(desliz.dx) / dt > 0.5 && Math.abs(desliz.dx) > 30
    const dir = desliz.dx < -centro().w * 0.2 || (rapido && desliz.dx < 0) ? 1 : desliz.dx > centro().w * 0.2 || (rapido && desliz.dx > 0) ? -1 : 0
    if (dir && props.ids[idx.value + dir]) ir(dir)
    else animar(() => (desliz.dx = 0))
  } else if (fin.tipo === 'cerrar') {
    if (desliz.dy > 120 || desliz.dy / dt > 0.6) cerrar()
    else animar(() => (desliz.dy = 0))
  } else if (fin.tipo === 'mover') animar(acomodar)
  else if (!fin.tipo) tocar(e)
}

function cancelar(e) {
  dedos.delete(e.pointerId)
  if (!dedos.size) {
    g = null
    animar(() => {
      Object.assign(desliz, { dx: 0, dy: 0 })
      acomodar()
    })
  }
}

// Un toque muestra/oculta los controles; doble toque acerca o vuelve al tamaño normal.
function tocar(e) {
  const ahora = performance.now()
  if (ultimoToque && ahora - ultimoToque.t < 300 && Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) < 40) {
    clearTimeout(timerToque)
    ultimoToque = null
    if (!esFoto()) return
    animar(() => {
      if (z.s > 1.01) Object.assign(z, { s: 1, tx: 0, ty: 0 })
      else {
        zoomEn(2.5, rel({ x: e.clientX, y: e.clientY }))
        acomodar()
      }
    })
    return
  }
  ultimoToque = { t: ahora, x: e.clientX, y: e.clientY }
  timerToque = setTimeout(() => (ui.value = !ui.value), 300)
}

// Rueda o trackpad (computador).
function rueda(e) {
  if (!esFoto()) return
  e.preventDefault()
  zoomEn(Math.max(1, z.s * Math.exp(-e.deltaY / 300)), rel({ x: e.clientX, y: e.clientY }))
  acomodar()
}

function tecla(e) {
  if (e.key === 'Escape') cerrar()
  else if (e.key === 'ArrowRight') ir(1)
  else if (e.key === 'ArrowLeft') ir(-1)
}
const sinGesto = (e) => e.preventDefault() // Safari: que no haga zoom de la página
onMounted(() => {
  window.addEventListener('keydown', tecla, true)
  document.addEventListener('gesturestart', sinGesto)
  document.documentElement.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', tecla, true)
  document.removeEventListener('gesturestart', sinGesto)
  document.documentElement.style.overflow = ''
  clearTimeout(timerToque)
  for (const c of Object.values(cargados)) if (c.file && c.url) URL.revokeObjectURL(c.url)
})

const estiloSlide = (k) => ({
  transform: `translate3d(calc(${k * 100}% + ${desliz.dx}px), ${desliz.dy}px, 0)${desliz.dy ? ` scale(${1 - Math.min(desliz.dy, 400) / 1600})` : ''}`,
})
const estiloFoto = computed(() => ({ transform: `translate3d(${z.tx}px, ${z.ty}px, 0) scale(${z.s})` }))
const compartirActual = () => {
  const v = actual.value
  if (v) compartir(v, cargados[v.id]?.file ?? null)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="visor-completo"
      :class="{ animando }"
      :style="{ backgroundColor: `rgba(0,0,0,${fondo})` }"
      @pointerdown="abajo"
      @pointermove="mover"
      @pointerup="arriba"
      @pointercancel="cancelar"
      @wheel="rueda"
    >
      <div v-for="s in vecinos" :key="s.id" class="vc-slide" :style="estiloSlide(s.k)">
        <template v-if="boveda.tipo(itemDe(s.id)) === 'imagen'">
          <img
            v-if="cargados[s.id]?.url"
            :src="cargados[s.id].url"
            class="vc-foto"
            :class="{ 'vc-actual': s.k === 0 }"
            :style="s.k === 0 ? estiloFoto : null"
            :alt="itemDe(s.id).m.title"
            draggable="false"
          />
          <CSpinner v-else color="light" />
        </template>
        <div v-else-if="boveda.tipo(itemDe(s.id)) === 'video'" class="vc-video">
          <img v-if="cargados[s.id]?.url" :src="cargados[s.id].url" class="vc-foto" alt="" draggable="false" />
          <button type="button" class="vc-play" title="Reproducir" @click="cerrar(s.id)"><CIcon icon="cil-media-play" size="3xl" /></button>
        </div>
      </div>

      <div v-show="ui" class="vc-barra">
        <button type="button" class="vc-btn" title="Cerrar" @click="cerrar()"><CIcon icon="cil-x" size="xl" /></button>
        <div class="vc-titulo text-truncate">
          <div class="text-truncate">{{ actual?.m?.title }}</div>
          <div class="small opacity-75">{{ idx + 1 }} de {{ ids.length }}</div>
        </div>
        <button type="button" class="vc-btn" title="Compartir" :disabled="progreso !== null" @click="compartirActual">
          <CIcon icon="cil-share-boxed" size="xl" /><span v-if="progreso !== null" class="small ms-1">{{ progreso }}%</span>
        </button>
      </div>
      <button v-show="ui && ids[idx - 1]" type="button" class="vc-btn vc-nav vc-ant" title="Anterior" @click="ir(-1)"><CIcon icon="cil-chevron-left" size="xl" /></button>
      <button v-show="ui && ids[idx + 1]" type="button" class="vc-btn vc-nav vc-sig" title="Siguiente" @click="ir(1)"><CIcon icon="cil-chevron-right" size="xl" /></button>
    </div>
  </Teleport>
</template>
