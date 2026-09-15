import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Footer } from './Footer'
import { AnnouncementBar } from '@/components/layout/AnnouncementBar'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import styles from './RootLayout.module.css'

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
          <Outlet />
        </main>
        <Footer />
        <WhatsAppButton />
      </div>
    </ToastProvider>
  )
}
