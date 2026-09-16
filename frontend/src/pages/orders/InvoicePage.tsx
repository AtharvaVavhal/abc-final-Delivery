import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useInvoice, useAdminInvoice } from '@/hooks/useInvoice'
import { ErrorState } from '@/components/ui/ErrorState'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatPrice } from '@/utils/formatPrice'
import { formatDate } from '@/utils/formatDate'
import { getApiErrorMessage } from '@/utils/apiError'
import { Seo } from '@/seo/Seo'
import { orderDetailPath } from '@/constants/routes'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './InvoicePage.module.css'

/** Circular AB Creations seal used only on the printed invoice letterhead. */
const INVOICE_LOGO_SRC = '/brand/ab-creations/invoice-logo.jpg'

/**
 * Print-friendly invoice, rendered entirely from server-authoritative
 * data (GET /orders/:id/invoice). No tax is computed here. "Print / save
 * as PDF" uses the browser's own print dialog — there is no fake file
 * download. Blank seller fields and the missing GST rate are shown as
 * explicit pending notices, never invented.
 */
export function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const storeName = useStoreName()
  const isAdmin = user?.role === 'ADMIN'
  // An admin viewing any order uses the admin endpoint (the customer one
  // is owner-scoped and would 404); a customer uses their own.
  const customerQuery = useInvoice(isAdmin ? undefined : id)
  const adminQuery = useAdminInvoice(isAdmin ? id : undefined)
  const { data: invoice, isPending, isError, error } = isAdmin
    ? adminQuery
    : customerQuery

  if (isPending) {
    return (
      <section className={styles.wrap}>
        <Seo title="Invoice" noindex />
        <Skeleton className={styles.skeletonBlock} label="Loading invoice" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className={styles.wrap}>
        <Seo title="Invoice" noindex />
        <ErrorState title="Invoice" message={getApiErrorMessage(error)} />
      </section>
    )
  }

  return (
    <section className={styles.wrap}>
      <Seo title={`Invoice ${invoice.invoiceNumber}`} noindex />
      <div className={styles.toolbar}>
        {!isAdmin && (
          <Link to={orderDetailPath(invoice.orderId)} className={styles.backLink}>
            ← Back to order
          </Link>
        )}
        <Button type="button" onClick={() => window.print()}>
          Print / save as PDF
        </Button>
      </div>

      <article className={styles.sheet} data-invoice-sheet>
        <header className={styles.letterhead}>
          <img
            className={styles.logo}
            src={INVOICE_LOGO_SRC}
            alt={storeName}
            width={1024}
            height={1024}
            decoding="async"
          />
          <div className={styles.docMeta}>
            <h1 className={styles.title}>
              {invoice.taxRatePercent ? 'Tax invoice' : 'Invoice'}
            </h1>
            <p className={styles.meta}>
              <span className={styles.metaRow}>
                <span className={styles.metaLabel}>No.</span>
                <strong>{invoice.invoiceNumber}</strong>
              </span>
              <span className={styles.metaRow}>
                <span className={styles.metaLabel}>Issued</span>
                <span>{formatDate(invoice.issuedAt)}</span>
              </span>
              <span className={styles.metaRow}>
                <span className={styles.metaLabel}>Order</span>
                <span>
                  {invoice.orderNumber} · {formatDate(invoice.orderPlacedAt)}
                </span>
              </span>
            </p>
          </div>
        </header>

        <div className={styles.parties}>
          <section aria-labelledby="inv-seller">
            <h2 id="inv-seller" className={styles.partyHeading}>
              From
            </h2>
            {invoice.seller.detailsPending ? (
              <p className={styles.pending}>
                Seller details pending — not published yet.
              </p>
            ) : (
              <p className={styles.address}>
                <span className={styles.partyName}>{invoice.seller.legalName}</span>
                <br />
                {invoice.seller.address}
                {invoice.seller.gstin && (
                  <>
                    <br />
                    GSTIN: {invoice.seller.gstin}
                  </>
                )}
                {invoice.seller.state && (
                  <>
                    <br />
                    {invoice.seller.state}
                  </>
                )}
              </p>
            )}
          </section>
          <section aria-labelledby="inv-buyer">
            <h2 id="inv-buyer" className={styles.partyHeading}>
              Bill to
            </h2>
            <p className={styles.address}>
              <span className={styles.partyName}>{invoice.buyer.name}</span>
              <br />
              {invoice.buyer.addressLine1}
              {invoice.buyer.addressLine2 && (
                <>
                  <br />
                  {invoice.buyer.addressLine2}
                </>
              )}
              <br />
              {invoice.buyer.city}, {invoice.buyer.state} {invoice.buyer.postalCode}
              <br />
              {invoice.buyer.country}
            </p>
          </section>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className={styles.num}>
                Unit price
              </th>
              <th scope="col" className={styles.num}>
                Qty
              </th>
              <th scope="col" className={styles.num}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i}>
                <td>
                  {line.description}
                  {line.variantLabel && (
                    <span className={styles.variant}> · {line.variantLabel}</span>
                  )}
                </td>
                <td className={styles.num}>{formatPrice(line.unitPrice)}</td>
                <td className={styles.num}>{line.quantity}</td>
                <td className={styles.num}>{formatPrice(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className={styles.totals}>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatPrice(invoice.subtotal)}</dd>
          </div>
          {Number(invoice.discountAmount) > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>−{formatPrice(invoice.discountAmount)}</dd>
            </div>
          )}
          {Number(invoice.shippingFee) > 0 && (
            <div>
              <dt>Shipping</dt>
              <dd>{formatPrice(invoice.shippingFee)}</dd>
            </div>
          )}
          {Number(invoice.taxAmount) > 0 && (
            <>
              <div>
                <dt>Taxable amount</dt>
                <dd>{formatPrice(invoice.taxableAmount)}</dd>
              </div>
              <div>
                <dt>
                  GST
                  {invoice.taxRatePercent ? ` @ ${invoice.taxRatePercent}%` : ''}
                  {invoice.taxMode === 'INCLUSIVE' ? ' (included in price)' : ''}
                </dt>
                <dd>{formatPrice(invoice.taxAmount)}</dd>
              </div>
            </>
          )}
          <div className={styles.grand}>
            <dt>Total</dt>
            <dd>{formatPrice(invoice.grandTotal)}</dd>
          </div>
        </dl>

        {invoice.notes.length > 0 && (
          <footer className={styles.notes}>
            <h2 className={styles.partyHeading}>Notes</h2>
            <ul>
              {invoice.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </footer>
        )}
      </article>
    </section>
  )
}
