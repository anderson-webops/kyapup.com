<script setup lang="ts">
import type { Gallery, GallerySettings, Photo } from '~/types/gallery'

useHead({ title: 'Kya · Photos', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
const authenticated = ref(false)
const checking = ref(true)
const password = ref('')
const csrfToken = ref('')
const photos = ref<Photo[]>([])
const settings = ref<GallerySettings>({ mode: 'static', intervalSeconds: 8, heroPhotoId: null })
const filter = ref<'visible' | 'archive' | 'all'>('visible')
const busy = ref(false)
const uploading = ref(false)
const uploadProgress = ref('')
const error = ref('')
const message = ref('')
const dragging = ref(false)
const fileInput = useTemplateRef('fileInput')
const lightbox = useTemplateRef('lightbox')
const selected = ref<string[]>([])
const details = ref<Photo | null>(null)
const description = ref('')
const detailsDialog = useTemplateRef('detailsDialog')
const visiblePhotos = computed(() => photos.value.filter(photo => photo.visible))
const favorites = computed(() => photos.value.filter(photo => photo.featured && photo.visible))
const shownPhotos = computed(() => photos.value.filter(photo => filter.value === 'all' || (filter.value === 'visible' ? photo.visible : !photo.visible)))
const archiveCount = computed(() => photos.value.length - visiblePhotos.value.length)
const currentCover = computed(() => favorites.value.find(photo => photo.id === settings.value.heroPhotoId) || favorites.value[0])

function errorMessage(cause: unknown) {
  const failure = cause as { status?: number, statusCode?: number, data?: { error?: string } }
  const code = failure.data?.error || ''
  const explanations: Record<string, string> = {
    incorrect_password: 'That password doesn’t look right. Please try again.',
    invalid_password: 'Please enter your password.',
    too_many_login_attempts: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
    unsupported_photo_type: 'This photo format isn’t supported. Choose a JPG, PNG, WebP or AVIF photo.',
    invalid_photo: 'This photo couldn’t be opened. Try choosing it again or use a JPG copy.',
    unsupported_photo_dimensions: 'This photo is too large. Choose one up to 60 megapixels.',
    request_too_large: 'This photo is larger than 25 MB. Choose a smaller copy.',
    upload_busy: 'Another photo is still being added. Please try again in a moment.',
    too_many_requests: 'Please give the site a minute, then try again.',
    admin_not_configured: 'Photo management isn’t ready yet. Ask Jacob to finish the setup.',
    gallery_unavailable: 'Your photos are temporarily unavailable. Please try again in a moment.',
    origin_not_allowed: 'Sign-in isn’t set up for this address yet. Please let Jacob know.',
    invalid_csrf_token: 'Please refresh this page and sign in again. Your photos are saved.',
  }
  if (explanations[code])
    return explanations[code]
  if ((failure.statusCode || failure.status) === 401) {
    authenticated.value = false
    return 'Please sign in again. Your photos are saved.'
  }
  return 'That didn’t save. Please try again.'
}
async function request<T>(path: string, body?: object | File, method: 'POST' | 'PATCH' = 'POST') {
  return $fetch<T>(path, {
    method,
    body,
    headers: {
      'X-CSRF-Token': csrfToken.value,
      ...(body instanceof File ? { 'Content-Type': 'application/octet-stream' } : {}),
    },
  })
}
async function loadLibrary() {
  const library = await $fetch<Gallery>('/api/admin/library')
  photos.value = library.photos
  settings.value = library.settings
}
async function login() {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const session = await $fetch<{ authenticated: boolean, csrfToken: string }>('/api/admin/login', { method: 'POST', body: { password: password.value } })
    authenticated.value = session.authenticated
    csrfToken.value = session.csrfToken
    password.value = ''
    await loadLibrary()
  }
  catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function logout() {
  busy.value = true
  try {
    await request('/api/admin/logout')
    authenticated.value = false
    csrfToken.value = ''
    photos.value = []
  }
  catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function updatePhoto(photo: Photo, change: Partial<Photo>) {
  const updated = await request<Photo>(`/api/admin/photos/${photo.id}`, change, 'PATCH')
  photos.value = photos.value.map(item => item.id === updated.id ? updated : item)
  if ((!updated.visible || !updated.featured) && settings.value.heroPhotoId === updated.id)
    settings.value.heroPhotoId = null
}
async function changePhoto(photo: Photo, change: Partial<Photo>, feedback: string) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await updatePhoto(photo, change)
    message.value = feedback
  }
  catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function saveSettings(change: Partial<GallerySettings>) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    settings.value = await request<GallerySettings>('/api/admin/settings', change, 'PATCH')
    message.value = 'Spotlight saved.'
  }
  catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
async function upload(files: FileList | File[] | null) {
  if (!files?.length || uploading.value)
    return
  uploading.value = true
  error.value = ''
  message.value = ''
  const failures: string[] = []
  let added = 0
  filter.value = 'archive'
  selected.value = []
  for (const [index, file] of Array.from(files).entries()) {
    uploadProgress.value = `Adding photo ${index + 1} of ${files.length}…`
    if (file.size > 25 * 1024 * 1024) {
      failures.push(`${file.name}: larger than 25 MB.`)
      continue
    }
    try {
      const photo = await request<Photo>('/api/admin/photos', file)
      photos.value.push(photo)
      selected.value.push(photo.id)
      added++
    }
    catch (cause) { failures.push(`${file.name}: ${errorMessage(cause)}`) }
    if (!authenticated.value)
      break
  }
  uploading.value = false
  uploadProgress.value = ''
  message.value = added ? `${added} ${added === 1 ? 'photo added' : 'photos added'}. Choose “Show selected” to put ${added === 1 ? 'it' : 'them'} on the site.` : ''
  error.value = failures.join(' ')
  if (fileInput.value)
    fileInput.value.value = ''
}
function dropped(event: DragEvent) {
  dragging.value = false
  void upload(event.dataTransfer?.files || null)
}
async function bulkVisibility(visible: boolean) {
  busy.value = true
  error.value = ''
  message.value = ''
  let changed = 0
  try {
    for (const id of selected.value) {
      const photo = photos.value.find(item => item.id === id)
      if (photo) {
        await updatePhoto(photo, { visible })
        changed++
      }
    }
    selected.value = []
    message.value = visible ? `${changed} photos are on the site.` : `${changed} photos saved for later.`
  }
  catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
function openDetails(photo: Photo) {
  details.value = photo
  description.value = photo.alt
  detailsDialog.value?.showModal()
}
async function saveDescription() {
  if (!details.value)
    return
  await changePhoto(details.value, { alt: description.value }, 'Description saved.')
  if (!error.value)
    detailsDialog.value?.close()
}
watch(filter, () => {
  selected.value = []
})
watch(shownPhotos, (current) => {
  const ids = new Set(current.map(photo => photo.id))
  selected.value = selected.value.filter(id => ids.has(id))
})
onMounted(async () => {
  try {
    const session = await $fetch<{ authenticated: boolean, csrfToken?: string }>('/api/admin/session')
    authenticated.value = session.authenticated
    csrfToken.value = session.csrfToken || ''
    if (session.authenticated)
      await loadLibrary()
  }
  catch (cause) { error.value = errorMessage(cause) }
  finally { checking.value = false }
})
onBeforeRouteLeave(() => {
  if (!uploading.value)
    return true
  error.value = 'Please wait for your photos to finish uploading before leaving.'
  return false
})
useEventListener('beforeunload', (event) => {
  if (uploading.value)
    event.preventDefault()
})
</script>

<template>
  <div class="admin-shell">
    <header class="admin-header">
      <NuxtLink to="/" class="wordmark" aria-label="Kya gallery">
        kya.
      </NuxtLink>
      <div class="header-actions">
        <NuxtLink to="/" class="view-site">
          View site <span class="i-carbon-arrow-up-right" aria-hidden="true" />
        </NuxtLink><button v-if="authenticated" class="quiet-button" :disabled="busy || uploading" @click="logout">
          Sign out
        </button>
      </div>
    </header>
    <main v-if="checking" class="sign-in" aria-label="Loading">
      <p role="status">
        One moment…
      </p>
    </main>
    <main v-else-if="!authenticated" class="sign-in">
      <div class="sign-in-mark">
        <span class="i-carbon-favorite" aria-hidden="true" />
      </div>
      <h1>A little more Kya.</h1><p>Sign in to add your photos.</p>
      <form @submit.prevent="login">
        <label for="password">Password</label><input id="password" v-model="password" type="password" autocomplete="current-password" required autofocus><button class="primary-button" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}<span class="i-carbon-arrow-right" aria-hidden="true" />
        </button>
      </form>
      <p v-if="error" class="error-message" role="alert">
        {{ error }}
      </p>
    </main>
    <main v-else class="admin-main">
      <div class="page-heading">
        <div>
          <p class="eyebrow">
            KYA’S LITTLE PHOTO ALBUM
          </p><h1>Your photos</h1><p class="muted">
            Keep the moments. Pick your favorites.
          </p>
        </div><button class="primary-button" :disabled="uploading || busy" @click="fileInput?.click()">
          <span class="i-carbon-add" aria-hidden="true" />Add photos
        </button>
      </div>
      <input ref="fileInput" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple aria-label="Choose photos to upload" :disabled="uploading" @change="upload(($event.target as HTMLInputElement).files)">
      <section v-if="photos.length" class="spotlight" aria-labelledby="spotlight-heading">
        <div class="spotlight-title">
          <span class="i-carbon-star-filled" aria-hidden="true" /><div>
            <h2 id="spotlight-heading">
              In the spotlight
            </h2><p class="muted">
              Star your favorites to make them bigger.
            </p>
          </div>
        </div>
        <div class="spotlight-options">
          <div class="segmented" role="group" aria-label="Spotlight mode">
            <button :aria-pressed="settings.mode === 'static'" :disabled="busy" @click="saveSettings({ mode: 'static' })">
              One favorite
            </button><button :aria-pressed="settings.mode === 'cycle'" :disabled="busy" @click="saveSettings({ mode: 'cycle' })">
              Rotate favorites
            </button>
          </div>
          <label v-if="settings.mode === 'cycle'" class="timer-label">Change every <select :value="settings.intervalSeconds" :disabled="busy" @change="saveSettings({ intervalSeconds: Number(($event.target as HTMLSelectElement).value) })"><option :value="5">5 seconds</option><option :value="8">8 seconds</option><option :value="15">15 seconds</option><option :value="30">30 seconds</option><option :value="60">1 minute</option><option v-if="![5, 8, 15, 30, 60].includes(settings.intervalSeconds)" :value="settings.intervalSeconds">{{ settings.intervalSeconds }} seconds</option></select></label>
        </div>
        <div v-if="favorites.length" class="cover-picker">
          <span class="muted">{{ settings.mode === 'static' ? 'At the top' : 'Start with' }}</span><div class="cover-options" role="group" aria-label="Choose the first favorite">
            <button v-for="(photo, index) in favorites" :key="photo.id" :aria-label="`Use favorite ${index + 1} at the top`" :aria-pressed="currentCover?.id === photo.id" :disabled="busy" @click="saveSettings({ heroPhotoId: photo.id })">
              <img :src="photo.thumbnailUrl" :alt="photo.alt || `Favorite ${index + 1}`"><span v-if="currentCover?.id === photo.id" class="cover-check"><span class="i-carbon-checkmark" aria-hidden="true" /></span>
            </button>
          </div>
        </div>
        <p v-else class="spotlight-hint">
          Tap a photo’s star below to choose your first favorite.
        </p>
      </section>
      <div class="feedback" aria-live="polite">
        <p v-if="message" class="success-message">
          <span class="i-carbon-checkmark" aria-hidden="true" />{{ message }}
        </p><p v-else-if="!uploading && !error" class="muted autosave">
          Changes save automatically.
        </p>
      </div>
      <p v-if="error" class="error-message" role="alert">
        {{ error }}
      </p>
      <div class="library-toolbar">
        <div class="filter-tabs" role="group" aria-label="Photo collection">
          <button :aria-pressed="filter === 'visible'" :disabled="uploading || busy" @click="filter = 'visible'">
            On the site <span>{{ visiblePhotos.length }}</span>
          </button><button :aria-pressed="filter === 'archive'" :disabled="uploading || busy" @click="filter = 'archive'">
            Saved for later <span>{{ archiveCount }}</span>
          </button><button :aria-pressed="filter === 'all'" :disabled="uploading || busy" @click="filter = 'all'">
            All <span>{{ photos.length }}</span>
          </button>
        </div><button v-if="shownPhotos.length" class="quiet-button select-all" :disabled="uploading || busy" @click="selected = selected.length === shownPhotos.length ? [] : shownPhotos.map(photo => photo.id)">
          {{ selected.length === shownPhotos.length ? 'Clear selection' : 'Select all' }}
        </button>
      </div>
      <div v-if="selected.length" class="selection-bar">
        <span>{{ selected.length }} selected</span><div>
          <button class="small-button" :disabled="busy || uploading" @click="bulkVisibility(true)">
            Show selected
          </button><button class="quiet-button" :disabled="busy || uploading" @click="bulkVisibility(false)">
            Save for later
          </button><button class="quiet-button" aria-label="Clear selection" :disabled="uploading || busy" @click="selected = []">
            <span class="i-carbon-close" aria-hidden="true" />
          </button>
        </div>
      </div>
      <section class="photo-library" :class="{ dragging }" aria-label="Photo library" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dropped">
        <div v-if="uploading" class="upload-progress" role="status">
          <span class="i-carbon-cloud-upload" aria-hidden="true" />{{ uploadProgress }}<span class="muted">Keep this page open.</span>
        </div>
        <div v-if="!shownPhotos.length && !uploading" class="empty-library">
          <span class="i-carbon-image" aria-hidden="true" /><h2>{{ photos.length ? (filter === 'visible' ? 'Ready for a little Kya?' : 'Room for more memories.') : 'Her first photo goes here.' }}</h2><p>{{ photos.length && filter === 'visible' ? 'Pick photos from Saved for later, or add a few new ones.' : 'Add a few photos or a whole camera roll.' }}</p><button v-if="photos.length && filter === 'visible' && archiveCount" class="primary-button" @click="filter = 'archive'">
            Choose saved photos
          </button><button v-else class="primary-button" @click="fileInput?.click()">
            Add photos
          </button><span class="file-hint">JPG, PNG, WebP or AVIF · Up to 25 MB each</span>
        </div>
        <div v-else class="admin-grid">
          <article v-for="(photo, index) in shownPhotos" :key="photo.id" class="photo-card" :class="{ selected: selected.includes(photo.id) }">
            <div class="card-image">
              <button class="card-preview" :aria-label="`Enlarge ${photo.alt || `photo ${index + 1}`}`" @click="lightbox?.open(photo.id)">
                <img :src="photo.thumbnailUrl" :alt="photo.alt || 'Kya'" :width="photo.width" :height="photo.height" loading="lazy">
              </button><label class="photo-select"><input v-model="selected" type="checkbox" :disabled="uploading || busy" :value="photo.id" :aria-label="`Select photo ${index + 1}`"></label><button class="favorite-button" :class="{ starred: photo.featured }" :aria-label="photo.featured ? 'Remove from favorites' : 'Show on site and make a favorite'" :aria-pressed="photo.featured" :disabled="busy || uploading" @click="changePhoto(photo, { featured: !photo.featured, ...(!photo.featured ? { visible: true } : {}) }, photo.featured ? 'Removed from favorites.' : 'Added to favorites and shown on the site.')">
                <span :class="photo.featured ? 'i-carbon-star-filled' : 'i-carbon-star'" aria-hidden="true" />
              </button>
            </div>
            <div class="card-actions">
              <button class="visibility-button" :class="{ published: photo.visible }" :disabled="busy || uploading" @click="changePhoto(photo, { visible: !photo.visible }, photo.visible ? 'Saved for later.' : 'Shown on the site.')">
                <span :class="photo.visible ? 'i-carbon-checkmark' : 'i-carbon-add'" aria-hidden="true" />{{ photo.visible ? 'On site · Hide' : 'Show on site' }}
              </button><button class="details-button" aria-label="Photo description" @click="openDetails(photo)">
                <span class="i-carbon-edit" aria-hidden="true" />
              </button>
            </div>
          </article>
        </div>
      </section>
      <p v-if="photos.length" class="library-note">
        Saved photos stay here until you want to show them. Nothing gets deleted.
      </p>
    </main>
    <PhotoLightbox ref="lightbox" :photos="photos" />
    <dialog ref="detailsDialog" class="details-dialog" aria-labelledby="details-heading">
      <form @submit.prevent="saveDescription">
        <h2 id="details-heading">
          A few words about this photo
        </h2><p class="muted">
          Optional. Helps people who use a screen reader.
        </p><label for="photo-description">Photo description</label><input id="photo-description" v-model="description" maxlength="300" placeholder="Kya snoozing in the sunshine"><div class="dialog-actions">
          <button type="button" class="quiet-button" @click="detailsDialog?.close()">
            Cancel
          </button><button class="primary-button" :disabled="busy">
            Save
          </button>
        </div><p v-if="error" class="error-message" role="alert">
          {{ error }}
        </p>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  color: #23382d;
  background: #f5f6f2;
  color-scheme: light;
}
.admin-header {
  max-width: 1440px;
  margin: auto;
  height: 96px;
  padding: 0 5%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #dce2d9;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 24px;
}
.view-site {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  font-size: 0.875rem;
}
.admin-main {
  max-width: 1440px;
  margin: auto;
  padding: 48px 5% 64px;
}
h1,
h2,
p {
  margin: 0;
}
h1 {
  font-family: 'DM Serif', Georgia, serif;
  font-weight: 400;
  font-size: clamp(2.25rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}
h2 {
  font-weight: 600;
  font-size: 1.125rem;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 36px;
}
.eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.13em;
  font-weight: 600;
  margin-bottom: 12px;
  color: #586b5c;
}
.muted {
  color: #5d6c62;
  font-size: 0.875rem;
  line-height: 1.6;
}
.page-heading .muted {
  font-size: 1rem;
  margin-top: 8px;
}
.primary-button,
.small-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #244f38;
  color: white;
  border: 1px solid #244f38;
  border-radius: 8px;
  padding: 13px 20px;
  font-weight: 500;
  font-size: 0.9375rem;
  white-space: nowrap;
}
.primary-button:hover,
.small-button:hover {
  background: #183e29;
}
.quiet-button {
  border: 0;
  background: transparent;
  padding: 10px;
  color: #3e5546;
  font-size: 0.875rem;
}
.quiet-button:hover {
  text-decoration: underline;
}
.spotlight {
  border: 1px solid #dce3d8;
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.spotlight-title {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
}
.spotlight-title > span {
  flex-shrink: 0;
  color: #8c6e28;
  width: 24px;
  height: 24px;
}
.spotlight-title .muted {
  margin-top: 4px;
}
.spotlight-options {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.segmented {
  display: flex;
  padding: 4px;
  border: 1px solid #dce3d8;
  border-radius: 8px;
  background: #f5f6f2;
}
.segmented button {
  color: #536758;
  background: transparent;
  border: 0;
  border-radius: 5px;
  font-size: 0.875rem;
  padding: 10px 14px;
}
.segmented button[aria-pressed='true'] {
  background: #244f38;
  color: white;
}
.timer-label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.875rem;
}
select {
  border: 1px solid #ccd5c9;
  border-radius: 6px;
  background: white;
  padding: 8px;
  max-width: 100%;
}
.cover-picker {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  border-top: 1px solid #e8ece4;
  padding-top: 20px;
}
.cover-picker > span {
  white-space: nowrap;
}
.cover-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.cover-options button {
  position: relative;
  width: 62px;
  height: 62px;
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: transparent;
}
.cover-options button[aria-pressed='true'] {
  border-color: #244f38;
}
.cover-options img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.cover-check {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  background: #244f38;
  color: white;
  border: 2px solid white;
  border-radius: 50%;
}
.spotlight-hint {
  width: 100%;
  font-size: 0.875rem;
  color: #5d6c62;
}
.feedback {
  min-height: 48px;
  padding: 14px 0;
}
.success-message {
  color: #244f38;
  font-size: 0.875rem;
  display: flex;
  gap: 8px;
  align-items: center;
}
.success-message > span {
  flex-shrink: 0;
}
.autosave {
  text-align: right;
  font-size: 0.8125rem;
}
.error-message {
  background: #fff0eb;
  border: 1px solid #d7a08d;
  color: #8a321c;
  padding: 14px;
  border-radius: 8px;
  font-size: 0.9375rem;
  line-height: 1.6;
  margin-bottom: 20px;
  overflow-wrap: anywhere;
}
.library-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #dce2d9;
  margin-bottom: 24px;
}
.filter-tabs {
  display: flex;
  gap: 24px;
}
.filter-tabs button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #657267;
  font-size: 0.9375rem;
  white-space: nowrap;
}
.filter-tabs button[aria-pressed='true'] {
  border-bottom-color: #244f38;
  color: #244f38;
  font-weight: 600;
}
.filter-tabs button span {
  padding: 2px 7px;
  background: #e7ebe3;
  border-radius: 5px;
  font-size: 0.75rem;
}
.selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #e6ede3;
  border-radius: 8px;
  padding: 10px 16px;
  margin-bottom: 20px;
  font-size: 0.875rem;
}
.selection-bar > div {
  display: flex;
  gap: 8px;
  align-items: center;
}
.small-button {
  font-size: 0.875rem;
  padding: 8px 12px;
}
.photo-library {
  min-height: 200px;
  border-radius: 12px;
  outline: 2px dashed transparent;
  outline-offset: 10px;
}
.photo-library.dragging {
  outline-color: #244f38;
  background: #eaf1e7;
}
.admin-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 22px;
}
.photo-card {
  background: #fff;
  border: 1px solid #dce2d9;
  border-radius: 10px;
  overflow: hidden;
}
.photo-card.selected {
  outline: 2px solid #527f5d;
  outline-offset: 2px;
}
.card-image {
  aspect-ratio: 1;
  position: relative;
}
.card-preview {
  padding: 0;
  border: 0;
  width: 100%;
  height: 100%;
  background: #e1e5dc;
  display: block;
  cursor: zoom-in;
}
.card-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-select {
  position: absolute;
  top: 8px;
  left: 8px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
}
.photo-select input {
  width: 21px;
  height: 21px;
  accent-color: #244f38;
  cursor: pointer;
}
.favorite-button {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #ffffffec;
  color: #344839;
  border: 0;
}
.favorite-button.starred {
  background: #fbefc9;
  color: #78581c;
}
.card-actions {
  padding: 9px 8px 9px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.visibility-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 5px;
  color: #3b5140;
  background: #edf1e8;
  font-size: 0.8125rem;
  font-weight: 500;
  padding: 9px 10px;
}
.visibility-button.published {
  background: transparent;
  color: #355c3e;
}
.details-button {
  width: 34px;
  height: 36px;
  padding: 0;
  display: grid;
  place-items: center;
  background: transparent;
  color: #607260;
  border: 0;
  border-radius: 5px;
}
.empty-library {
  padding: 64px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  border: 1px dashed #b7c6b3;
  border-radius: 12px;
}
.empty-library > span:first-child {
  width: 32px;
  height: 32px;
  color: #72896c;
}
.empty-library h2 {
  font-family: 'DM Serif', Georgia, serif;
  font-size: 1.75rem;
  font-weight: 400;
}
.empty-library p {
  color: #5d6c62;
  font-size: 0.9375rem;
}
.file-hint {
  font-size: 0.75rem;
  color: #657366;
  margin-top: 4px;
}
.library-note {
  color: #5d6c62;
  font-size: 0.8125rem;
  margin-top: 28px;
  text-align: center;
}
.upload-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  border: 1px solid #b5c9ac;
  background: #ecf3e8;
  border-radius: 10px;
  margin-bottom: 24px;
}
.sign-in {
  width: min(400px, calc(100% - 40px));
  margin: 12vh auto;
}
.sign-in-mark {
  background: #e5ecdf;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #4d7045;
  font-size: 24px;
  margin-bottom: 26px;
}
.sign-in h1 {
  font-size: 2.5rem;
}
.sign-in > p {
  color: #5d6c62;
  margin-top: 12px;
}
.sign-in form {
  display: flex;
  flex-direction: column;
  margin: 32px 0 20px;
  gap: 10px;
}
input[type='password'],
input[type='text'],
.details-dialog input {
  border: 1px solid #b9c7b6;
  border-radius: 7px;
  background: white;
  color: #23382d;
  padding: 13px 14px;
  width: 100%;
}
.sign-in form .primary-button {
  justify-content: space-between;
  margin-top: 10px;
}
.sign-in label,
.details-dialog label {
  font-size: 0.875rem;
}
.details-dialog {
  width: min(480px, calc(100% - 32px));
  border: 1px solid #c7d3c1;
  border-radius: 14px;
  color: #23382d;
  background: #f5f6f2;
  padding: 28px;
}
.details-dialog::backdrop {
  background: #102015a6;
}
.details-dialog form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
@media (max-width: 1000px) {
  .admin-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .spotlight-options {
    width: 100%;
  }
}
@media (max-width: 650px) {
  .admin-header {
    height: 78px;
    padding: 0 20px;
  }
  .header-actions {
    gap: 8px;
  }
  .admin-main {
    padding: 30px 16px 48px;
  }
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 24px;
    margin-bottom: 28px;
  }
  .page-heading .primary-button {
    width: 100%;
  }
  .eyebrow {
    font-size: 0.6875rem;
  }
  .spotlight {
    padding: 18px;
    gap: 18px;
  }
  .segmented {
    width: 100%;
  }
  .segmented button {
    flex: 1;
    padding: 10px;
  }
  .cover-picker {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }
  .admin-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .card-actions {
    padding: 6px;
  }
  .visibility-button {
    font-size: 0.75rem;
    padding: 9px 5px;
  }
  .details-button {
    width: 28px;
  }
  .library-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 0;
  }
  .filter-tabs {
    gap: 18px;
    width: 100%;
  }
  .filter-tabs button {
    font-size: 0.8125rem;
    gap: 5px;
  }
  .filter-tabs button span {
    padding: 2px 5px;
  }
  .select-all {
    margin-left: auto;
  }
  .selection-bar {
    flex-direction: column;
    align-items: flex-start;
    padding: 12px;
  }
  .selection-bar > div {
    flex-wrap: wrap;
    gap: 0;
  }
  .empty-library {
    padding: 45px 16px;
  }
  .sign-in {
    margin-top: 10vh;
  }
}
</style>
