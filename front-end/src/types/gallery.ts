export interface Photo {
  id: string
  alt: string
  width: number
  height: number
  visible: boolean
  featured: boolean
  position: number
  createdAt: string
  thumbnailUrl: string
  url: string
}

export interface GallerySettings {
  mode: 'static' | 'cycle'
  intervalSeconds: number
  heroPhotoId: string | null
}

export interface Gallery {
  photos: Photo[]
  settings: GallerySettings
}
