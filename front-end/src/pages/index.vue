<script setup lang="ts">
definePageMeta({
  layout: 'home',
})
</script>

<template>
  <div>
    <Logos mb-6 />
    <ClientOnly>
      <BackendStatus />
      <template #fallback>
        <div class="text-gray-700 dark:text-gray-300">
          <span animate-pulse>...</span>
        </div>
      </template>
    </ClientOnly>
    <InputEntry />
  </div>
</template>
