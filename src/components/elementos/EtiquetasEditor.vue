<script setup>
// Editor de etiquetas: chips + campo con sugerencias. Enter o coma agrega; la x quita.
import { ref, computed } from 'vue'

const props = defineProps({ modelValue: { type: Array, default: () => [] }, sugerencias: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const texto = ref('')
const id = `etq-${Math.random().toString(36).slice(2, 8)}`

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
const colorDe = (n) => props.sugerencias.find((s) => s.name === n)?.color ?? 'primary'
</script>

<template>
  <div>
    <div class="d-flex flex-wrap gap-1 align-items-center border rounded p-2">
      <CBadge v-for="n in modelValue" :key="n" :color="colorDe(n)" class="d-inline-flex align-items-center gap-1 py-1 px-2">
        {{ n }}<CCloseButton white style="width: .5rem; height: .5rem" @click="quitar(n)" />
      </CBadge>
      <input
        v-model="texto"
        :list="id"
        class="border-0 bg-transparent flex-grow-1 text-body"
        style="min-width: 8rem; outline: none"
        placeholder="Escribe y Enter…"
        maxlength="40"
        @keydown="tecla"
        @change="texto && sugerencias.some((s) => s.name === texto) && agregar()"
      />
      <datalist :id="id"><option v-for="s in disponibles" :key="s.id" :value="s.name" /></datalist>
    </div>
    <div v-if="disponibles.length" class="d-flex flex-wrap gap-1 mt-2">
      <CButton v-for="s in disponibles.slice(0, 12)" :key="s.id" size="sm" :color="s.color" variant="outline" class="py-0 px-2" @click="agregar(s.name)">+ {{ s.name }}</CButton>
    </div>
  </div>
</template>
