import { describe, expect, it } from 'vitest'
import { getApiErrorMessage, parseApiError } from './apiError'

function axiosError(status: number, data?: unknown) {
  return {
    isAxiosError: true,
    response: { status, data },
  }
}

describe('parseApiError', () => {
  it('uses a customer-facing message for 429 even when the body is ThrottlerException', () => {
    const parsed = parseApiError(
      axiosError(429, {
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'ThrottlerException: Too Many Requests',
          details: [],
        },
      }),
    )
    expect(parsed.code).toBe('RATE_LIMITED')
    expect(parsed.message).toBe('Please wait a moment and try again.')
    expect(getApiErrorMessage(axiosError(429))).toBe('Please wait a moment and try again.')
  })
})
