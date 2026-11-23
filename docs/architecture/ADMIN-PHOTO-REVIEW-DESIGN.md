# Admin photo review — design proposal

Status: **proposal, for owner approval. Nothing here is built.**
Scope: let an admin approve a customer's uploaded photo before production, or ask for a better one.

## 1. Problem

Customers upload a photo for personalised products (lamps, mugs, T-shirts…). Today the photo sits on the order as a file attached to a customization field. Nothing records whether anyone has looked at it, so a blurry, cropped or unsuitable photo is only discovered when production starts — or after printing.

The admin needs to: see which orders have a photo waiting, look at it properly, and either approve it or send it back with a reason. The customer needs to be told, and to be able to replace it.

## 2. What exists today (verified in the code)

- A photo is an `UploadedFile` (private Cloudinary delivery, signed URLs) linked from `OrderItemCustomization.uploadedFileId`. The file's `format` and `bytes` are stored; **width and height are not**.
- The order lifecycle is a strict transition table (`order-state-machine.ts`): `PENDING_PAYMENT → PAID → CONFIRMED → IN_PRODUCTION → SHIPPED → DELIVERED` (plus cancel/refund/failed paths), applied as compare-and-swap.
- Notifications go through an outbox with three event types (`ORDER_PAID`, `ORDER_STATUS_CHANGED`, `PASSWORD_RESET_REQUESTED`) and email templates.
- The admin Overview already has "Needs attention" tiles and the Orders list has status tabs.

## 3. Decision: a review state on the photo, not a new order status

**Option A (recommended): per-photo review state.** Add a review status to each file customization. Leave `OrderStatus` and the state machine untouched.

**Option B: new order statuses** (e.g. `AWAITING_CUSTOMER_PHOTO`). Rejected: it changes the transition table, every status label, filter, dashboard count, email and customer-facing order page, and it cannot express an order with several photos in different states.

Why A fits: payment is captured at checkout regardless of the photo, so "waiting on a photo" is not a payment or fulfilment state; it is a property of the photo. An order can hold several photos, each reviewed on its own.

## 4. Data model

New enum `PhotoReviewStatus`: `PENDING`, `APPROVED`, `CHANGES_REQUESTED`.

On `order_item_customizations` (file-type rows only):

| column | purpose |
|---|---|
| `reviewStatus` | `PENDING` on creation when `uploadedFileId` is set; `NULL` for text-only rows |
| `reviewNote` | reason shown to the customer when changes are requested |
| `reviewedAt`, `reviewedByUserId` | who decided and when |

On `uploaded_files`: nullable `width`, `height` (taken from Cloudinary's upload response, so the panel can show resolution; null for older files).

**Backfill (important):** existing rows on orders already `IN_PRODUCTION` or later → `APPROVED`; rows on `PAID`/`CONFIRMED` orders → `PENDING`; rows on cancelled/refunded/failed orders → left `NULL`. Decide this before any migration runs.

## 5. Rules

1. **Production gate.** `CONFIRMED → IN_PRODUCTION` is refused (409, with the reason) while any photo on the order is `PENDING` or `CHANGES_REQUESTED`. Open question 2 asks whether this should be a hard stop or a warning.
2. Approving or requesting changes is only allowed while the order is `PAID` or `CONFIRMED`.
3. A customer replacing a photo resets that photo to `PENDING` and clears the note.
4. Orders with no photo field are unaffected (`photoReview = NONE`).
5. Every decision is written to the existing tenant audit log.

## 6. API

- **List:** `GET /admin/orders` rows gain `photoReview: NONE | TO_REVIEW | APPROVED | CHANGES_REQUESTED` (the worst case across the order's photos, computed from the rows). New filter `?photoReview=`.
- **Dashboard:** `ordersByStatus` is unchanged; add `photosAwaitingReview` for the Overview tile.
- **Decide:** `PATCH /admin/orders/:orderId/customizations/:customizationId/review` with `{ decision: 'APPROVE' | 'REQUEST_CHANGES', note? }`. `note` is required for `REQUEST_CHANGES`. Idempotent on repeat.
- **Detail:** admin order detail returns, per photo: short-lived signed URL, format, size, width/height if known, the customer's text instructions for that item, current review state and note.
- **Customer replace:** `POST /orders/:orderId/customizations/:customizationId/replace` `{ uploadedFileId }`, owner-only, allowed only in `CHANGES_REQUESTED` and while the order is `PAID`/`CONFIRMED`.
- **Permission:** a dedicated `orders:review_photos` so staff can review without full order-write rights (the permission catalogue is already granular).

## 7. Notifications

New outbox event `ORDER_PHOTO_CHANGES_REQUESTED` and an email template: order number, the admin's note, and a link to the order page to upload a new photo. Email only in v1 (open question 3 covers WhatsApp, which the OTP login already uses).

## 8. Admin UI

- **Orders list:** a "Photo" column with the dot-and-word pill (To review / Approved / New photo needed), and a **Photo review** tab ahead of the status tabs.
- **Review panel** (side panel on the list at wide widths, a section on the order detail page otherwise), as shown in the concept board: large preview, file name/size/resolution, the customer's instructions, checks, and two actions — **Approve for production** and **Ask for a new photo** (opens a note field).
- **Overview:** a "Photos awaiting review" tile in Needs attention, linking to the filtered list.
- Resolution/size are shown as facts, not as pass/fail: judging whether a face is in frame or the background is busy stays a human decision. The concept's "Looks fine" style checks are **not** automated in v1.

## 9. Customer UI

The order page shows each photo's state. In `CHANGES_REQUESTED` it shows the admin's note and an **Upload a new photo** control that reuses the existing upload field. After approval it shows "Photo approved".

## 10. Edge cases

- Several photos on one order: each is reviewed separately; the order gate waits for all.
- Order cancelled or refunded while a photo is pending: the photo is ignored by the gate and the tile counts.
- Customer replaces a photo that was already approved (only possible if the order is still `PAID`/`CONFIRMED`): resets to `PENDING`.
- Photos are private: the panel uses short-lived signed URLs and never a public link.
- No automatic reminders or expiry in v1.

## 11. Delivery plan

1. **Backend:** migration (+ backfill), review endpoint, production gate, list/detail fields, audit log, tests.
2. **Admin UI:** list pill/column/tab, review panel, Overview tile.
3. **Customer flow:** replace endpoint, order-page state, email template + outbox event.
4. **Later (optional):** WhatsApp message, reminders, richer checks.

Each phase is deployable on its own; phase 1 is safe to ship before any UI because nothing changes for customers until phase 3, and the gate only bites when a photo is pending.

## 12. Open questions for the owner

1. Is **every** photo reviewed by hand, or may some products skip review?
2. Should the production gate be a **hard block**, or a warning the owner can override?
3. Tell customers by **email only**, or also WhatsApp?
4. How long may a customer replace a photo — until production starts, or a fixed number of days?
5. Which staff roles may review photos?
6. For old orders: confirm the backfill rule in section 4.
