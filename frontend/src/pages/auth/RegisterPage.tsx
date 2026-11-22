import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useApiError } from '@/hooks/useApiError'
import { registerSchema, type RegisterFormValues } from '@/schemas/auth.schema'
import { ROUTES } from '@/constants/routes'
import { postAuthDestination } from '@/features/auth/postAuthDestination'
import { AuthFormShell } from '@/features/auth/AuthFormShell'
import { OTP_LOGIN_ENABLED } from '@/features/auth/otpEnabled'
import { TextField } from '@/components/ui/TextField'
import { PasswordRequirements } from '@/components/ui/PasswordRequirements'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import shellStyles from '@/features/auth/AuthFormShell.module.css'

const PASSWORD_REQUIREMENTS_ID = 'register-password-requirements'

/** With phone-OTP login on there is no separate sign-up: a verified number
 * with no account creates one, so /register sends people to the one login
 * page (keeping the router state so they return to where they were headed). */
export function RegisterPage() {
  const location = useLocation()
  if (OTP_LOGIN_ENABLED) {
    return <Navigate to={ROUTES.LOGIN} state={location.state as unknown} replace />
  }
  return <PasswordRegisterPage />
}

function PasswordRegisterPage() {
  const { register: registerAccount } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { message: formError, captureError, clearError } = useApiError()

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) })

  const passwordValue = useWatch({ control, name: 'password' }) ?? ''

  async function onSubmit(values: RegisterFormValues) {
    clearError()
    try {
      await registerAccount(values.email, values.password)
      void navigate(postAuthDestination(location), { replace: true })
    } catch (error) {
      captureError(error)
    }
  }

  return (
    <AuthFormShell
      title="Create an account"
      subtitle="Sign up to start customizing and ordering."
      footer={
        <>
          Already have an account? <Link to={ROUTES.LOGIN}>Log in</Link>
        </>
      }
    >
      <form className={shellStyles.form} onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          revealable
          required
          aria-describedby={PASSWORD_REQUIREMENTS_ID}
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordRequirements id={PASSWORD_REQUIREMENTS_ID} value={passwordValue} />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          revealable
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" isLoading={isSubmitting} className={shellStyles.submit}>
          Create account
        </Button>
      </form>
    </AuthFormShell>
  )
}
