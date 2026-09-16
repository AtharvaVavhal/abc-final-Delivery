import type { CategoryTreeNode } from '@/types/catalog'

/** Display order for known Identica + AB Creations groups. Unknown categories stay after, A–Z. */
const GROUP_SLUGS = [
  'corporate-signage',
  'led-signages',
  'led-letters',
  'led-signage-board',
  'office-and-building-signage-board',
  'retail-signages',
  'led-sign-board',
  'signage-name-plates',
  'pylons-lolipop',
  'acrylic-box-solid-letters',
  'solid-letters',
  'led-signages-logo',
  'safety-signs',
  'graphics-service',
  'sky-signages',
  'digital-standee',
  'glow-signs',
  'metal-labels',
  'cladding-work',
  'uv-printing-services',
  'flex-branding-work',
  'sign-board-poles',
  'acrylic-gifts',
  'personalized-gifts',
  'home-and-decor',
  'corporate-and-branding',
  'car-and-auto',
] as const

const CHILD_SLUGS: Record<string, readonly string[]> = {
  'acrylic-gifts': [
    'acrylic-photos',
    'acrylic-cutouts',
    'acrylic-caricatures',
    'acrylic-clocks',
    'acrylic-wall-art',
    'acrylic-standees',
    'acrylic-photo-frames',
  ],
  'personalized-gifts': [
    't-shirts',
    'mugs',
    'bottles',
    'diaries',
    'pens',
    'fridge-magnets',
    'key-car-photos',
    'illusion-lamps',
  ],
  'home-and-decor': ['divine-frames', 'name-plates', 'wall-art', 'clocks'],
  'corporate-and-branding': [
    'corporate-t-shirts',
    'badges',
    'corporate-pens',
    'corporate-bottles',
    'corporate-diaries',
    'trophies',
    'banner-printing',
    'vinyl-printing',
  ],
  'car-and-auto': ['dashboard-photos', 'car-hanging-photos'],
}

const CATEGORY_STILL_IMAGES: Record<string, string> = {
  'dashboard-photos': '/catalog/DASHBOARD-PHOTO.jpg',
  'car-hanging-photos': '/catalog/CAR-HANGING-PHOTO.jpg',
}

/** Storefront still used when a leaf has no product image yet. */
export function categoryStillImage(slug: string): string {
  return CATEGORY_STILL_IMAGES[slug] ?? ''
}

function byKnownOrder(nodes: CategoryTreeNode[], order: readonly string[]): CategoryTreeNode[] {
  const rank = new Map(order.map((slug, index) => [slug, index]))
  return [...nodes].sort((a, b) => {
    const aRank = rank.get(a.slug)
    const bRank = rank.get(b.slug)
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank
    if (aRank !== undefined) return -1
    if (bRank !== undefined) return 1
    return a.name.localeCompare(b.name)
  })
}

/** Applies the storefront merchandising order without hiding unknown categories. */
export function sortCategoryTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return byKnownOrder(nodes, GROUP_SLUGS).map((node) => ({
    ...node,
    children: byKnownOrder(node.children, CHILD_SLUGS[node.slug] ?? []),
  }))
}

/** Leaf categories for story/chip rows; a root with no children is itself a leaf. */
export function categoryLeaves(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  const leaves: CategoryTreeNode[] = []
  for (const node of sortCategoryTree(nodes)) {
    if (node.children.length === 0) {
      leaves.push(node)
    } else {
      leaves.push(...node.children)
    }
  }
  return leaves
}
