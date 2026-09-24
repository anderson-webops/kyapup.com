import { acceptHMRUpdate, defineStore } from 'pinia'

export const useUserStore = defineStore('user', () => {
  const maximumSavedNames = 20
  /**
   * Current named of the user.
   */
  const savedName = ref('')
  const previousNames = ref(new Set<string>())

  const usedNames = computed(() => Array.from(previousNames.value))
  const otherNames = computed(() => usedNames.value.filter(name => name !== savedName.value))

  /**
   * Changes the current name of the user and saves the one that was used
   * before.
   *
   * @param name - new name to set
   */
  function setNewName(name: string) {
    const normalizedName = name.trim().slice(0, 80)
    if (!normalizedName)
      return

    if (savedName.value && savedName.value !== normalizedName) {
      previousNames.value.add(savedName.value)

      while (previousNames.value.size > maximumSavedNames) {
        const oldestName = previousNames.value.values().next().value
        if (oldestName === undefined)
          break
        previousNames.value.delete(oldestName)
      }
    }

    savedName.value = normalizedName
  }

  return {
    setNewName,
    otherNames,
    savedName,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
