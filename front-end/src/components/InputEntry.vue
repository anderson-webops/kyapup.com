<script setup lang="ts">
const name = ref('')
const normalizedName = computed(() => name.value.trim().slice(0, 80))

const router = useRouter()
function go() {
  if (normalizedName.value) {
    void router.push({
      name: 'hi-id',
      params: { id: normalizedName.value },
    })
  }
}
</script>

<template>
  <div>
    <input
      id="input"
      v-model="name"
      placeholder="What's your name?"
      type="text"
      autocomplete="off"
      maxlength="80"
      p="x-4 y-2" m="t-5" w="250px"
      text="center" bg="transparent"
      border="~ rounded gray-200 dark:gray-700"
      outline="none active:none"
      @keydown.enter="go"
    >
    <div>
      <button
        text-sm btn m-3
        :disabled="!normalizedName"
        @click="go"
      >
        GO
      </button>
    </div>
  </div>
</template>
