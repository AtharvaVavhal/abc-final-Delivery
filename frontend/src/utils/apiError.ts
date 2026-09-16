import axios from 'axios'
import type { ApiErrorResponse } from '@/types/api'

/**
 * Normalized shape every consumer works with, regardless of what actually
 * failed — a real {success:false,error:{code,message,details}} response
 * (§21), a network failure, or anything else axios can throw.
 */
export interface ParsedApiError {
  code: string
  message: string
  details: unknown[]
}

const GENERIC_ERROR: ParsedApiError = {
  code: 'UNKNOWN_ERROR',
  message: 'Something went wrong. Please check your connection and try again.',
  details: [],
}

const RATE_LIMITED_ERROR: ParsedApiError = {
  code: 'RATE_LIMITED',
  message: 'Please wait a moment and try again.',
  details: [],
}

/**
 * The one place that unwraps the backend's error envelope — every other
 * call site (getApiErrorMessage, useApiError) builds on this instead of
 * re-parsing `error.response.data` itself.
 */
export function parseApiError(error: unknown): ParsedApiError {
  // See client.ts's response interceptor for why this is axios.isAxiosError()
  // rather than `error instanceof AxiosError`.
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      return RATE_LIMITED_ERROR
    }
    const body = error.response?.data as ApiErrorResponse | undefined
    if (body?.success === false && body.error) {
      return { code: body.error.code, message: body.error.message, details: body.error.details }
    }
  }
  return GENERIC_ERROR
}

export function getApiErrorMessage(error: unknown): string {
  return parseApiError(error).message
}
