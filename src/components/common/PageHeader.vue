<script setup>
defineProps({ title: String, subtitle: String })
</script>

<template>
  <div class="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-4">
    <div>
      <h1 class="page-title">{{ title }}</h1>
      <div v-if="subtitle" class="text-body-secondary small mt-2">{{ subtitle }}</div>
    </div>
    <div class="d-flex flex-wrap gap-2 no-print"><slot /></div>
  </div>
</template>
