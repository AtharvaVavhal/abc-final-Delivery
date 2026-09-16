import { lazy, Suspense, type ComponentType } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '@/services/queryClient'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { AdminRoute } from '@/features/auth/AdminRoute'
import { RootLayout } from '@/layouts/RootLayout'
import { HomePage } from '@/pages/home/HomePage'
import { FullPageLoader } from '@/components/ui/FullPageLoader'
import { ROUTES } from '@/constants/routes'

function lazyNamed<T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(() => loader().then((mod) => ({ default: mod[exportName] })))
}

const AboutPage = lazyNamed(() => import('@/pages/static/AboutPage'), 'AboutPage')
const ContactPage = lazyNamed(() => import('@/pages/static/ContactPage'), 'ContactPage')
const PrivacyPage = lazyNamed(() => import('@/pages/static/PrivacyPage'), 'PrivacyPage')
const TermsPage = lazyNamed(() => import('@/pages/static/TermsPage'), 'TermsPage')
const RefundPolicyPage = lazyNamed(
  () => import('@/pages/static/RefundPolicyPage'),
  'RefundPolicyPage',
)
const LoginPage = lazyNamed(() => import('@/pages/auth/LoginPage'), 'LoginPage')
const RegisterPage = lazyNamed(() => import('@/pages/auth/RegisterPage'), 'RegisterPage')
const ForgotPasswordPage = lazyNamed(
  () => import('@/pages/auth/ForgotPasswordPage'),
  'ForgotPasswordPage',
)
const ResetPasswordPage = lazyNamed(
  () => import('@/pages/auth/ResetPasswordPage'),
  'ResetPasswordPage',
)
const ProductListPage = lazyNamed(() => import('@/pages/catalog/ProductListPage'), 'ProductListPage')
const ProductDetailPage = lazyNamed(
  () => import('@/pages/catalog/ProductDetailPage'),
  'ProductDetailPage',
)
const CartPage = lazyNamed(() => import('@/pages/cart/CartPage'), 'CartPage')
const AccountPage = lazyNamed(() => import('@/pages/account/AccountPage'), 'AccountPage')
const OrdersPage = lazyNamed(() => import('@/pages/orders/OrdersPage'), 'OrdersPage')
const OrderDetailPage = lazyNamed(() => import('@/pages/orders/OrderDetailPage'), 'OrderDetailPage')
const InvoicePage = lazyNamed(() => import('@/pages/orders/InvoicePage'), 'InvoicePage')
const CheckoutPage = lazyNamed(() => import('@/pages/checkout/CheckoutPage'), 'CheckoutPage')
const ForbiddenPage = lazyNamed(() => import('@/pages/forbidden/ForbiddenPage'), 'ForbiddenPage')
const NotFoundPage = lazyNamed(() => import('@/pages/not-found/NotFoundPage'), 'NotFoundPage')

const loadAdmin = () => import('@/pages/admin/adminBundle')
const AdminLayout = lazyNamed(loadAdmin, 'AdminLayout')
const AdminDashboardPage = lazyNamed(loadAdmin, 'AdminDashboardPage')
const AdminOrdersPage = lazyNamed(loadAdmin, 'AdminOrdersPage')
const AdminOrderDetailPage = lazyNamed(loadAdmin, 'AdminOrderDetailPage')
const AdminCustomersPage = lazyNamed(loadAdmin, 'AdminCustomersPage')
const AdminCustomerDetailPage = lazyNamed(loadAdmin, 'AdminCustomerDetailPage')
const AdminProductsPage = lazyNamed(loadAdmin, 'AdminProductsPage')
const AdminProductDetailPage = lazyNamed(loadAdmin, 'AdminProductDetailPage')
const AdminCategoriesPage = lazyNamed(loadAdmin, 'AdminCategoriesPage')
const AdminCouponsPage = lazyNamed(loadAdmin, 'AdminCouponsPage')
const AdminSettingsPage = lazyNamed(loadAdmin, 'AdminSettingsPage')

function RouteFallback({ label }: { label: string }) {
  return <FullPageLoader label={label} />
}

/**
 * Router shell (§18). Route grouping is visible from the tree shape:
 *   - public + protected storefront routes sit under <RootLayout> (the
 *     storefront chrome), protected ones inside a <ProtectedRoute> guard.
 *   - admin routes sit under <AdminRoute> (auth + role guard, unchanged)
 *     and then <AdminLayout> (the dedicated admin shell) — deliberately
 *     NOT under <RootLayout>, so admin pages never get the storefront
 *     header / search / mega-menu / cart / footer.
 *
 * Store Admin is a single dynamic import (`adminBundle`) so the customer
 * homepage never downloads admin pages, sidebar, or product-editor code.
 * Heavy customer routes are lazy as well; HomePage stays eager for LCP.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<RootLayout />}>
              {/* Public routes */}
              <Route path={ROUTES.HOME} element={<HomePage />} />
              <Route path={ROUTES.ABOUT} element={<AboutPage />} />
              <Route path={ROUTES.CONTACT} element={<ContactPage />} />
              <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
              <Route path={ROUTES.TERMS} element={<TermsPage />} />
              <Route path={ROUTES.REFUND_POLICY} element={<RefundPolicyPage />} />
              <Route path={ROUTES.LOGIN} element={<LoginPage />} />
              <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
              <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
              <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
              <Route path={ROUTES.PRODUCTS} element={<ProductListPage />} />
              <Route path={ROUTES.PRODUCT_DETAIL} element={<ProductDetailPage />} />
              <Route path={ROUTES.FORBIDDEN} element={<ForbiddenPage />} />

              {/* Protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route path={ROUTES.CART} element={<CartPage />} />
                <Route path={ROUTES.ACCOUNT} element={<AccountPage />} />
                <Route path={ROUTES.ORDERS} element={<OrdersPage />} />
                <Route path={ROUTES.ORDER_DETAIL} element={<OrderDetailPage />} />
                <Route path={ROUTES.ORDER_INVOICE} element={<InvoicePage />} />
                <Route path={ROUTES.CHECKOUT} element={<CheckoutPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>

            {/* Admin — authentication AND role === 'ADMIN' (AdminRoute, a
                strict superset of ProtectedRoute's check), then the
                dedicated admin shell (AdminLayout). Same routes as before,
                just relocated out of the storefront RootLayout. */}
            <Route element={<AdminRoute />}>
              <Route
                element={
                  <Suspense fallback={<RouteFallback label="Loading admin" />}>
                    <AdminLayout />
                  </Suspense>
                }
              >
                <Route path={ROUTES.ADMIN_DASHBOARD} element={<AdminDashboardPage />} />
                <Route path={ROUTES.ADMIN_ORDERS} element={<AdminOrdersPage />} />
                <Route path={ROUTES.ADMIN_ORDER_DETAIL} element={<AdminOrderDetailPage />} />
                <Route path={ROUTES.ADMIN_CUSTOMERS} element={<AdminCustomersPage />} />
                <Route path={ROUTES.ADMIN_CUSTOMER_DETAIL} element={<AdminCustomerDetailPage />} />
                <Route path={ROUTES.ADMIN_PRODUCTS} element={<AdminProductsPage />} />
                <Route path={ROUTES.ADMIN_PRODUCT_DETAIL} element={<AdminProductDetailPage />} />
                <Route path={ROUTES.ADMIN_CATEGORIES} element={<AdminCategoriesPage />} />
                <Route path={ROUTES.ADMIN_COUPONS} element={<AdminCouponsPage />} />
                <Route path={ROUTES.ADMIN_SETTINGS} element={<AdminSettingsPage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
