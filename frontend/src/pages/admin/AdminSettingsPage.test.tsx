import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { AdminSettingsPage } from './AdminSettingsPage'

const SETTINGS_RESPONSE = {
  success: true,
  data: [
    {
      key: 'storeName',
      label: 'Store name',
      description: 'The name customers see for this store. Required.',
      kind: 'text',
      value: 'AB Creations',
      default: 'AB Creations',
    },
    {
      key: 'storeLogo',
      label: 'Store logo',
      description: 'Shown in the storefront navbar. Upload a PNG or JPEG.',
      kind: 'text',
      value: '/catalog/logo.png',
      default: '/catalog/logo.png',
    },
    {
      key: 'storeAdminName',
      label: 'Store admin name',
      description: 'Display name for the store owner / administrator. Optional.',
      kind: 'text',
      value: '',
      default: '',
    },
    {
      key: 'shippingFeeFlat',
      label: 'Flat shipping fee (₹)',
      description: 'Charged once per order at checkout.',
      kind: 'money',
      value: '0.00',
      default: '0.00',
    },
    {
      key: 'announcement_text',
      label: 'Announcement bar text',
      description: 'Leave blank to hide the bar.',
      kind: 'text',
      value: 'Free shipping this week',
      default: '',
    },
    {
      key: 'hero_slides',
      label: 'Homepage hero slides',
      description: 'Add, replace, or delete homepage banner slides.',
      kind: 'text',
      value: JSON.stringify([
        {
          imageUrl: '/catalog/hero-3.jpg',
          headline: 'Acrylic caricatures',
          subtext: 'Made to order',
          ctaText: 'Shop acrylic',
          ctaLink: '/products?category=acrylic-gifts',
        },
      ]),
      default: '',
    },
    {
      key: 'storeAddress',
      label: 'Store address',
      description: 'Public studio/office address.',
      kind: 'text',
      value: '',
      default: '',
    },
    {
      key: 'sellerLegalName',
      label: 'Navbar seller name',
      description: 'Registered business name on the storefront navbar.',
      kind: 'text',
      value: 'Identica',
      default: 'Identica',
    },
    {
      key: 'sellerLocality',
      label: 'Navbar seller locality',
      description: 'City / locality shown on the navbar.',
      kind: 'text',
      value: 'Golden City, Magistrate Lane, Maharajpura, Gwalior, MP, India',
      default: 'Golden City, Magistrate Lane, Maharajpura, Gwalior, MP, India',
    },
    {
      key: 'sellerGstin',
      label: 'Navbar GSTIN',
      description: 'GST identification number shown on the navbar.',
      kind: 'text',
      value: '27ARLPM5978P1ZL',
      default: '27ARLPM5978P1ZL',
    },
    {
      key: 'sellerPaymentProtected',
      label: 'Show Payment Protected',
      description: 'When true, the navbar shows a Payment Protected mark.',
      kind: 'boolean',
      value: 'true',
      default: 'true',
    },
    {
      key: 'tax.enabled',
      label: 'GST / tax enabled',
      description: 'When off, every order records tax = ₹0.00.',
      kind: 'boolean',
      value: 'false',
      default: 'false',
    },
    {
      key: 'tax.pricingMode',
      label: 'Tax pricing mode',
      description: 'INCLUSIVE per the blueprint. EXCLUSIVE is locked pending client confirmation.',
      kind: 'enum',
      value: 'INCLUSIVE',
      default: 'INCLUSIVE',
      options: ['INCLUSIVE'],
    },
    {
      key: 'tax.ratePercent',
      label: 'Combined GST rate (%)',
      description: 'PENDING CLIENT CONFIRMATION — do not set a guessed value.',
      kind: 'percent',
      value: '',
      default: '0.00',
      pendingClientInput: true,
    },
    {
      key: 'invoice.numberPrefix',
      label: 'Invoice number prefix',
      description: 'Prepended to the invoice sequence.',
      kind: 'text',
      value: 'INV-',
      default: 'INV-',
      pendingClientInput: true,
    },
    {
      key: 'invoice.sellerGstin',
      label: 'Seller GSTIN (on invoice)',
      description: 'The business GST identification number.',
      kind: 'text',
      value: '',
      default: '',
      pendingClientInput: true,
    },
  ],
}

