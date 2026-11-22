import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(
  new URL('../../product-images/login-portrait-lamp.png', import.meta.url),
)
const output = fileURLToPath(
  new URL('../public/brand/ab-creations/login/', import.meta.url),
)
await mkdir(output, { recursive: true })
for (const width of [640, 960, 1440]) {
  // The generator's sparkle watermark sits in the bottom-right corner
  // (~y 2150-2275 of 2304). Crop it out; the lamp base ends near y=1820.
  const image = sharp(source)
    .extract({ left: 0, top: 0, width: 1856, height: 2060 })
    .resize({ width, withoutEnlargement: true })
  await image
    .clone()
    .avif({ quality: 58, effort: 5 })
    .toFile(`${output}/portrait-lamp-${width}.avif`)
  await image
    .clone()
    .webp({ quality: 82 })
    .toFile(`${output}/portrait-lamp-${width}.webp`)
}
