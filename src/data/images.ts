/** Wallet images, as on the phone: a center-cropped 256×256 WebP, named by the sha256 of its content. */
const SIZE = 256
const QUALITY = 0.85

export interface PreparedImage {
  hash: string
  blob: Blob
  byteSize: number
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The largest centered square of a picture. */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height)
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side }
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file)
  const { x, y, side } = centerSquare(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot process images')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, x, y, side, side, 0, 0, SIZE, SIZE)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
  // A browser without a WebP encoder quietly returns another format, which must not reach the phone as .webp.
  if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot create WebP images')
  return { hash: await sha256Hex(await blob.arrayBuffer()), blob, byteSize: blob.size }
}
