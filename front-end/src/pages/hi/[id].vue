<script setup lang="ts">
const route = useRoute<'hi-id'>()
const user = useUserStore()
const name = computed(() => String(route.params.id).slice(0, 80))

watchEffect(() => {
  user.setNewName(name.value)
})

definePageMeta({
  layout: 'home',
})
</script>

<template>
  <div>
    <div i-twemoji:waving-hand text-4xl inline-block animate-shake-x animate-duration-5000 />
    <h3 text-2xl font-500>
      Hi,
    </h3>
    <div text-xl>
      {{ name }}!
    </div>

    <template v-if="user.otherNames.length">
      <div text-sm my-4>
        <span class="text-gray-700 dark:text-gray-300">Also as known as:</span>
        <ul>
          <li v-for="otherName in user.otherNames" :key="otherName">
            <router-link :to="{ name: 'hi-id', params: { id: otherName } }" replace>
              {{ otherName }}
            </router-link>
          </li>
        </ul>
      </div>
    </template>

    <Counter />

    <div>
      <NuxtLink
        class="text-sm btn m-3"
        to="/"
      >
        Back
      </NuxtLink>
    </div>
  </div>
</template>
