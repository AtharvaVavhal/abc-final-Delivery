#!/usr/bin/env node
/**
 * Builds AVIF/WebP/JPEG width variants from `public/catalog/hero-*.jpg`.
 * Does not replace the source JPEGs — those remain the originals.
 *
 * Output: public/catalog/optimized/hero-N-{width}.{avif,webp,jpg}
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const WIDTHS = [480, 768, 1024, 1280]
const here = dirname(fileURLToPath(import.meta.url))
const catalogDir = join(here, '../public/catalog')
const outDir = join(catalogDir, 'optimized')

mkdirSync(outDir, { recursive: true })

const sources = readdirSync(catalogDir).filter((name) =>
  /^hero-\d+\.jpe?g$/i.test(name),
)

if (sources.length === 0) {
  throw new Error(`No hero-*.jpg files in ${catalogDir}`)
}

for (const file of sources) {
  const input = join(catalogDir, file)
  const base = file.replace(/\.jpe?g$/i, '')
  const image = sharp(input)
  for (const width of WIDTHS) {
    const resized = image.clone().resize({
      width,
      withoutEnlargement: true,
    })
    const avif = join(outDir, `${base}-${width}.avif`)
    const webp = join(outDir, `${base}-${width}.webp`)
    const jpg = join(outDir, `${base}-${width}.jpg`)
    writeFileSync(
      avif,
      await resized.clone().avif({ quality: 48, effort: 4 }).toBuffer(),
    )
    writeFileSync(
      webp,
      await resized.clone().webp({ quality: 70, effort: 4 }).toBuffer(),
    )
    writeFileSync(
      jpg,
      await resized.clone().jpeg({ quality: 76, mozjpeg: true }).toBuffer(),
    )
    const avifKb = statSync(avif).size
    const webpKb = statSync(webp).size
    const jpgKb = statSync(jpg).size
    console.log(
      `${base}-${width}: avif ${(avifKb / 1024).toFixed(1)}kB  webp ${(webpKb / 1024).toFixed(1)}kB  jpg ${(jpgKb / 1024).toFixed(1)}kB`,
    )
  }
}
