import { useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { AdminSelect } from '@/components/admin/AdminSelect'
import { getApiErrorMessage } from '@/utils/apiError'
import { useConnectStoreRazorpay, usePaymentAccounts } from '@/hooks/usePaymentAccounts'
import type { PaymentAccountMode } from '@/services/api/paymentAccounts'
import styles from '../../pages/admin/AdminSettingsPage.module.css'

export function PaymentAccountSettings() {
  const accountsQuery = usePaymentAccounts()
  const connectMutation = useConnectStoreRazorpay()
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [mode, setMode] = useState<PaymentAccountMode>('TEST')

  const account = accountsQuery.data?.items[0]
  const statusLabel = account?.status ?? 'not connected'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await connectMutation.mutateAsync({
      accountId: account?.id,
      mode,
      keyId: keyId.trim(),
      keySecret: keySecret.trim(),
      webhookSecret: webhookSecret.trim() || undefined,
    })
    setKeyId('')
    setKeySecret('')
    setWebhookSecret('')
  }

  return (
    <form className={styles.group} onSubmit={(e) => void onSubmit(e)}>
      <p className={styles.help}>
        Checkout uses this store&apos;s Razorpay account. Submit the key id and
        secret together; they are verified against Razorpay before anything is
        stored. Credentials are never shown again after connect.
      </p>
      <p className={styles.help}>
        Status: <strong>{statusLabel}</strong>
        {account?.mode ? ` · ${account.mode}` : ''}
        {account?.connectedAt ? ` · connected ${new Date(account.connectedAt).toLocaleString()}` : ''}
      </p>

      {accountsQuery.isError && (
        <Alert variant="error">{getApiErrorMessage(accountsQuery.error)}</Alert>
      )}
      {connectMutation.isError && (
        <Alert variant="error">{getApiErrorMessage(connectMutation.error)}</Alert>
      )}
      {connectMutation.isSuccess && (
        <Alert variant="success">Razorpay account connected.</Alert>
      )}

      <AdminSelect
        label="Mode"
        id="razorpay-mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as PaymentAccountMode)}
      >
        <option value="TEST">TEST</option>
        <option value="LIVE">LIVE</option>
      </AdminSelect>
      <TextField
        label="Razorpay key id"
        id="razorpay-key-id"
        value={keyId}
        onChange={(event) => setKeyId(event.target.value)}
        required
        autoComplete="off"
      />
      <TextField
        label="Razorpay key secret"
        id="razorpay-key-secret"
        type="password"
        revealable
        value={keySecret}
        onChange={(event) => setKeySecret(event.target.value)}
        required
        autoComplete="off"
      />
      <TextField
        label="Webhook secret (optional)"
        id="razorpay-webhook-secret"
        type="password"
        revealable
        value={webhookSecret}
        onChange={(event) => setWebhookSecret(event.target.value)}
        autoComplete="off"
      />
      <div className={styles.actions}>
        <Button
          type="submit"
          isLoading={connectMutation.isPending}
          disabled={connectMutation.isPending || !keyId.trim() || !keySecret.trim()}
        >
          {account ? 'Update and verify' : 'Connect Razorpay'}
        </Button>
      </div>
    </form>
  )
}
