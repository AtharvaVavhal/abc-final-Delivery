import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useApiError } from '@/hooks/useApiError'
import { useStoreName } from '@/hooks/useStoreName'
import { loginSchema, type LoginFormValues } from '@/schemas/auth.schema'
import { ROUTES } from '@/constants/routes'
import { postAuthDestination } from '@/features/auth/postAuthDestination'
import { AuthFormShell } from '@/features/auth/AuthFormShell'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import shellStyles from '@/features/auth/AuthFormShell.module.css'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const storeName = useStoreName()
  const { message: formError, captureError, clearError } = useApiError()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginFormValues) {
    clearError()
    try {
      await login(values.email, values.password)
      void navigate(postAuthDestination(location), { replace: true })
    } catch (error) {
      captureError(error)
    }
  }

  return (
    <AuthFormShell
      title="Log in"
      aside={
        <>
          <span className={shellStyles.asideKicker}>{storeName}</span>
          <p className={shellStyles.asideHeading}>Good to have you back.</p>
          <p className={shellStyles.asideText}>
            Track orders, reorder favourites and check out faster with your account.
          </p>
        </>
      }
      subtitle={`Welcome back to ${storeName}.`}
      footer={
        <>
          {/* Forward whatever router state this page was reached with — when
              ProtectedRoute / AddToCartControls / ReviewList redirect here
              they set `state.from`, and RegisterPage needs it too so a
              customer who signs up (rather than logs in) still returns to
              the flow they were pushed out of (UX-04). */}
          Don&apos;t have an account?{' '}
          <Link to={ROUTES.REGISTER} state={location.state as unknown}>
            Sign up
          </Link>
          <br />
          <Link to={ROUTES.FORGOT_PASSWORD}>Forgot your password?</Link>
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
          autoComplete="current-password"
          revealable
          required
          error={errors.password?.message}
          {...register('password')}
        />

        <Button type="submit" isLoading={isSubmitting} className={shellStyles.submit}>
          Log in
        </Button>
      </form>
    </AuthFormShell>
  )
}
