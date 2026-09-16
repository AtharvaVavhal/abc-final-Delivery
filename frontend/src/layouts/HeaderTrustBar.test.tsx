import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { HeaderTrustBar } from './HeaderTrustBar'

function settingsReply(map: Record<string, string>) {
  return { success: true, data: { data: map } }
}

describe('HeaderTrustBar', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('shows the registered seller, locality, GSTIN, and payment-protected mark', async () => {
    mock.onGet('/settings').reply(
      200,
      settingsReply({
        sellerLegalName: 'GOURAV KUMAR ABHAY SINGH',
        sellerLocality: '',
        sellerGstin: '23EQZPS2886B1Z7',
        sellerPaymentProtected: 'true',
      }),
    )
    renderWithProviders(<HeaderTrustBar />)

    const region = await screen.findByRole('region', { name: 'Seller identity' })
    expect(region).toHaveTextContent('GOURAV KUMAR ABHAY SINGH')
    expect(region).toHaveTextContent('Golden City, Magistrate Lane, Maharajpura, Gwalior, MP, India')
    expect(region).toHaveTextContent('GST No. 23EQZPS2886B1Z7')
    expect(region).toHaveTextContent('Payment Protected')
  })

  it('uses values saved in Store Admin instead of the Identica defaults', async () => {
    mock.onGet('/settings').reply(
      200,
      settingsReply({
        sellerLegalName: 'Atharva Prints LLP',
        sellerLocality: 'Pune, Maharashtra',
        sellerGstin: '27AAAAA0000A1Z5',
        sellerPaymentProtected: 'false',
      }),
    )
    renderWithProviders(<HeaderTrustBar />)

    expect(await screen.findByText('Atharva Prints LLP')).toBeInTheDocument()
    const region = screen.getByRole('region', { name: 'Seller identity' })
    expect(region).toHaveTextContent('Pune, Maharashtra')
    expect(region).toHaveTextContent('GST No. 27AAAAA0000A1Z5')
    expect(region).not.toHaveTextContent('Payment Protected')
  })
})
