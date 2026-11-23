import { createContext } from 'react'
import type { AuthStatus } from '@/services/api/authStore'
import type { PublicUser } from '@/types/auth'

export interface AuthContextValue {
  user: PublicUser | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  /** Phone-OTP sign-in: verify the SMS code and start a session. */
  loginWithOtp: (phone: string, code: string) => Promise<void>
  /** Phone-OTP step 1: send the SMS code. */
  requestOtp: (phone: string) => Promise<void>
  logout: () => Promise<void>
}

/** Split from AuthProvider.tsx so that file exports only the component
 * (react-refresh/only-export-components — eslint.config.js). */
export const AuthContext = createContext<AuthContextValue | null>(null)
