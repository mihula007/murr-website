import { createRoute } from '@tanstack/react-router'
import { CompleteRegistrationPage } from '@/features/account/complete-page'
import { LoginPage } from '@/features/account/login-page'
import { RegisterPage } from '@/features/account/register-page'
import { ResetPasswordPage } from '@/features/account/reset-password-page'
import { VerifyPage } from '@/features/account/verify-page'
import { rootRoute } from './root'

type EmailSearch = { email?: string }

/** Email в адресе — только подстановка в поле, не секрет и не доказательство входа. */
function validateEmailSearch(search: Record<string, unknown>): EmailSearch {
  return typeof search.email === 'string' && search.email.length <= 320
    ? { email: search.email }
    : {}
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: validateEmailSearch,
  component: function LoginRoute() {
    const { email } = loginRoute.useSearch()
    return <LoginPage {...(email ? { email } : {})} />
  },
})

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
})

export const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register/verify',
  validateSearch: validateEmailSearch,
  component: function VerifyRoute() {
    const { email } = verifyRoute.useSearch()
    return <VerifyPage {...(email ? { email } : {})} />
  },
})

export const completeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register/complete',
  component: CompleteRegistrationPage,
})

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: validateEmailSearch,
  component: function ResetRoute() {
    const { email } = resetPasswordRoute.useSearch()
    return <ResetPasswordPage {...(email ? { email } : {})} />
  },
})

export const authRoutes = [
  loginRoute,
  registerRoute,
  verifyRoute,
  completeRoute,
  resetPasswordRoute,
]
