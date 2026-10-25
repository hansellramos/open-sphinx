<script setup>
// Agregar o quitar elementos de álbumes: marca los álbumes donde deben estar (o crea uno nuevo con ellos).
// Con `elegir` solo devuelve los álbumes marcados (para lo que todavía se está subiendo).
import { ref, computed, watch } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'

const props = defineProps({ ids: { type: Array, default: () => [] }, visible: Boolean, elegir: Array })
const emit = defineEmits(['close', 'nuevo', 'listo', 'elegidos'])
const boveda = useBovedaStore()
const toast = useToastStore()
const marcas = ref({}) // albumId → true | false | null (algunos)
const buscar = ref('')
const guardando = ref(false)

const estado = (a) => {
  const n = props.ids.filter((id) => a.items.includes(id)).length
  return n === props.ids.length ? true : n ? null : false
}
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    buscar.value = ''
    marcas.value = Object.fromEntries(boveda.albumes.map((a) => [a.id, props.elegir ? props.elegir.includes(a.id) : estado(a)]))
  },
)
const lista = computed(() => {
  const q = buscar.value.trim().toLowerCase()
  return q ? boveda.albumes.filter((a) => a.name.toLowerCase().includes(q)) : boveda.albumes
})
const cambios = computed(() => Object.fromEntries(Object.entries(marcas.value).filter(([id, x]) => x !== null && x !== estado(boveda.album(id) ?? { items: [] }))))

async function guardar() {
  if (props.elegir) return emit('elegidos', Object.keys(marcas.value).filter((id) => marcas.value[id]))
  guardando.value = true
  try {
    const c = cambios.value
    if (Object.keys(c).length) await boveda.asignarAlbumes(props.ids, c)
    const n = Object.values(c)
    const msj = [n.filter(Boolean).length && `agregado a ${n.filter(Boolean).length} álbum${n.filter(Boolean).length > 1 ? 'es' : ''}`, n.filter((x) => !x).length && `quitado de ${n.filter((x) => !x).length}`].filter(Boolean).join(', ')
    if (msj) toast.ok(msj.charAt(0).toUpperCase() + msj.slice(1))
    emit('listo')
  } catch (e) {
    toast.error(e)
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <CModal :visible="visible" alignment="center" scrollable @close="emit('close')">
    <CModalHeader><CModalTitle>Álbumes{{ ids.length > 1 ? ` · ${ids.length} elementos` : '' }}</CModalTitle></CModalHeader>
    <CModalBody>
      <CFormInput v-if="boveda.albumes.length > 6" v-model="buscar" size="sm" placeholder="Buscar álbum…" class="mb-2" />
      <p v-if="!boveda.albumes.length" class="text-body-secondary small mb-0">Todavía no hay álbumes.</p>
      <div v-for="a in lista" :key="a.id" class="form-check py-1">
        <input :id="`alb-${a.id}`" class="form-check-input" type="checkbox" :checked="marcas[a.id] === true" :indeterminate.prop="marcas[a.id] === null" @change="marcas[a.id] = $event.target.checked" />
        <label class="form-check-label d-flex gap-2" :for="`alb-${a.id}`">
          <span class="text-truncate">{{ a.name }}</span><span class="text-body-secondary small ms-auto">{{ a.total }}</span>
        </label>
      </div>
    </CModalBody>
    <CModalFooter>
      <CButton color="primary" variant="outline" class="me-auto" @click="emit('nuevo')"><CIcon icon="cil-plus" class="me-1" />Nuevo álbum</CButton>
      <CButton color="secondary" variant="ghost" @click="emit('close')">Cancelar</CButton>
      <CButton color="primary" :disabled="guardando" @click="guardar">Guardar</CButton>
    </CModalFooter>
  </CModal>
</template>
