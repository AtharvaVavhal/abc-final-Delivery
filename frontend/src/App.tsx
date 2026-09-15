import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '@/services/queryClient'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { AdminRoute } from '@/features/auth/AdminRoute'
import { RootLayout } from '@/layouts/RootLayout'
import { AdminLayout } from '@/layouts/AdminLayout'
import { HomePage } from '@/pages/home/HomePage'
import { AboutPage } from '@/pages/static/AboutPage'
import { ContactPage } from '@/pages/static/ContactPage'
import { PrivacyPage } from '@/pages/static/PrivacyPage'
import { TermsPage } from '@/pages/static/TermsPage'
import { RefundPolicyPage } from '@/pages/static/RefundPolicyPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { ProductListPage } from '@/pages/catalog/ProductListPage'
import { ProductDetailPage } from '@/pages/catalog/ProductDetailPage'
import { CartPage } from '@/pages/cart/CartPage'
import { AccountPage } from '@/pages/account/AccountPage'
import { OrdersPage } from '@/pages/orders/OrdersPage'
import { OrderDetailPage } from '@/pages/orders/OrderDetailPage'
import { InvoicePage } from '@/pages/orders/InvoicePage'
import { CheckoutPage } from '@/pages/checkout/CheckoutPage'
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage'
import { AdminOrdersPage } from '@/pages/admin/AdminOrdersPage'
import { AdminOrderDetailPage } from '@/pages/admin/AdminOrderDetailPage'
import { AdminCustomersPage } from '@/pages/admin/AdminCustomersPage'
import { AdminCustomerDetailPage } from '@/pages/admin/AdminCustomerDetailPage'
import { AdminProductsPage } from '@/pages/admin/AdminProductsPage'
import { AdminProductDetailPage } from '@/pages/admin/AdminProductDetailPage'
import { AdminCategoriesPage } from '@/pages/admin/AdminCategoriesPage'
import { AdminCouponsPage } from '@/pages/admin/AdminCouponsPage'
import { AdminSettingsPage } from '@/pages/admin/AdminSettingsPage'
import { ForbiddenPage } from '@/pages/forbidden/ForbiddenPage'
import { NotFoundPage } from '@/pages/not-found/NotFoundPage'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { ROUTES } from '@/constants/routes'

/**
 * Router shell (§18). Route grouping is visible from the tree shape:
 *   - public + protected storefront routes sit under <RootLayout> (the
 *     storefront chrome), protected ones inside a <ProtectedRoute> guard.
 *   - admin routes sit under <AdminRoute> (auth + role guard, unchanged)
 *     and then <AdminLayout> (the dedicated admin shell) — deliberately
 *     NOT under <RootLayout>, so admin pages never get the storefront
 *     header / search / mega-menu / cart / footer.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
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
              <Route element={<AdminLayout />}>
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
