<script setup lang="ts">
import type { Photo } from '~/types/gallery'

const props = defineProps<{ photos: Photo[] }>()
const emit = defineEmits<{ change: [open: boolean] }>()
const dialog = ref<HTMLDialogElement>()
const selectedId = ref<string | null>(null)
const zoomed = ref(false)
const activeIndex = computed(() => props.photos.findIndex(photo => photo.id === selectedId.value))
const photo = computed(() => props.photos[activeIndex.value])
const touchStart = ref(0)
let previousOverflow = ''

function open(id: string) {
  selectedId.value = id
  zoomed.value = false
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
  emit('change', true)
}
function close() {
  dialog.value?.close()
}
function onClose() {
  document.body.style.overflow = previousOverflow
  selectedId.value = null
  zoomed.value = false
  emit('change', false)
}
function move(direction: number) {
  if (!props.photos.length)
    return
  const next = (activeIndex.value + direction + props.photos.length) % props.photos.length
  selectedId.value = props.photos[next]!.id
  zoomed.value = false
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    move(1)
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  }
}
function onTouchEnd(event: TouchEvent) {
  if (zoomed.value)
    return
  const distance = (event.changedTouches[0]?.clientX ?? touchStart.value) - touchStart.value
  if (Math.abs(distance) > 60)
    move(distance < 0 ? 1 : -1)
}
watch(photo, (value) => {
  if (!value && dialog.value?.open)
    close()
})
onBeforeUnmount(() => {
  if (selectedId.value)
    document.body.style.overflow = previousOverflow
})
defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="lightbox" aria-label="Photo viewer" @close="onClose" @keydown="onKey">
    <div v-if="photo" class="lightbox-inner">
      <div class="lightbox-toolbar">
        <span class="photo-counter">{{ String(activeIndex + 1).padStart(2, '0') }} / {{ String(photos.length).padStart(2, '0') }}</span>
        <div class="lightbox-tools">
          <button class="icon-button" :aria-label="zoomed ? 'Fit photo to screen' : 'Zoom in'" :aria-pressed="zoomed" @click="zoomed = !zoomed">
            <span :class="zoomed ? 'i-carbon-zoom-out' : 'i-carbon-zoom-in'" aria-hidden="true" />
          </button>
          <button class="icon-button" aria-label="Close photo" autofocus @click="close">
            <span class="i-carbon-close" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="lightbox-image" :class="{ zoomed }" @touchstart.passive="touchStart = $event.touches[0]?.clientX ?? 0" @touchend.passive="onTouchEnd">
        <img :key="photo.id" :src="photo.url" :alt="photo.alt || 'Kya'" :width="photo.width" :height="photo.height">
      </div>
      <div v-if="photos.length > 1" class="lightbox-navigation">
        <button class="icon-button" aria-label="Previous photo" @click="move(-1)">
          <span class="i-carbon-arrow-left" aria-hidden="true" />
        </button>
        <button class="icon-button" aria-label="Next photo" @click="move(1)">
          <span class="i-carbon-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.lightbox {
  color: #f5f5f0;
  background: #0c100ef5;
  border: 0;
  padding: 0;
  margin: 0;
  width: 100vw;
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
}
.lightbox::backdrop {
  background: #0c100e;
}
.lightbox-inner {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  padding: 20px clamp(16px, 4vw, 60px);
  gap: 16px;
}
.lightbox-toolbar,
.lightbox-tools,
.lightbox-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.photo-counter {
  font-size: 0.875rem;
  letter-spacing: 0.12em;
  color: #c3c9c1;
}
.lightbox-image {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: auto;
}
.lightbox-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.lightbox-image.zoomed {
  display: block;
}
.lightbox-image.zoomed img {
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  min-width: 100%;
  object-fit: initial;
}
.lightbox-navigation {
  justify-content: center;
  gap: 24px;
}
.icon-button:hover {
  background: #ffffff15;
}
</style>
