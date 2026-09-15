import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { PromotionalVideoModal, type PromotionalVideoData } from './PromotionalVideoModal'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('PromotionalVideoModal', () => {
  const sampleData: PromotionalVideoData = {
    videoUrl: '/videos/categories/t-shirts.webm',
    title: 'Customize T-shirt',
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: '/products?category=t-shirts',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.style.overflow = ''
  })

  it('renders nothing when isOpen is false', () => {
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={false} onClose={vi.fn()} data={sampleData} />
      </BrowserRouter>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing when data is null', () => {
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={vi.fn()} data={null} />
      </BrowserRouter>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders dialog, title badge, video, close button and CTA button when open', () => {
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={vi.fn()} data={sampleData} />
      </BrowserRouter>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Customize T-shirt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close video/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /आत्ताच खरेदी करा/i })).toBeInTheDocument()

    const video = screen.getByLabelText(/Customize T-shirt promotional video/i)
    expect(video).toBeInTheDocument()
    expect(video).toHaveAttribute('src', '/videos/categories/t-shirts.webm')
  })

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn()
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={handleClose} data={sampleData} />
      </BrowserRouter>,
    )

    const closeBtn = screen.getByRole('button', { name: /close video/i })
    fireEvent.click(closeBtn)

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn()
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={handleClose} data={sampleData} />
      </BrowserRouter>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when overlay is clicked', () => {
    const handleClose = vi.fn()
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={handleClose} data={sampleData} />
      </BrowserRouter>,
    )

    const overlay = screen.getByRole('presentation')
    fireEvent.click(overlay)

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside the dialog content', () => {
    const handleClose = vi.fn()
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={handleClose} data={sampleData} />
      </BrowserRouter>,
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)

    expect(handleClose).not.toHaveBeenCalled()
  })

  it('calls onClose and navigates to ctaUrl when CTA button is clicked', () => {
    const handleClose = vi.fn()
    render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={handleClose} data={sampleData} />
      </BrowserRouter>,
    )

    const ctaButton = screen.getByRole('button', { name: /आत्ताच खरेदी करा/i })
    fireEvent.click(ctaButton)

    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('/products?category=t-shirts')
  })

  it('locks body scroll on mount and unlocks on unmount', () => {
    const { unmount } = render(
      <BrowserRouter>
        <PromotionalVideoModal isOpen={true} onClose={vi.fn()} data={sampleData} />
      </BrowserRouter>,
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('')
  })
})
