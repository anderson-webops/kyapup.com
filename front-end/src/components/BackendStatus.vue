<script setup lang="ts">
const runtimeConfig = useRuntimeConfig()
const status = ref<'loading' | 'online' | 'offline'>('loading')

onMounted(async () => {
  try {
    const apiBaseUrl = runtimeConfig.public.apiBaseUrl.replace(/\/$/, '')
    const response = await $fetch<{ ok: boolean }>(`${apiBaseUrl}/health`, {
      retry: 0,
      timeout: 5_000,
    })
    status.value = response.ok ? 'online' : 'offline'
  }
  catch {
    status.value = 'offline'
  }
})
</script>

<template>
  <div
    aria-live="polite"
    class="text-gray-700 dark:text-gray-300"
    role="status"
  >
    <span v-if="status === 'loading'" italic>Checking back-end...</span>
    <span v-else-if="status === 'online'">Back-end online</span>
    <span v-else>Back-end offline</span>
  </div>
</template>
