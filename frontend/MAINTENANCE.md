# Store maintenance

In **Admin → Settings → Storefront → Maintenance mode**, choose `true` and
Save to enable maintenance, or `false` and Save to reopen the storefront.
After this implementation is deployed, changing the setting needs no redeploy.
It defaults to off and is stored per store by the existing backend.

The React route gate covers customer routes, including checkout, order pages,
registration and unknown paths. `/login` and `/admin/*` bypass the gate, with
the existing authentication and admin role checks still in force. The gate
checks the live public settings before mounting customer pages and every
30 seconds while the tab is active, plus on focus/reconnect. Check again
performs a real refetch. Failed reads show a retryable unavailable page; a
previously confirmed maintenance state is retained on failure. The URL stays
unchanged so reopening returns visitors to the route they requested.

The existing backend rejects new orders with HTTP 503 during maintenance.
This is a storefront pause, not a blanket API shutdown. Retry-payment for
existing unpaid orders and Razorpay webhooks remain unchanged. Payments
already in progress can still complete. As with the existing SPA, the
static HTML homepage snapshot can appear before JavaScript starts; the
live React gate does not use that snapshot to determine availability.

## Component integration

- Component: `src/components/ui/illos-maintenance-page.tsx`.
- Component styles: adjacent `illos-maintenance-page.module.css`.
- Global styles/tokens: `src/styles/global.css` and `src/styles/tokens.css`.
- `@/components/ui` already maps to `frontend/src/components/ui`. A separate
  repository-root `/components/ui` would be outside this application's source
  tree. Keep shared UI here so imports and future component tooling agree.
- React, TypeScript, React Router, TanStack Query and lucide-react are already
  installed. No new dependencies or context providers are needed.
- Dark, self-contained page (the storefront theme is light-only) built around
  the AB monogram in `src/components/ui/AbGlowMark.tsx`. The glow pulses
  slowly and stops under `prefers-reduced-motion`. Responsive type, full
  viewport height, keyboard-accessible controls. Text uses the app's
  `--font-sans`; no new fonts or dependencies.
- The gate supplies the store name, retry callback, loading state, errors and a
  "Contact us" link built only from what the store has published: WhatsApp,
  else email, else phone. If none is published the link is not rendered.
- Footer: location line, "A product of FORGE" using the exact
  `public/brand/forge/FORGE-horizontal-white-on-ink.png` asset (unmodified) linked
  to forgebuilds.in, and the "Store admin sign in" link (`/login` stays reachable).
- Illos artwork, workshop photo, fake progress/countdowns, placeholder status
  links and email collection are omitted: the backend has no end time or notify
  endpoint. The component also accepts custom title/description and className.

```tsx
import { IllosMaintenancePage } from '@/components/ui/illos-maintenance-page'

// The real app uses MaintenanceGate to supply a settings refetch callback.
export function Demo() {
  return <IllosMaintenancePage onRetry={() => window.location.reload()} />
}
```

## Optional Tailwind/shadcn setup

This application supports TypeScript and the shared UI directory, but does
not currently use Tailwind or have shadcn's `components.json`. The CSS module
port works without migrating the design system. For future Tailwind/shadcn
components in this existing Vite application:

1. From `frontend/`, run `npm install tailwindcss @tailwindcss/vite`.
2. Import `tailwindcss` from `@tailwindcss/vite` in `vite.config.ts` and add
   `tailwindcss()` to the existing plugins array, retaining the current plugins.
3. Add `@import "tailwindcss";` to the global CSS entry. Review Preflight and
   theme changes against the existing reset and tokens before adopting them.
4. Run `npx shadcn@latest init` from `frontend/`. Use
   `src/styles/global.css`, `@/components`, and `@/components/ui` for the CSS
   and component aliases. Preserve the existing UI components. The Vite and
   application TypeScript `@/*` aliases are already configured; mirror that
   alias into root `tsconfig.json` if the CLI requires it.

Sources: [Tailwind's Vite installation](https://tailwindcss.com/docs/installation/using-vite)
and [shadcn's existing Vite project setup](https://ui.shadcn.com/docs/installation/vite).

## Checks

From `frontend/`: `npm run lint`, `npx tsc -b`, `npm test`, and `npm run build`.
Maintenance coverage includes public API parsing/defaults, live gate changes,
admin/login exemptions, stale cache and request failures, and saving the
admin boolean control in both directions.
