import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import axios from 'axios'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useApiError } from '@/hooks/useApiError'
import { getApiErrorMessage } from '@/utils/apiError'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import shellStyles from './AuthFormShell.module.css'
import styles from './OtpSignIn.module.css'
import { postAuthDestination } from './postAuthDestination'
import { OTP_RESEND_SECONDS, isValidIndianMobile } from './otpPhone'

function describeError(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.status === 404) {
    return 'Sign-in by one-time code is not available right now. Please try again later.'
  }
  return getApiErrorMessage(err)
}

/** Phone-number + SMS-code sign-in (replaces email/password for customers
 * when VITE_AUTH_OTP_ENABLED is on). Signing in and signing up are the same
 * step: a verified number with no account creates one. */
export function OtpSignIn() {
  const { requestOtp, loginWithOtp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { message: formError, captureError, setCustomError, clearError } = useApiError()

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const id = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [secondsLeft])

  async function sendCode(): Promise<boolean> {
    clearError()
    if (!isValidIndianMobile(phone)) {
      setCustomError('Enter a valid 10-digit mobile number')
      return false
    }
    setBusy(true)
    try {
      await requestOtp(phone)
      setSecondsLeft(OTP_RESEND_SECONDS)
      return true
    } catch (err) {
      setCustomError(describeError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handlePhoneSubmit(e: FormEvent) {
    e.preventDefault()
    if (await sendCode()) {
      setCode('')
      setStep('code')
    }
  }

  async function handleResend() {
    if (secondsLeft > 0 || busy) return
    if (await sendCode()) setCode('')
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault()
    clearError()
    if (!/^\d{6}$/.test(code)) {
      setCustomError('Enter the 6-digit code we sent you')
      return
    }
    setBusy(true)
    try {
      await loginWithOtp(phone, code)
      void navigate(postAuthDestination(location), { replace: true })
    } catch (err) {
      captureError(err)
      setBusy(false)
    }
  }

  function changeNumber() {
    clearError()
    setCode('')
    setStep('phone')
  }

  if (step === 'phone') {
    return (
      <form className={shellStyles.form} onSubmit={(e) => void handlePhoneSubmit(e)} noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}
        <div className={styles.phoneRow}>
          <span className={styles.prefix} aria-hidden="true">
            +91
          </span>
          <TextField
            className={styles.phoneField}
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="98765 43210"
            maxLength={14}
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <p className={styles.hint}>We&apos;ll send you a 6-digit code. No password needed.</p>
        <Button type="submit" isLoading={busy} className={shellStyles.submit}>
          Send code
        </Button>
      </form>
    )
  }

  return (
    <form className={shellStyles.form} onSubmit={(e) => void handleCodeSubmit(e)} noValidate>
      {formError && <Alert variant="error">{formError}</Alert>}
      <p className={styles.hint} data-testid="otp-sent-to">
        Enter the 6-digit code we sent to <strong>{phone}</strong>.
      </p>
      <TextField
        label="Verification code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <Button type="submit" isLoading={busy} className={shellStyles.submit}>
        Verify and continue
      </Button>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => void handleResend()}
          disabled={secondsLeft > 0 || busy}
        >
          {secondsLeft > 0 ? `Send again in ${secondsLeft}s` : 'Send again'}
        </button>
        <button type="button" className={styles.linkButton} onClick={changeNumber}>
          Change number
        </button>
      </div>
    </form>
  )
}
