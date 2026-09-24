<script setup lang="ts">
import type { Gallery, Photo } from '~/types/gallery'

const gallery = ref<Gallery>({ photos: [], settings: { mode: 'static', intervalSeconds: 8, heroPhotoId: null } })
const loading = ref(true)
const error = ref(false)
const selectedHero = ref<string | null>(null)
const paused = ref(false)
const interacting = ref(false)
const lightboxOpen = ref(false)
const lightbox = useTemplateRef('lightbox')
const reducedMotion = usePreferredReducedMotion()
const visibility = useDocumentVisibility()
const featured = computed(() => gallery.value.photos.filter(photo => photo.featured))
const heroPool = computed(() => featured.value.length ? featured.value : gallery.value.photos.slice(0, 1))
const hero = computed(() => heroPool.value.find(photo => photo.id === selectedHero.value) || heroPool.value.find(photo => photo.id === gallery.value.settings.heroPhotoId) || heroPool.value[0])
const otherPhotos = computed(() => gallery.value.photos.filter(photo => photo.id !== hero.value?.id))
const sidePhotos = computed(() => otherPhotos.value.filter(photo => !photo.featured).slice(0, 2))
const gridPhotos = computed(() => otherPhotos.value.filter(photo => !sidePhotos.value.some(side => side.id === photo.id)))
const canCycle = computed(() => gallery.value.settings.mode === 'cycle' && heroPool.value.length > 1)
let refreshTimer: ReturnType<typeof setInterval> | undefined
let cycleTimer: ReturnType<typeof setInterval> | undefined

async function refresh() {
  try {
    const result = await $fetch<Gallery>('/api/gallery')
    if (JSON.stringify(result.settings) !== JSON.stringify(gallery.value.settings))
      selectedHero.value = result.settings.heroPhotoId
    gallery.value = result
    error.value = false
  }
  catch { error.value = true }
  finally { loading.value = false }
}
function open(photo: Photo) {
  lightbox.value?.open(photo.id)
}
function resetCycle() {
  clearInterval(cycleTimer)
  if (!canCycle.value || paused.value)
    return
  cycleTimer = setInterval(() => {
    if (interacting.value || lightboxOpen.value || visibility.value !== 'visible')
      return
    const next = (heroPool.value.findIndex(photo => photo.id === hero.value?.id) + 1) % heroPool.value.length
    selectedHero.value = heroPool.value[next]?.id || null
  }, gallery.value.settings.intervalSeconds * 1000)
}
watch([canCycle, paused, () => gallery.value.settings.intervalSeconds], resetCycle)
watch(visibility, (value) => {
  if (value === 'visible')
    void refresh()
})
onMounted(() => {
  paused.value = reducedMotion.value === 'reduce'
  void refresh()
  refreshTimer = setInterval(refresh, 60_000)
})
onBeforeUnmount(() => {
  clearInterval(refreshTimer)
  clearInterval(cycleTimer)
})
</script>

<template>
  <div class="gallery-shell">
    <header class="gallery-header">
      <h1 class="wordmark">
        kya<span class="wordmark-dot">.</span>
      </h1>
      <span class="i-carbon-favorite gallery-paw" aria-hidden="true" />
    </header>
    <main id="gallery" aria-label="Photos of Kya" :aria-busy="loading">
      <div v-if="loading" class="gallery-loading" role="status">
        <span class="i-carbon-circle-dash" aria-hidden="true" /><span class="sr-only">Loading photos</span>
      </div>
      <div v-else-if="!gallery.photos.length" class="gallery-empty">
        <span class="i-carbon-favorite" aria-hidden="true" /><p>{{ error ? 'Photos couldn’t load.' : 'A little more Kya, soon.' }}</p>
        <button v-if="error" class="retry-button" @click="refresh">
          Try again
        </button>
      </div>
      <template v-else>
        <div class="opening-grid" :class="{ 'hero-only': !sidePhotos.length }">
          <div class="hero-wrap" @mouseenter="interacting = true" @mouseleave="interacting = false" @focusin="interacting = true" @focusout="interacting = false">
            <button v-if="hero" class="photo-tile hero-tile" :aria-label="`Enlarge ${hero.alt || 'favorite photo of Kya'}`" @click="open(hero)">
              <Transition name="photo-fade">
                <img :key="hero.id" :src="hero.url" :alt="hero.alt || 'Kya'" :width="hero.width" :height="hero.height" fetchpriority="high">
              </Transition>
              <span class="enlarge-indicator"><span class="i-carbon-maximize" aria-hidden="true" /></span>
            </button>
            <div v-if="canCycle" class="cycle-controls">
              <span class="cycle-count">{{ String(heroPool.findIndex(photo => photo.id === hero?.id) + 1).padStart(2, '0') }} <span>/ {{ String(heroPool.length).padStart(2, '0') }}</span></span>
              <button class="icon-button" :aria-label="paused ? 'Play featured slideshow' : 'Pause featured slideshow'" @click="paused = !paused">
                <span :class="paused ? 'i-carbon-play-filled' : 'i-carbon-pause-filled'" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div v-if="sidePhotos.length" class="side-photos" @mouseenter="interacting = true" @mouseleave="interacting = false" @focusin="interacting = true" @focusout="interacting = false">
            <button v-for="photo in sidePhotos" :key="photo.id" class="photo-tile" :aria-label="`Enlarge ${photo.alt || 'photo of Kya'}`" @click="open(photo)">
              <img :src="photo.thumbnailUrl" :alt="photo.alt || 'Kya'" :width="photo.width" :height="photo.height"><span class="enlarge-indicator"><span class="i-carbon-maximize" aria-hidden="true" /></span>
            </button>
          </div>
        </div>
        <div v-if="gridPhotos.length" class="photo-grid" :class="{ 'only-favorites': gridPhotos.every(photo => photo.featured) }" @mouseenter="interacting = true" @mouseleave="interacting = false" @focusin="interacting = true" @focusout="interacting = false">
          <button v-for="photo in gridPhotos" :key="photo.id" class="photo-tile grid-tile" :class="{ 'is-featured': photo.featured }" :aria-label="`Enlarge ${photo.alt || 'photo of Kya'}`" @click="open(photo)">
            <img :src="photo.featured ? photo.url : photo.thumbnailUrl" :alt="photo.alt || 'Kya'" :width="photo.width" :height="photo.height" loading="lazy"><span class="enlarge-indicator"><span class="i-carbon-maximize" aria-hidden="true" /></span>
          </button>
        </div>
      </template>
    </main>
    <footer class="gallery-footer">
      <span class="footer-mark" aria-hidden="true">k.</span><NuxtLink to="/admin" class="admin-link" aria-label="Manage photos">
        <span class="i-carbon-settings" aria-hidden="true" />
      </NuxtLink>
    </footer>
    <PhotoLightbox ref="lightbox" :photos="gallery.photos" @change="lightboxOpen = $event" />
  </div>
