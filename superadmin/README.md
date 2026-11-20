# AB Creations Superadmin

Dedicated static console for `https://superadmin.abcmanufactures.com`, deployed
as Vercel project `abc-superadmin` from this directory. The storefront remains
in its existing project. No frontend build or dependency installation is needed.

Production was deployed and the custom domain verified on 2026-11-20.
Fallback URL: `https://abc-superadmin-one.vercel.app`.
The subdomain was moved from `abc-creations` to `abc-superadmin`; apex and
www remain on `abc-creations`. Existing DNS works without a change.

The console provides sign-in and a paginated tenant overview. The existing
Railway API's `PlatformGuard` checks `platformRole === SUPER_ADMIN` on every
platform request. A merchant `ADMIN` account cannot access this overview.
This setup does not create accounts, grant privileges, or add MFA.

API traffic uses `/api/v1` on the console origin through the Vercel rewrite.
Keep this same-origin proxy: calling the shared API host directly would share
its session cookie with other applications using that host. The backend omits
the cookie Domain attribute, so proxied refresh cookies stay on the console
hostname. Access tokens remain in memory, and the console signs out after
15 minutes of inactivity. Private data is rendered with textContent, and the
deployment sends no-store, noindex, and a restrictive content security policy.

## Verify

With the frontend dependencies and Google Chrome installed:

```sh
node superadmin/smoke-test.mjs
# Also check the real deployment without credentials:
node superadmin/smoke-test.mjs --live --custom-domain
```

The browser smoke test uses mocked API responses to cover signed-out access,
merchant denial, authorized access, pagination, HTML escaping, token refresh,
reload, upstream failure, mobile width, sign-out, and idle expiry. Live
authenticated checks require an existing superadmin account.

## Deploy

Run from the repository root:

```sh
vercel link --yes --project abc-superadmin --scope atharvavavhal-gmailcoms-projects --cwd superadmin
vercel deploy --prod --yes --cwd superadmin
```

Only this directory is deployed. Vercel project linking is ignored by Git.
DNS for `abcmanufactures.com` is managed externally through GoDaddy. On
2026-11-20 Vercel reported `misconfigured: false` and HTTPS browser checks
passed. The existing CNAME is `f5342001b42263b4.vercel-dns-017.com`; the new
project's preferred CNAME is `8b9c982cf28c4f35.vercel-dns-017.com`. The current
record resolves to accepted Vercel addresses, so changing it was unnecessary
for activation. Use the project's current recommended value if DNS is edited
later.
