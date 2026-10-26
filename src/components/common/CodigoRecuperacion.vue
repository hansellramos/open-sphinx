<script setup>
import { ref } from 'vue'
import { useToastStore } from '@/stores/toast'

const props = defineProps({ codigo: String })
const emit = defineEmits(['listo'])
const toast = useToastStore()
const guardado = ref(false)

async function copiar() {
  await navigator.clipboard.writeText(props.codigo)
  toast.ok('Código copiado')
}
function descargar() {
  const txt = `Código de recuperación de Esfinge\n\n${props.codigo}\n\nGuárdalo fuera de línea. Con él se abre la bóveda si pierdes tus passkeys.\nCreado: ${new Date().toLocaleString('es-CO')}\n`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }))
  a.download = 'boveda-codigo-recuperacion.txt'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div>
    <CAlert color="warning" class="small">
      Este código abre la bóveda si pierdes tus passkeys. <strong>Solo se muestra esta vez</strong> y nadie puede recuperarlo:
      escríbelo en papel o guárdalo en tu gestor de contraseñas. Si lo pierdes junto con las passkeys, lo guardado no se puede recuperar.
    </CAlert>
    <div class="recovery-code p-3 rounded border bg-body-tertiary text-center mb-3">{{ codigo }}</div>
    <div class="d-flex gap-2 mb-3">
      <CButton color="secondary" variant="outline" @click="copiar"><CIcon icon="cil-copy" class="me-1" />Copiar</CButton>
      <CButton color="secondary" variant="outline" @click="descargar"><CIcon icon="cil-cloud-download" class="me-1" />Descargar .txt</CButton>
    </div>
    <CFormCheck id="guardado" v-model="guardado" label="Ya lo guardé en un lugar seguro" class="mb-3" />
    <CButton color="primary" class="w-100" :disabled="!guardado" @click="emit('listo')">Continuar</CButton>
  </div>
</template>
