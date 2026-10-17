import { create } from 'zustand'

/**
 * Photos for Danya to look at: a camera shot, a picture from the library, or a
 * screenshot. iOS only opens the picker from a real tap, so a spoken "what am
 * I looking at?" sets a pending question and lights up the camera button; the
 * tap that follows opens the picker and the question goes with the photo.
 */

export const PHOTO_EVENT = 'danya-photo'
export type Photo = { base64: string; dataUrl: string; question: string }

export const useLook = create<{ pending: string | null }>(() => ({ pending: null }))

const DEFAULT_QUESTION =
  'What is in this photo? Describe what matters, read any text in it, and explain anything important.'

/** "What am I looking at?", "read this", "can you see this"… */
export function isLookRequest(said: string): boolean {
  return /\b(what am i looking at|look at (this|that)|what('s| is) (this|that)\b(?!\s+(?:called|song|mean))|read (this|that)|can you see (this|that|it)|scan (this|that)|identify (this|that)|what does (this|that) say|take a (photo|picture)|check this (photo|picture|screenshot))\b/i.test(
    said,
  )
}

/** Shrink to at most 1280px and re-encode as JPEG: fast to send, enough to read text. */
async function toJpeg(file: File): Promise<{ base64: string; dataUrl: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return { base64: dataUrl.split(',')[1], dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Opens the photo picker. Must be called from inside a tap. */
export function pickPhoto(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const { base64, dataUrl } = await toJpeg(file)
      const question = useLook.getState().pending ?? DEFAULT_QUESTION
      useLook.setState({ pending: null })
      window.dispatchEvent(new CustomEvent<Photo>(PHOTO_EVENT, { detail: { base64, dataUrl, question } }))
    } catch {
      /* an image the browser cannot decode: nothing to send */
    }
  }
  input.click()
}