</template>

<style scoped>
.gallery-shell {
  max-width: 1920px;
  margin: auto;
  padding: 0 24px;
}
.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 94px;
  padding: 0 10px;
}
.wordmark {
  margin: 0;
  font-weight: 400;
  font-size: 2.75rem;
}
.wordmark-dot {
  color: #a9c2a9;
}
.gallery-paw {
  width: 22px;
  height: 22px;
  color: #a9b7aa;
  transform: rotate(-14deg);
}
.opening-grid {
  display: grid;
  grid-template-columns: 2.1fr 1fr;
  gap: 12px;
  height: clamp(480px, 75vh, 900px);
}
.opening-grid.hero-only {
  grid-template-columns: 1fr;
}
.hero-wrap {
  position: relative;
  min-height: 0;
}
.photo-tile {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  overflow: hidden;
  border-radius: 5px;
  background: #29352e;
  cursor: zoom-in;
  isolation: isolate;
}
.photo-tile img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.7s cubic-bezier(0.2, 0.65, 0.3, 1);
}
.photo-tile:hover img {
  transform: scale(1.035);
}
.hero-tile img {
  position: absolute;
  inset: 0;
}
.side-photos {
  display: grid;
  grid-auto-rows: minmax(0, 1fr);
  gap: 12px;
}
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-flow: dense;
  grid-auto-rows: clamp(230px, 29vw, 520px);
  gap: 12px;
  margin-top: 12px;
}
.photo-grid.only-favorites {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.grid-tile.is-featured {
  grid-column: span 2;
  grid-row: span 2;
}
.enlarge-indicator {
  position: absolute;
  bottom: 18px;
  right: 18px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #10161099;
  color: white;
  display: grid;
  place-items: center;
  opacity: 0;
  transform: translateY(6px);
  transition: 0.2s;
}
.photo-tile:hover .enlarge-indicator,
.photo-tile:focus-visible .enlarge-indicator {
  opacity: 1;
  transform: translateY(0);
}
.cycle-controls {
  position: absolute;
  bottom: 18px;
  left: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 4px 4px 16px;
  border-radius: 30px;
  background: #101610b3;
  color: white;
}
.cycle-controls .icon-button {
  width: 36px;
  height: 36px;
  border-color: #ffffff50;
}
.cycle-count {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.1em;
}
.cycle-count span {
  color: #d0d7cf;
  margin-left: 5px;
}
.gallery-footer {
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #a1aea4;
}
.footer-mark {
  font:
    1.5rem 'DM Serif',
    Georgia,
    serif;
}
.admin-link {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  text-decoration: none;
}
.admin-link:hover {
  background: #ffffff0d;
  color: #eef0e9;
}
.gallery-loading,
.gallery-empty {
  min-height: 65vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #b6c2b7;
  gap: 20px;
}
.gallery-empty > span {
  width: 34px;
  height: 34px;
}
.gallery-empty p {
  margin: 0;
  font-size: 0.9375rem;
}
.retry-button {
  padding: 10px 18px;
  border: 1px solid #718d78;
  border-radius: 24px;
  background: transparent;
}
.photo-fade-enter-active,
.photo-fade-leave-active {
  transition: opacity 0.7s ease;
}
.photo-fade-enter-from,
.photo-fade-leave-to {
  opacity: 0;
}
@media (max-width: 760px) {
  .gallery-shell {
    padding: 0 10px;
  }
  .gallery-header {
    height: 76px;
    padding: 0 8px;
  }
  .wordmark {
    font-size: 2.25rem;
  }
  .opening-grid {
    grid-template-columns: 1fr;
    height: auto;
    gap: 8px;
  }
  .hero-wrap {
    height: 68svh;
    min-height: 380px;
    max-height: 760px;
  }
  .side-photos {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    height: 31vw;
    min-height: 150px;
    gap: 8px;
  }
  .photo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: 46vw;
    gap: 8px;
    margin-top: 8px;
  }
  .grid-tile.is-featured {
    grid-column: span 2;
    grid-row: span 2;
  }
  .gallery-footer {
    height: 76px;
    padding: 0 8px;
  }
  .enlarge-indicator {
    width: 30px;
    height: 30px;
    bottom: 12px;
    right: 12px;
  }
}
</style>
