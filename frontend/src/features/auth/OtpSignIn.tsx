import { useEffect, useRef, useState, type FormEvent } from 'react'
import axios from 'axios'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { getApiErrorMessage } from '@/utils/apiError'
import { postAuthDestination } from './postAuthDestination'
import { OTP_RESEND_SECONDS, isValidIndianMobile } from './otpPhone'
import styles from './OtpSignIn.module.css'

function describeError(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.status === 404) {
    return 'Sign-in by one-time code is not available right now. Please try again later.'
  }
  return getApiErrorMessage(err)
}

/** The server owns expiry, attempts and throttling. The timer is feedback only. */
export function OtpSignIn() {
  const { requestOtp, loginWithOtp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deadline, setDeadline] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const pending = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [step])

  useEffect(() => {
    const update = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    update()
    if (deadline <= Date.now()) return
    const id = window.setInterval(update, 250)
    return () => window.clearInterval(id)
  }, [deadline])

  function clearError() {
    setError('')
    setInvalid(false)
  }
  function validationError(message: string) {
    setError(message)
    setInvalid(true)
    input.current?.focus()
  }

  async function sendCode(): Promise<boolean> {
    if (pending.current) return false
    clearError()
    if (!/^[6-9]\d{9}$/.test(phone) || !isValidIndianMobile(phone)) {
      validationError('Enter a valid 10-digit mobile number')
      return false
    }
    pending.current = true
    setBusy(true)
    try {
      await requestOtp(`+91${phone}`)
      setDeadline(Date.now() + OTP_RESEND_SECONDS * 1000)
      setAnnouncement(
        'WhatsApp verification code sent. It expires in 5 minutes.',
      )
      return true
    } catch (err) {
      setError(describeError(err))
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const retry = Number(err.response.headers?.['retry-after'])
        setDeadline(
          Date.now() +
            (Number.isFinite(retry) && retry > 0 ? retry : OTP_RESEND_SECONDS) *
              1000,
        )
      }
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    if (step === 'phone') {
      if (await sendCode()) {
        setCode('')
        setStep('code')
      }
      return
    }
    clearError()
    if (!/^\d{6}$/.test(code)) {
      validationError('Enter the 6-digit code we sent you')
      return
    }
    pending.current = true
    setBusy(true)
    try {
      await loginWithOtp(`+91${phone}`, code)
      void navigate(postAuthDestination(location), { replace: true })
    } catch (err) {
      setError(describeError(err))
      setInvalid(true)
      input.current?.focus()
      input.current?.select()
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function handleResend() {
    if (Date.now() < deadline || pending.current) return
    if (await sendCode()) {
      setCode('')
      input.current?.focus()
    }
  }

  function changeNumber() {
    if (pending.current) return
    clearError()
    setAnnouncement('')
    setCode('')
    setStep('phone')
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      aria-busy={busy}
    >
      <h1 className={styles.heading}>
        {step === 'phone' ? 'ENTER MOBILE NUMBER' : 'VERIFY YOUR NUMBER'}
      </h1>
      {step === 'phone' && (
        <p className={styles.deliveryHint}>
          We&apos;ll send your OTP on WhatsApp.
        </p>
      )}
      {step === 'code' && (
        <p className={styles.hint} id="otp-hint" data-testid="otp-sent-to">
          Enter the verification code sent on WhatsApp to{' '}
          <span>+91 XXXXXXX{phone.slice(-3)}.</span>
        </p>
      )}
      <label className="srOnly" htmlFor="otp-input">
        {step === 'phone' ? 'Mobile number (India, +91)' : 'Verification code'}
      </label>
      <div className={styles.inputRow} data-invalid={invalid || undefined}>
        {step === 'phone' && (
          <span className={styles.prefix} aria-hidden="true">
            +91
          </span>
        )}
        <input
          key={step}
          ref={input}
          id="otp-input"
          name={step === 'phone' ? 'phone' : 'code'}
          className={step === 'phone' ? styles.phoneInput : styles.codeInput}
          type={step === 'phone' ? 'tel' : 'text'}
          inputMode="numeric"
          autoComplete={step === 'phone' ? 'tel-national' : 'one-time-code'}
          placeholder={step === 'phone' ? '99999 99999' : '000000'}
          maxLength={step === 'phone' ? 16 : 6}
          pattern={step === 'phone' ? '[6-9][0-9]{9}' : '[0-9]{6}'}
          required
          aria-required="true"
          aria-invalid={invalid}
          aria-describedby={
            [step === 'code' && 'otp-hint', error && 'otp-error']
              .filter(Boolean)
              .join(' ') || undefined
          }
          readOnly={busy}
          value={step === 'phone' ? phone : code}
          onChange={(e) => {
            clearError()
            let digits = e.target.value.replace(/\D/g, '')
            if (step === 'phone') {
              if (digits.length === 12 && digits.startsWith('91'))
                digits = digits.slice(2)
              setPhone(digits.slice(0, 10))
            } else setCode(digits.slice(0, 6))
          }}
        />
      </div>
      {error && (
        <p id="otp-error" role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button
        className={styles.submit}
        type="submit"
        disabled={busy || (step === 'phone' && secondsLeft > 0)}
      >
        <span>
          {busy
            ? step === 'phone'
              ? 'SENDING OTP…'
              : 'VERIFYING…'
            : step === 'phone'
              ? secondsLeft > 0
                ? `SEND OTP IN ${secondsLeft}s`
                : 'SEND OTP'
              : 'VERIFY & CONTINUE'}
        </span>
        {busy ? (
          <LoaderCircle
            size={19}
            className={styles.spinner}
            aria-hidden="true"
          />
        ) : (
          <ArrowRight size={20} strokeWidth={1.6} aria-hidden="true" />
        )}
      </button>
      {step === 'code' && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => void handleResend()}
            disabled={secondsLeft > 0 || busy}
          >
            {secondsLeft > 0 ? `Resend OTP in ${secondsLeft}s` : 'Resend OTP'}
          </button>
          <button
            type="button"
            className={styles.linkButton}
            onClick={changeNumber}
            disabled={busy}
          >
            Change number
          </button>
        </div>
      )}
      <p className="srOnly" role="status">
        {busy
          ? step === 'phone'
            ? 'Sending verification code'
            : 'Verifying code'
          : announcement}
      </p>
    </form>
  )
}
