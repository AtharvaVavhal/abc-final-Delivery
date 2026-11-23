/** Build-time flag: customers sign in with a phone number + SMS code instead
 * of email + password. Mirrors the backend's AUTH_OTP_ENABLED — turn both on
 * together. Default off, so the site behaves exactly as before. */
export const OTP_LOGIN_ENABLED = import.meta.env.VITE_AUTH_OTP_ENABLED === 'true'
