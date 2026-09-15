import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithProviders } from '@/test/test-utils'
import { AboutPage } from './AboutPage'
import { ContactPage } from './ContactPage'
import { PrivacyPage } from './PrivacyPage'
import { TermsPage } from './TermsPage'
import { RefundPolicyPage } from './RefundPolicyPage'

function renderPage(Component: React.ComponentType) {
  return render(
    <MemoryRouter>
      <Component />
    </MemoryRouter>
  )
}

describe('Static pages render without error', () => {
  it('AboutPage', () => {
    renderPage(AboutPage)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'About AB Creations'
    )
  })

  it('ContactPage', () => {
    renderWithProviders(<ContactPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Contact Us'
    )
  })

  it('ContactPage does not present a working or fake contact form', () => {
    renderWithProviders(<ContactPage />)

    // No form to collect (and silently discard) a message.
    expect(document.querySelector('form')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /send message/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    // No false "message sent" / demo-submission copy.
    expect(screen.queryByText(/message sent/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/thank you for reaching out/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument()

    // Clearly communicates that real contact details require client input.
    expect(screen.getByText(/whatsapp chat/i)).toBeInTheDocument()
  })

  it('PrivacyPage', () => {
    renderPage(PrivacyPage)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Privacy Policy'
    )
  })

  it('TermsPage', () => {
    renderPage(TermsPage)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Terms of Service'
    )
  })

  it('RefundPolicyPage', () => {
    renderPage(RefundPolicyPage)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Refund Policy'
    )
  })
})
