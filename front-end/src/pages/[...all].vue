<template>
  <main class="not-found">
    <h1>Nothing here just yet.</h1><NuxtLink to="/">
      Back to Kya
    </NuxtLink>
  </main>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}
h1 {
  font:
    2rem 'DM Serif',
    Georgia,
    serif;
}
a {
  color: #b8d0b6;
}
</style>
