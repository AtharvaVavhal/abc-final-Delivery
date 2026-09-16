import { SITE_NAME } from './siteConfig.constants'

export const HOME_TITLE = 'Custom signage and prints'
export const HOME_DESCRIPTION =
  'AB Creations — custom corporate signage, LED letters, acrylic gifts, and made-to-order prints from Gwalior, India.'

export const ABOUT_DESCRIPTION =
  'AB Creations manufactures custom signage, 3D letters, acrylic gifts, and made-to-order prints in Gwalior, Madhya Pradesh. Design, approve, and order online.'

export const CONTACT_DESCRIPTION = (storeName: string) =>
  `Contact ${storeName} in Gwalior for custom signage, LED letters, acrylic gifts, and print orders.`

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'corporate-signage':
    'Corporate signage from AB Creations — reception boards, 3D letters, office name plates, and wayfinding made to order.',
  'led-signages':
    'LED signage from AB Creations — backlit letters, outdoor LED boards, and illuminated retail signs made to order.',
  'led-letters':
    'Custom LED letters from AB Creations — acrylic, channel, and 3D illuminated lettering for shops and offices.',
  'led-signage-board':
    'LED signage boards from AB Creations — indoor and outdoor illuminated boards built to your artwork.',
  'office-and-building-signage-board':
    'Office and building signage from AB Creations — name boards, directories, and exterior identification.',
  'retail-signages':
    'Retail signage from AB Creations — storefront boards, indoor displays, and brand lettering for shops.',
  'led-sign-board':
    'LED sign boards from AB Creations — custom illuminated boards for outdoor and indoor branding.',
  'signage-name-plates':
    'Name plates from AB Creations — acrylic, aluminium, and office door plates made to order.',
  'pylons-lolipop':
    'Pylon and lollipop signs from AB Creations — roadside and campus identification built to spec.',
  'acrylic-box-solid-letters':
    'Acrylic box and solid letters from AB Creations — dimensional lettering for reception and retail.',
  'solid-letters':
    'Solid letters from AB Creations — metal, acrylic, and 3D cut letters for indoor and outdoor branding.',
  'led-signages-logo':
    'LED logo signage from AB Creations — backlit brand marks and reception logos made to order.',
  'safety-signs':
    'Safety signs from AB Creations — statutory, warning, and workplace signage printed to spec.',
  'graphics-service':
    'Graphics and branding from AB Creations — vinyl, wall graphics, and custom print for interiors.',
  'sky-signages':
    'Sky signage from AB Creations — high-rise and outdoor elevated signs built for visibility.',
  'digital-standee':
    'Digital standees and acrylic stands from AB Creations — indoor display units made to order.',
  'glow-signs':
    'Glow signs and edge-lit boards from AB Creations — ACP and acrylic glow signage for storefronts.',
  'metal-labels':
    'Metal labels from AB Creations — durable branded plates and industrial identification.',
  'cladding-work':
    'ACP cladding and facade branding from AB Creations — outdoor elevation work with signage.',
  'uv-printing-services':
    'UV printing from AB Creations — high-resolution prints on acrylic, board, and rigid substrates.',
  'flex-branding-work':
    'Flex branding from AB Creations — outdoor flex boards and site branding printed to size.',
  'sign-board-poles':
    'Sign board poles from AB Creations — pole-mounted outdoor identification and wayfinding.',
  'acrylic-gifts':
    'Custom acrylic gifts from AB Creations — caricatures, cutouts, clocks, and photo prints made to order.',
  'personalized-gifts':
    'Personalised gifts from AB Creations — photo prints, plaques, and keepsakes made to order.',
  'home-and-decor':
    'Home décor prints from AB Creations — wall art, frames, and custom acrylic pieces for interiors.',
  'corporate-and-branding':
    'Corporate branding products from AB Creations — gifting, stationery, and brand-ready prints.',
  'car-and-auto':
    'Car and auto branding from AB Creations — vehicle graphics and automotive identification prints.',
}

export function categoryDescription(name: string, slug?: string): string {
  if (slug && CATEGORY_DESCRIPTIONS[slug]) return CATEGORY_DESCRIPTIONS[slug]
  return `Shop ${name} at ${SITE_NAME} — custom signage, letters, and printed products made to order in Gwalior, India.`
}

export function catalogDescription(): string {
  return `Browse the ${SITE_NAME} catalog — corporate signage, LED letters, acrylic gifts, and custom prints made to order.`
}
