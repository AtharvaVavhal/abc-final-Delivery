import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ADMIN_IDLE_LOGOUT_MS } from './adminSession'
import { useAdminIdleLogout } from './useAdminIdleLogout'

describe('useAdminIdleLogout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not log out when disabled (shopper sessions)', () => {
    const onIdle = vi.fn()
    renderHook(() => useAdminIdleLogout(false, onIdle))
    act(() => {
      vi.advanceTimersByTime(ADMIN_IDLE_LOGOUT_MS + 1_000)
    })
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('logs an admin out after 15 minutes of inactivity', () => {
    const onIdle = vi.fn()
    renderHook(() => useAdminIdleLogout(true, onIdle))
    act(() => {
      vi.advanceTimersByTime(ADMIN_IDLE_LOGOUT_MS - 1)
    })
    expect(onIdle).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('resets the idle clock on keyboard activity', () => {
    const onIdle = vi.fn()
    renderHook(() => useAdminIdleLogout(true, onIdle))
    act(() => {
      vi.advanceTimersByTime(ADMIN_IDLE_LOGOUT_MS - 1_000)
      window.dispatchEvent(new Event('keydown'))
      vi.advanceTimersByTime(ADMIN_IDLE_LOGOUT_MS - 1_000)
    })
    expect(onIdle).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

    it('logs out on focus if wall-clock idle elapsed while the timer was throttled', () => {
    const onIdle = vi.fn()
    const start = new Date('2026-01-01T00:00:00.000Z')
    vi.setSystemTime(start)
    renderHook(() => useAdminIdleLogout(true, onIdle))
    act(() => {
      vi.setSystemTime(new Date(start.getTime() + ADMIN_IDLE_LOGOUT_MS + 1_000))
      window.dispatchEvent(new Event('focus'))
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
