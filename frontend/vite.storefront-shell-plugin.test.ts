import { afterEach, describe, expect, it } from 'vitest'
import {
  STOREFRONT_SHELL_BOOT_SCRIPT,
  STOREFRONT_SHELL_CSS_SCRIPT,
  cspSha256,
} from './vite.storefront-shell-plugin.ts'

describe('storefront shell boot (inlined homepage gate)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-storefront-home')
  })

  it('reveals the shell only on /', () => {
    window.history.replaceState({}, '', '/')
    Function(STOREFRONT_SHELL_BOOT_SCRIPT)()
    expect(document.documentElement.hasAttribute('data-storefront-home')).toBe(true)
  })

  it('does not reveal the shell on non-home routes', () => {
    window.history.replaceState({}, '', '/products')
    Function(STOREFRONT_SHELL_BOOT_SCRIPT)()
    expect(document.documentElement.hasAttribute('data-storefront-home')).toBe(false)
  })

  it('is hashed for CSP without unsafe-inline', () => {
    expect(cspSha256(STOREFRONT_SHELL_BOOT_SCRIPT)).toMatch(/^sha256-[A-Za-z0-9+/=]+$/)
    expect(cspSha256(STOREFRONT_SHELL_CSS_SCRIPT)).toMatch(/^sha256-[A-Za-z0-9+/=]+$/)
  })
})
