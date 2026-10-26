<script setup>
// Editor de etiquetas, discreto: las puestas en gris, campo que autocompleta y las que hay solo al pedirlas (▾),
// que se cierran solas a los 30 s. Enter o coma agrega; la × quita.
import { ref, computed } from 'vue'
import { useOcultable } from '@/lib/ocultable'

const props = defineProps({ modelValue: { type: Array, default: () => [] }, sugerencias: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const texto = ref('')
const id = `etq-${Math.random().toString(36).slice(2, 8)}`
const ocultable = useOcultable() // la lista de las que hay (▾)

const disponibles = computed(() => props.sugerencias.filter((s) => !props.modelValue.some((m) => m.toLowerCase() === s.name.toLowerCase())))

function agregar(nombre = texto.value) {
  const n = nombre.trim().replace(/\s+/g, ' ').slice(0, 40)
  texto.value = ''
  if (!n || props.modelValue.some((m) => m.toLowerCase() === n.toLowerCase())) return
  // Reusa el nombre exacto si ya existe con otras mayúsculas.
  const existente = props.sugerencias.find((s) => s.name.toLowerCase() === n.toLowerCase())
  emit('update:modelValue', [...props.modelValue, existente?.name ?? n])
}
function quitar(n) {
  emit('update:modelValue', props.modelValue.filter((m) => m !== n))
}
function tecla(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    agregar()
  } else if (e.key === 'Backspace' && !texto.value && props.modelValue.length) quitar(props.modelValue.at(-1))
}
</script>

<template>
  <div @keydown="ocultable.tocar('lista')" @pointerdown="ocultable.tocar('lista')">
    <div class="d-flex flex-wrap gap-1 align-items-center border rounded p-1 ps-2">
      <span v-for="n in modelValue" :key="n" class="etq-chip">
        {{ n }}<button type="button" class="etq-quitar" :aria-label="`Quitar ${n}`" @click="quitar(n)">×</button>
      </span>
      <input
        v-model="texto"
        :list="id"
        class="border-0 bg-transparent flex-grow-1 text-body"
        style="min-width: 7rem; outline: none"
        placeholder="Escribe y Enter…"
        maxlength="40"
        autocomplete="off"
        @keydown="tecla"
        @change="texto && sugerencias.some((s) => s.name === texto) && agregar()"
      />
      <datalist :id="id"><option v-for="s in disponibles" :key="s.id" :value="s.name" /></datalist>
      <button v-if="disponibles.length" type="button" class="btn btn-sm btn-link text-body-secondary p-0 px-1" :aria-expanded="ocultable.abiertos.value.has('lista')" title="Ver las etiquetas que hay" @click="ocultable.alternar('lista')">
        <CIcon :icon="ocultable.abiertos.value.has('lista') ? 'cil-chevron-top' : 'cil-chevron-bottom'" size="sm" />
      </button>
    </div>
    <!-- Las que hay: solo al pedirlas (▾) y se cierran solas a los 30 s -->
    <div v-if="ocultable.abiertos.value.has('lista') && disponibles.length" class="d-flex flex-wrap gap-1 mt-1">
      <button v-for="s in disponibles" :key="s.id" type="button" class="etq-sugerida" @click="agregar(s.name)">+ {{ s.name }}</button>
    </div>
  </div>
</template>
