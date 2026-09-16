/**
 * Single dynamic-import target for Store Admin. Customer routes must never
 * statically import this module — doing so would pull the admin application
 * into the storefront's initial JS.
 */
export { AdminLayout } from '@/layouts/AdminLayout'
export { AdminDashboardPage } from './AdminDashboardPage'
export { AdminOrdersPage } from './AdminOrdersPage'
export { AdminOrderDetailPage } from './AdminOrderDetailPage'
export { AdminCustomersPage } from './AdminCustomersPage'
export { AdminCustomerDetailPage } from './AdminCustomerDetailPage'
export { AdminProductsPage } from './AdminProductsPage'
export { AdminProductDetailPage } from './AdminProductDetailPage'
export { AdminCategoriesPage } from './AdminCategoriesPage'
export { AdminCouponsPage } from './AdminCouponsPage'
export { AdminSettingsPage } from './AdminSettingsPage'
