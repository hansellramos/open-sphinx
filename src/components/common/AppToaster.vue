<script setup>
import { useToastStore } from '@/stores/toast'
const toasts = useToastStore()
</script>

<template>
  <CToaster class="p-3" placement="top-end">
    <CToast v-for="t in toasts.items" :key="t.id" :autohide="true" :delay="4500" visible :color="t.color" class="text-white align-items-center">
      <div class="d-flex">
        <CToastBody><strong v-if="t.title" class="d-block">{{ t.title }}</strong>{{ t.message }}</CToastBody>
        <CToastClose class="me-2 m-auto" white />
      </div>
    </CToast>
  </CToaster>
</template>
