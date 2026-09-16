import { lazy, Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { AnnouncementBar } from '@/components/layout/AnnouncementBar'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import { FullPageLoader } from '@/components/ui/FullPageLoader'
import styles from './RootLayout.module.css'

const Footer = lazy(() => import('./Footer').then((m) => ({ default: m.Footer })))

export function RootLayout() {
  return (
    <ToastProvider>
      <div className={styles.shell}>
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>
        <AnnouncementBar />
        <Header />
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Suspense fallback={<FullPageLoader label="Loading page" />}>
            <Outlet />
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
        <WhatsAppButton />
      </div>
    </ToastProvider>
  )
}
