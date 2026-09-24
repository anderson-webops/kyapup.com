<script setup lang="ts">
import { appName } from '~/constants'

useHead({
  title: appName,
  htmlAttrs: {
    lang: 'en',
  },
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
html,
body,
#__nuxt {
  height: 100vh;
  margin: 0;
  padding: 0;
}

html {
  color: #111827;
  background: #fff;
}

html.dark {
  color: #f3f4f6;
  background: #111827;
  color-scheme: dark;
}

body {
  color: inherit;
  background: inherit;
}
</style>
