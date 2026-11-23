/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** Not read by the checkout/payment flow — see .env.example's comment on
   * this var for why (the per-order razorpayKeyId from the backend is used
   * instead). Kept typed/available for a future caller that needs it. */
  readonly VITE_RAZORPAY_KEY_ID: string
  /** Public site origin used to build canonical URLs, og:url, JSON-LD URLs,
   * robots.txt and sitemap.xml. Optional — defaults to the frozen
   * production origin (src/seo/siteConfig.constants.ts). Set it for
   * preview/staging deploys that live on a different hostname. */
  readonly VITE_SITE_URL?: string
  /** 'true' switches customer login/signup to phone OTP. Default off. */
  readonly VITE_AUTH_OTP_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