describe('AdminSettingsPage', () => {
  let mock: MockAdapter
  let adminSettingsReply: () => [number, unknown] | Promise<[number, unknown]>

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    adminSettingsReply = () => [200, SETTINGS_RESPONSE]
    mock.onGet('/admin/settings').reply(() => adminSettingsReply())
    mock.onGet('/admin/payment-accounts').reply(200, {
      success: true,
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    })
  })

  afterEach(() => {
    mock.restore()
  })

  // ─── Preserved behaviour ───────────────────────────────────────────────

  it('renders a form per configurable setting', async () => {
    renderWithProviders(<AdminSettingsPage />)

    expect(await screen.findByLabelText('Flat shipping fee (₹)')).toBeInTheDocument()
    expect(screen.getByLabelText('Announcement bar text')).toBeInTheDocument()
    const saveable = SETTINGS_RESPONSE.data.filter(
      (s) =>
        s.key !== 'storeLogo' &&
        s.key !== 'hero_slides' &&
        s.key !== 'sellerLegalName' &&
        s.key !== 'sellerLocality' &&
        s.key !== 'sellerGstin' &&
        s.key !== 'sellerPaymentProtected',
    )
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(saveable.length)
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save slides' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save navbar strip' })).toBeInTheDocument()
  })

  it('disables Save until the value is changed', async () => {
    renderWithProviders(<AdminSettingsPage />)

    await screen.findByLabelText('Flat shipping fee (₹)')
    screen.getAllByRole('button', { name: 'Save' }).forEach((b) => expect(b).toBeDisabled())
  })

  it('shows an inline validation error and does not call the API for a negative fee', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Flat shipping fee (₹)')
    await user.clear(field)
    await user.type(field, '-5')
    await user.click(within(field.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/non-negative amount/i)).toBeInTheDocument()
    expect(mock.history.patch).toHaveLength(0)
  })

  it('PATCHes a valid fee and only then shows a real "Saved" confirmation', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/shippingFeeFlat').reply(200, {
      success: true,
      data: { ...SETTINGS_RESPONSE.data[0], value: '49.00' },
    })

    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Flat shipping fee (₹)')
    const form = field.closest('form') as HTMLElement
    await user.clear(field)
    await user.type(field, '49')

    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ value: '49' })
    expect(await within(form).findByText(/the value is now .49\.00./i)).toBeInTheDocument()
  })

  it('surfaces a server validation error without claiming success', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/shippingFeeFlat').reply(400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Shipping fee cannot be negative', details: [] },
    })

    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Flat shipping fee (₹)')
    const form = field.closest('form') as HTMLElement
    await user.clear(field)
    await user.type(field, '5')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await within(form).findByText('Shipping fee cannot be negative')).toBeInTheDocument()
    expect(within(form).queryByText(/^Saved\./i)).not.toBeInTheDocument()
  })

  // ─── Redesign structure ────────────────────────────────────────────────

  it('renders exactly one h1 with a title and description', async () => {
    renderWithProviders(<AdminSettingsPage />)

    await screen.findByLabelText('Flat shipping fee (₹)')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Store settings')
    expect(screen.getByText(/take effect immediately across the storefront and checkout/i)).toBeInTheDocument()
  })

  it('groups settings into Store identity / Storefront / Tax (GST) / Invoicing cards', async () => {
    renderWithProviders(<AdminSettingsPage />)

    await screen.findByLabelText('Flat shipping fee (₹)')

    const identity = screen.getByRole('region', { name: 'Store identity' })
    expect(within(identity).getByLabelText('Store name')).toBeInTheDocument()
    expect(within(identity).getByLabelText('Store admin name')).toBeInTheDocument()

    const storefront = screen.getByRole('region', { name: 'Storefront' })
    expect(within(storefront).getByLabelText('Flat shipping fee (₹)')).toBeInTheDocument()
    expect(within(storefront).queryByLabelText('Store name')).not.toBeInTheDocument()

    const content = screen.getByRole('region', { name: 'Storefront content' })
    expect(within(content).getByLabelText('Announcement bar text')).toBeInTheDocument()

    const navbarSeller = screen.getByRole('region', { name: 'Navbar seller identity' })
    expect(within(navbarSeller).getByLabelText('Legal name')).toHaveValue('Identica')
    expect(within(navbarSeller).getByLabelText('Location')).toHaveValue(
      'Golden City, Magistrate Lane, Maharajpura, Gwalior, MP, India',
    )
    expect(within(navbarSeller).getByLabelText('GSTIN')).toHaveValue('23EQZPS2886B1Z7')
    expect(
      within(navbarSeller).getByRole('checkbox', { name: /show payment protected/i }),
    ).toBeChecked()
    expect(within(navbarSeller).getByRole('region', { name: 'Navbar preview' })).toHaveTextContent(
      'Identica',
    )

    const tax = screen.getByRole('region', { name: 'Tax (GST)' })
    expect(within(tax).getByLabelText('GST / tax enabled')).toBeInTheDocument()
    expect(within(tax).getByLabelText('Tax pricing mode')).toBeInTheDocument()

    const invoicing = screen.getByRole('region', { name: 'Invoicing' })
    expect(within(invoicing).getByLabelText('Invoice number prefix')).toBeInTheDocument()
  })

  it('still shows navbar seller identity when the API omits those keys', async () => {
    adminSettingsReply = () => [
      200,
      {
        success: true,
        data: SETTINGS_RESPONSE.data.filter(
          (setting) =>
            setting.key !== 'sellerLegalName' &&
            setting.key !== 'sellerLocality' &&
            setting.key !== 'sellerGstin' &&
            setting.key !== 'sellerPaymentProtected',
        ),
      },
    ]
    renderWithProviders(<AdminSettingsPage />)

    expect(await screen.findByLabelText('Legal name')).toHaveValue('Identica')
    expect(screen.getByLabelText('Location')).toHaveValue('Sakinaka, Mumbai, Maharashtra')
    expect(screen.getByLabelText('GSTIN')).toHaveValue('27ARLPM5978P1ZL')
    expect(screen.getByRole('checkbox', { name: /show payment protected/i })).toBeChecked()
  })

  it('saves navbar seller identity from the dedicated editor', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/sellerLegalName').reply(200, {
      success: true,
      data: {
        key: 'sellerLegalName',
        label: 'Legal name',
        description: '',
        kind: 'text',
        value: 'Atharva Prints',
        default: 'Identica',
      },
    })
    renderWithProviders(<AdminSettingsPage />)

    const legalName = await screen.findByLabelText('Legal name')
    await user.clear(legalName)
    await user.type(legalName, 'Atharva Prints')
    expect(screen.getByRole('region', { name: 'Navbar preview' })).toHaveTextContent(
      'Atharva Prints',
    )

    await user.click(screen.getByRole('button', { name: 'Save navbar strip' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(mock.history.patch[0].url).toBe('/admin/settings/sellerLegalName')
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({
      value: 'Atharva Prints',
    })
    expect(await screen.findByText(/the storefront navbar will use these values/i)).toBeInTheDocument()
  })

  it('populates each field with the current backend value', async () => {
    renderWithProviders(<AdminSettingsPage />)

    expect(await screen.findByLabelText('Announcement bar text')).toHaveValue('Free shipping this week')
    expect(screen.getByLabelText('Invoice number prefix')).toHaveValue('INV-')
    expect(screen.getByLabelText('Tax pricing mode')).toHaveValue('INCLUSIVE')
  })

  it('renders the boolean setting as a select with true / false options', async () => {
    renderWithProviders(<AdminSettingsPage />)

    const select = await screen.findByLabelText('GST / tax enabled')
    expect(select.tagName).toBe('SELECT')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['false', 'true'])
  })

  it('offers only the API-provided option for tax pricing mode (EXCLUSIVE stays locked)', async () => {
    renderWithProviders(<AdminSettingsPage />)

    const select = await screen.findByLabelText('Tax pricing mode')
    expect(within(select).getAllByRole('option')).toHaveLength(1)
    expect(within(select).getByRole('option', { name: 'INCLUSIVE' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'EXCLUSIVE' })).not.toBeInTheDocument()
  })

  it('flags a pending-client-input setting with an informational notice', async () => {
    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Combined GST rate (%)')
    const form = field.closest('form') as HTMLElement
    expect(within(form).getByText(/leave blank until the client\/accountant/i)).toBeInTheDocument()
    expect(field).toHaveValue('')
  })

  it('saves a choice setting, sending the exact { value } payload', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/tax.enabled').reply(200, {
      success: true,
      data: { ...SETTINGS_RESPONSE.data[2], value: 'true' },
    })

    renderWithProviders(<AdminSettingsPage />)

    const select = await screen.findByLabelText('GST / tax enabled')
    const form = select.closest('form') as HTMLElement
    await user.selectOptions(select, 'true')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(mock.history.patch[0].url).toBe('/admin/settings/tax.enabled')
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ value: 'true' })
    expect(await within(form).findByText(/the value is now .true./i)).toBeInTheDocument()
  })

  // ─── States ────────────────────────────────────────────────────────────

  it('shows a page-level skeleton (polite loading status) while loading', () => {
    adminSettingsReply = () => new Promise(() => {})
    renderWithProviders(<AdminSettingsPage />)

    expect(screen.getByText('Loading').closest('[role="status"]')).toBeInTheDocument()
    expect(screen.queryByLabelText('Flat shipping fee (₹)')).not.toBeInTheDocument()
  })

  it('surfaces a settings fetch error through the shared Alert', async () => {
    adminSettingsReply = () => [
      500,
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Settings unavailable', details: [] },
      },
    ]
    renderWithProviders(<AdminSettingsPage />)

    expect(await screen.findByText('Settings unavailable')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Store settings')
  })

  // ─── Store identity (Store Name / Store Admin Name) ────────────────────

  it('loads the current store name and store admin name from the API', async () => {
    adminSettingsReply = () => [
      200,
      {
        success: true,
        data: SETTINGS_RESPONSE.data.map((s) =>
          s.key === 'storeName'
            ? { ...s, value: 'Atharva Prints' }
            : s.key === 'storeAdminName'
              ? { ...s, value: 'Atharva Vavhal' }
              : s,
        ),
      },
    ]
    renderWithProviders(<AdminSettingsPage />)

    expect(await screen.findByLabelText('Store name')).toHaveValue('Atharva Prints')
    expect(screen.getByLabelText('Store admin name')).toHaveValue('Atharva Vavhal')
  })

  it('edits and saves the store name, showing a real "Saved" confirmation', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/storeName').reply(200, {
      success: true,
      data: { ...SETTINGS_RESPONSE.data[0], value: 'Atharva Prints' },
    })
    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Store name')
    const form = field.closest('form') as HTMLElement
    await user.clear(field)
    await user.type(field, 'Atharva Prints')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(mock.history.patch[0].url).toBe('/admin/settings/storeName')
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ value: 'Atharva Prints' })
    expect(await within(form).findByText(/the value is now .Atharva Prints./i)).toBeInTheDocument()
  })

  it('blocks an empty store name client-side and never calls the API', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Store name')
    const form = field.closest('form') as HTMLElement
    await user.clear(field)
    await user.type(field, '  ')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await within(form).findByText(/store name is required/i)).toBeInTheDocument()
    expect(mock.history.patch).toHaveLength(0)
  })

  it('surfaces a server rejection of the store name without claiming success', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/storeName').reply(400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Store name cannot exceed 60 characters', details: [] },
    })
    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Store name')
    const form = field.closest('form') as HTMLElement
    await user.clear(field)
    await user.type(field, 'A slightly different name')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    expect(
      await within(form).findByText('Store name cannot exceed 60 characters'),
    ).toBeInTheDocument()
    expect(within(form).queryByText(/^Saved\./i)).not.toBeInTheDocument()
  })

  it('allows an empty store admin name (optional)', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/storeAdminName').reply(200, {
      success: true,
      data: { ...SETTINGS_RESPONSE.data[1], value: 'Atharva Vavhal' },
    })
    renderWithProviders(<AdminSettingsPage />)

    const field = await screen.findByLabelText('Store admin name')
    const form = field.closest('form') as HTMLElement
    await user.type(field, 'Atharva Vavhal')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(mock.history.patch[0].url).toBe('/admin/settings/storeAdminName')
  })

  it('uploads a store logo and saves the returned image URL', async () => {
    const user = userEvent.setup()
    mock.onPost('/uploads').reply(200, {
      success: true,
      data: {
        id: 'file-1',
        url: 'https://res.cloudinary.com/demo/image/upload/logo.png',
        format: 'png',
        bytes: 12,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    })
    const savedLogo = {
      key: 'storeLogo',
      label: 'Store logo',
      description: 'Shown in the storefront navbar. Upload a PNG or JPEG.',
      kind: 'text' as const,
      value: 'https://res.cloudinary.com/demo/image/upload/logo.png',
      default: '/catalog/logo.png',
    }
    mock.onPatch('/admin/settings/storeLogo').reply(200, {
      success: true,
      data: savedLogo,
    })
    adminSettingsReply = () => [
      200,
      {
        ...SETTINGS_RESPONSE,
        data: SETTINGS_RESPONSE.data.map((setting) =>
          setting.key === 'storeLogo' ? savedLogo : setting,
        ),
      },
    ]
    renderWithProviders(<AdminSettingsPage />)

    const input = await screen.findByLabelText('Store logo')
    const file = new File(['img'], 'logo.png', { type: 'image/png' })
    await user.upload(input, file)

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(mock.history.patch[0].url).toBe('/admin/settings/storeLogo')
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({
      value: 'https://res.cloudinary.com/demo/image/upload/logo.png',
    })
    expect(await screen.findByText(/logo saved/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByAltText('Current store logo')).toHaveAttribute(
        'src',
        'https://res.cloudinary.com/demo/image/upload/logo.png',
      ),
    )
  })

  it('loads existing hero slides and saves copy edits', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/hero_slides').reply(200, {
      success: true,
      data: {
        key: 'hero_slides',
        label: 'Homepage hero slides',
        description: 'Add, replace, or delete homepage banner slides.',
        kind: 'text',
        value: JSON.stringify([
          {
            imageUrl: '/catalog/hero-3.jpg',
            headline: 'Updated headline',
            subtext: 'Made to order',
            ctaText: 'Shop acrylic',
            ctaLink: '/products?category=acrylic-gifts',
          },
        ]),
        default: '',
      },
    })
    renderWithProviders(<AdminSettingsPage />)

    const headline = await screen.findByLabelText('Slide 1 headline')
    expect(headline).toHaveValue('Acrylic caricatures')
    await user.clear(headline)
    await user.type(headline, 'Updated headline')
    await user.click(screen.getByRole('button', { name: 'Save slides' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(mock.history.patch[0].url).toBe('/admin/settings/hero_slides')
    const saved = JSON.parse(mock.history.patch[0].data as string) as { value: string }
    const slides = JSON.parse(saved.value) as Array<{ headline: string }>
    expect(slides[0]?.headline).toBe('Updated headline')
    expect(await screen.findByText(/hero slides saved/i)).toBeInTheDocument()
  })

  it('replaces a hero image via upload', async () => {
    const user = userEvent.setup()
    mock.onPost('/uploads').reply(200, {
      success: true,
      data: {
        id: 'hero-file',
        url: 'https://res.cloudinary.com/demo/image/upload/hero-new.jpg',
        format: 'jpg',
        bytes: 20,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    })
    renderWithProviders(<AdminSettingsPage />)

    await user.click(await screen.findByRole('button', { name: 'Replace image' }))
    const replaceInput = screen.getByLabelText('Replace hero image')
    await user.upload(replaceInput, new File(['img'], 'hero.jpg', { type: 'image/jpeg' }))

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Slide 1 image' })).toHaveAttribute(
        'src',
        'https://res.cloudinary.com/demo/image/upload/hero-new.jpg',
      ),
    )
  })

  it('deletes a hero slide after confirmation, then saves the empty list', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/settings/hero_slides').reply(200, {
      success: true,
      data: {
        key: 'hero_slides',
        label: 'Homepage hero slides',
        description: 'Add, replace, or delete homepage banner slides.',
        kind: 'text',
        value: '',
        default: '',
      },
    })
    renderWithProviders(<AdminSettingsPage />)

    await user.click(await screen.findByRole('button', { name: 'Delete slide' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete slide' }))
    expect(await screen.findByText('No hero slides yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save slides' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ value: '' })
  })

  // ─── Negative assertions ───────────────────────────────────────────────

  it('renders only the settings the API returns — no add/remove, no unsupported fields, no analytics', async () => {
    renderWithProviders(<AdminSettingsPage />)

    await screen.findByLabelText('Flat shipping fee (₹)')
    // No way to add or delete a setting.
    expect(screen.queryByRole('button', { name: /add setting|new setting/i })).not.toBeInTheDocument()
    // No invented tax/legal fields beyond what the API returned.
    expect(screen.queryByLabelText('Seller PAN')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CGST rate')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\{/)).not.toBeInTheDocument()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(document.querySelector('canvas')).toBeNull()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
