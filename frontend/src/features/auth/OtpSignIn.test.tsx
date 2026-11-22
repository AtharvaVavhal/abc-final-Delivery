import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosResponse } from 'axios'
import { createMockAuthContext, renderWithProviders } from '@/test/test-utils'
import { OtpSignIn } from './OtpSignIn'
import { isValidIndianMobile } from './otpPhone'

function axiosError(status: number, message: string) {
  return new AxiosError(message, 'ERR', undefined, undefined, {
    status,
    data: { success: false, error: { code: 'X', message, details: [] } },
  } as AxiosResponse)
}

describe('isValidIndianMobile', () => {
  it.each([
    '9876543210',
    '98765 43210',
    '+91 98765 43210',
    '919876543210',
    '09876543210',
  ])('accepts %s', (v) => expect(isValidIndianMobile(v)).toBe(true))
  it.each(['', '12345', '5876543210', '98765432101', 'abcdefghij'])(
    'rejects "%s"',
    (v) => expect(isValidIndianMobile(v)).toBe(false),
  )
})

describe('OtpSignIn', () => {
  afterEach(() => vi.restoreAllMocks())

  it('announces an empty mobile field and focuses it', async () => {
    const requestOtp = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid 10-digit mobile number',
    )
    expect(screen.getByLabelText(/Mobile number/)).toHaveFocus()
    expect(screen.getByLabelText(/Mobile number/)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(requestOtp).not.toHaveBeenCalled()
  })

  it('waits for server acceptance and prevents duplicate sends while loading', async () => {
    let accept!: () => void
    const requestOtp = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve
        }),
    )
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))
    expect(screen.getByRole('button', { name: 'SENDING OTP…' })).toBeDisabled()
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument()
    expect(requestOtp).toHaveBeenCalledTimes(1)
    await act(() => Promise.resolve(accept()))
    expect(await screen.findByLabelText('Verification code')).toHaveFocus()
  })

  it('accepts a pasted code and supports keyboard submission', async () => {
    const loginWithOtp = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ loginWithOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.keyboard('{Enter}')
    expect(await screen.findByLabelText('Verification code')).toHaveFocus()
    await user.paste('123456')
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'VERIFY & CONTINUE' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(loginWithOtp).toHaveBeenCalledWith('+919876543210', '123456'),
    )
  })

  it('resends only after the UI cooldown and still handles server refusal', async () => {
    const requestOtp = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(axiosError(429, 'Please wait'))
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))
    await screen.findByLabelText('Verification code')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    await user.click(
      await screen.findByRole('button', { name: 'Resend OTP' }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please wait a moment and try again.',
    )
    expect(screen.getByRole('button', { name: /Resend OTP in/ })).toBeDisabled()
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument()
    expect(requestOtp).toHaveBeenCalledTimes(2)
  })
  it('rejects an invalid number without calling the API', async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })

    await user.type(screen.getByLabelText(/Mobile number/), '12345')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))

    expect(
      await screen.findByText('Enter a valid 10-digit mobile number'),
    ).toBeInTheDocument()
    expect(requestOtp).not.toHaveBeenCalled()
  })

  it('sends the code, then verifies it and signs in', async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined)
    const loginWithOtp = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp, loginWithOtp }),
    })

    await user.type(screen.getByLabelText(/Mobile number/), '98765 43210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))

    expect(await screen.findByTestId('otp-sent-to')).toHaveTextContent(
      '+91 XXXXXXX210',
    )
    expect(requestOtp).toHaveBeenCalledWith('+919876543210')

    await user.type(screen.getByLabelText(/Verification code/), '123456')
    await user.click(screen.getByRole('button', { name: 'VERIFY & CONTINUE' }))

    await waitFor(() =>
      expect(loginWithOtp).toHaveBeenCalledWith('+919876543210', '123456'),
    )
  })

  it('only accepts digits in the code and requires six of them', async () => {
    const loginWithOtp = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ loginWithOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))

    const input = await screen.findByLabelText(/Verification code/)
    await user.type(input, '12ab3')
    expect(input).toHaveValue('123')
    await user.click(screen.getByRole('button', { name: 'VERIFY & CONTINUE' }))

    expect(
      await screen.findByText('Enter the 6-digit code we sent you'),
    ).toBeInTheDocument()
    expect(loginWithOtp).not.toHaveBeenCalled()
  })

  it('shows the server message for a wrong code and stays on the code step', async () => {
    const loginWithOtp = vi
      .fn()
      .mockRejectedValue(axiosError(401, 'Invalid or expired code'))
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ loginWithOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))
    await user.type(await screen.findByLabelText(/Verification code/), '000000')
    await user.click(screen.getByRole('button', { name: 'VERIFY & CONTINUE' }))

    expect(
      await screen.findByText('Invalid or expired code'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Verification code/)).toBeInTheDocument()
  })

  it('shows the app-wide rate-limit message and stays on the phone step', async () => {
    const requestOtp = vi
      .fn()
      .mockRejectedValue(
        axiosError(429, 'Too many code requests. Please try again later'),
      )
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))

    expect(
      await screen.findByText('Please wait a moment and try again.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument()
  })

  it('explains when the server has SMS sign-in switched off (404)', async () => {
    const requestOtp = vi.fn().mockRejectedValue(axiosError(404, 'Not Found'))
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))

    expect(
      await screen.findByText(/not available right now/),
    ).toBeInTheDocument()
  })

  it('locks "Send again" during the cooldown and lets the user change number', async () => {
    const requestOtp = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithProviders(<OtpSignIn />, {
      authValue: createMockAuthContext({ requestOtp }),
    })
    await user.type(screen.getByLabelText(/Mobile number/), '9876543210')
    await user.click(screen.getByRole('button', { name: 'SEND OTP' }))

    const resend = await screen.findByRole('button', {
      name: /Resend OTP in \d+s/,
    })
    expect(resend).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Change number' }))
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument()
  })
})
