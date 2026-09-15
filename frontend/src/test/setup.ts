import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  // Storefront features stash small bits of state in web storage (pending
  // cart add, announcement-bar dismissal). Reset between tests so one
  // test's write can never leak into the next.
  try {
    window.sessionStorage.clear()
  } catch {
    // jsdom without storage — nothing to clear.
  }
  try {
    window.localStorage.clear()
  } catch {
    // jsdom without storage — nothing to clear.
  }
})

if (typeof window !== 'undefined' && window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve()
  window.HTMLMediaElement.prototype.pause = () => {}
}

