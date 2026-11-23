import type { CustomizationField } from '@/types/catalog'

/** The server's own upload ceiling (backend UPLOAD_MAX_BYTES), used when the
 * product sets no smaller limit of its own. */
const SERVER_MAX_MB = 10

/**
 * What to tell the customer before they pick a file: the formats and size this
 * product accepts (from the product's own settings, never invented) and, for
 * photos, what makes a good one. Shown only until a file is chosen.
 */
export function uploadGuidance(
  type: CustomizationField['type'],
  constraints: { allowedFormats?: string[]; maxFileSizeMb?: number },
): string {
  const formats = (constraints.allowedFormats ?? [])
    .map((f) => (f.toLowerCase() === 'jpeg' ? 'JPG' : f.toUpperCase()))
    .filter((f, i, all) => all.indexOf(f) === i)
  const size = Math.min(constraints.maxFileSizeMb ?? SERVER_MAX_MB, SERVER_MAX_MB)
  const accepted = `${formats.length ? `${formats.join(', ')} · ` : ''}up to ${size} MB`
  return type === 'IMAGE_UPLOAD'
    ? `${accepted}. A clear, well-lit photo at least 1000 px wide works best. We check every photo before printing.`
    : `${accepted}.`
}
