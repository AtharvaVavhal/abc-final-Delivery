/**
 * One-off manual check of the configured OTP provider against the REAL service.
 * Sends one code to a phone YOU control and prints the HTTP-level outcome and
 * the raw response body, so the response shape can be confirmed.
 *
 *   TEST_PHONE=98XXXXXXXX npx ts-node scripts/send-test-otp.ts
 *
 * Reads RENFLAIR_API_KEY (and optional RENFLAIR_BASE_URL) from backend/.env.
 * Spends real credit (one message). Never prints the key or the request URL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(): void {
  try {
    for (const line of readFileSync(
      resolve(__dirname, '../.env'),
      'utf8',
    ).split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      const v = t
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* no .env */
  }
}

async function main(): Promise<void> {
  loadEnv();
  const key = process.env.RENFLAIR_API_KEY ?? '';
  const phone = (process.env.TEST_PHONE ?? '').replace(/\D/g, '').slice(-10);
  if (!key) throw new Error('RENFLAIR_API_KEY is not set in backend/.env');
  if (!/^[6-9]\d{9}$/.test(phone))
    throw new Error('Set TEST_PHONE to your own 10-digit mobile number');

  const base = (
    process.env.RENFLAIR_BASE_URL ?? 'https://whatsapp.renflair.in'
  ).replace(/\/+$/, '');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const url = new URL(`${base}/V1.php`);
  url.searchParams.set('API', key);
  url.searchParams.set('PHONE', phone);
  url.searchParams.set('OTP', code);
  url.searchParams.set('COUNTRY', '91');

  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log('Response body (paste this back, it contains no key):');
  console.log(body.length > 2000 ? `${body.slice(0, 2000)}…` : body);
  console.log(
    `\nA test code was sent to the number ending ${phone.slice(-4)}. Check your WhatsApp: who is the sender, and what does the message say?`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
});
