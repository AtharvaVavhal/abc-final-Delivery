import { Fragment, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateCustomizationField } from '@/hooks/useCreateCustomizationField'
import { useUpdateCustomizationField } from '@/hooks/useUpdateCustomizationField'
import {
  customizationFieldSchema,
  toCreateCustomizationFieldPayload,
  type CustomizationFieldFormValues,
} from '@/schemas/adminProduct.schema'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { AdminCard } from '@/components/admin/AdminCard'
import { AdminTable } from '@/components/admin/AdminTable'
import { AdminSelect } from '@/components/admin/AdminSelect'
import { AdminEmptyState } from '@/components/admin/AdminEmptyState'
import { getApiErrorMessage } from '@/utils/apiError'
import type { CustomizationField } from '@/types/catalog'
import styles from './CustomizationFieldManager.module.css'

const FIELD_TYPE_LABELS: Record<CustomizationFieldFormValues['type'], string> = {
  TEXT: 'Text',
  LOGO_UPLOAD: 'Logo upload',
  IMAGE_UPLOAD: 'Image upload',
  DESIGN_FILE_UPLOAD: 'Design file upload',
  COLOR_SELECT: 'Color select',
  INSTRUCTIONS: 'Instructions',
}

const SURCHARGE_TYPE_LABELS: Record<CustomizationFieldFormValues['surchargeType'], string> = {
  NONE: 'No surcharge',
  FLAT: 'Flat (once per unit)',
  PER_CHARACTER: 'Per character',
}

const TABLE_COLUMNS = 5

interface CustomizationFieldManagerProps {
  productId: string
  fields: CustomizationField[]
  onFieldsChange: (fields: CustomizationField[]) => void
}

/** POST/PATCH /products/:id/customization-fields[/:fieldId] only — no
 * delete endpoint (matches variants: this surface only edits a field,
 * never removes it). `constraints` is edited as raw JSON text. */
export function CustomizationFieldManager({
  productId,
  fields,
  onFieldsChange,
}: CustomizationFieldManagerProps) {
  const headingId = useId()
  const createField = useCreateCustomizationField(productId)
  const updateField = useUpdateCustomizationField(productId)
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function handleCreate(values: CustomizationFieldFormValues) {
    try {
      const created = await createField.mutateAsync(toCreateCustomizationFieldPayload(values))
      onFieldsChange([...fields, created])
      setIsAdding(false)
    } catch {
      // Error surfaced via createField.isError in the add form.
    }
  }

  async function handleUpdate(fieldId: string, values: CustomizationFieldFormValues) {
    try {
      const updated = await updateField.mutateAsync({
        fieldId,
        payload: toCreateCustomizationFieldPayload(values),
      })
      onFieldsChange(fields.map((f) => (f.id === fieldId ? updated : f)))
      setEditingId(null)
    } catch {
      // Error surfaced via updateField.isError in the edit form.
    }
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Customization fields
        </h2>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setIsAdding((prev) => !prev)
            setEditingId(null)
          }}
        >
          {isAdding ? 'Cancel' : 'Add field'}
        </Button>
      </div>

      {isAdding && (
        <AdminCard as="section" title="New customization field">
          <CustomizationFieldFormFields
            defaultValues={{
              label: '',
              type: 'TEXT',
              isRequired: false,
              sortOrder: String(fields.length),
              helpText: '',
              constraints: '',
              surchargeType: 'NONE',
              surchargeAmount: '',
            }}
            onSubmit={(values) => void handleCreate(values)}
            isSubmitting={createField.isPending}
            submitError={createField.isError ? getApiErrorMessage(createField.error) : null}
            submitLabel="Add field"
          />
        </AdminCard>
      )}

      {fields.length === 0 ? (
        <AdminEmptyState
          title="No customization fields yet"
          description="Add a field to let customers personalize this product at checkout."
        />
      ) : (
        <AdminCard flush>
          <AdminTable caption="Product customization fields">
            <AdminTable.Head>
              <AdminTable.Row>
                <AdminTable.HeaderCell>Label</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Type</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Required</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Surcharge</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Actions</AdminTable.HeaderCell>
              </AdminTable.Row>
            </AdminTable.Head>
            <AdminTable.Body>
              {fields.map((field) => (
                <Fragment key={field.id}>
                  <AdminTable.Row>
                    <AdminTable.Cell>
                      <span className={styles.label}>{field.label}</span>
                    </AdminTable.Cell>
                    <AdminTable.Cell>{FIELD_TYPE_LABELS[field.type]}</AdminTable.Cell>
                    <AdminTable.Cell>{field.isRequired ? 'Required' : 'Optional'}</AdminTable.Cell>
                    <AdminTable.Cell>
                      {field.surchargeType === 'NONE'
                        ? '—'
                        : SURCHARGE_TYPE_LABELS[field.surchargeType]}
                    </AdminTable.Cell>
                    <AdminTable.Cell>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setEditingId(field.id)
                          setIsAdding(false)
                        }}
                      >
                        Edit
                      </Button>
                    </AdminTable.Cell>
                  </AdminTable.Row>
                  {editingId === field.id && (
                    <AdminTable.Row>
                      <AdminTable.Cell colSpan={TABLE_COLUMNS}>
                        <AdminCard as="section" title="Edit customization field">
                          <CustomizationFieldFormFields
                            defaultValues={{
                              label: field.label,
                              type: field.type,
                              isRequired: field.isRequired,
                              sortOrder: String(field.sortOrder),
                              helpText: field.helpText ?? '',
                              constraints: field.constraints
                                ? JSON.stringify(field.constraints)
                                : '',
                              surchargeType: field.surchargeType,
                              surchargeAmount:
                                field.surchargeAmount === '0.00' ? '' : field.surchargeAmount,
                            }}
                            onSubmit={(values) => void handleUpdate(field.id, values)}
                            onCancel={() => setEditingId(null)}
                            isSubmitting={updateField.isPending}
                            submitError={
                              updateField.isError ? getApiErrorMessage(updateField.error) : null
                            }
                            submitLabel="Save"
                          />
                        </AdminCard>
                      </AdminTable.Cell>
                    </AdminTable.Row>
                  )}
                </Fragment>
              ))}
            </AdminTable.Body>
          </AdminTable>
        </AdminCard>
      )}
    </section>
  )
}

interface CustomizationFieldFormFieldsProps {
  defaultValues: {
    label: string
    type: CustomizationFieldFormValues['type']
    isRequired: boolean
    sortOrder: string
    helpText: string
    constraints: string
    surchargeType: CustomizationFieldFormValues['surchargeType']
    surchargeAmount: string
  }
  onSubmit: (values: CustomizationFieldFormValues) => void
  onCancel?: () => void
  isSubmitting: boolean
  submitError: string | null
  submitLabel: string
}

function CustomizationFieldFormFields({
  defaultValues,
  onSubmit,
  onCancel,
  isSubmitting,
  submitError,
  submitLabel,
}: CustomizationFieldFormFieldsProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomizationFieldFormValues>({
    resolver: zodResolver(customizationFieldSchema),
    defaultValues,
  })

  return (
    <form className={styles.form} onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      {submitError && <Alert variant="error">{submitError}</Alert>}

      <div className={styles.formRow}>
        <TextField label="Label" error={errors.label?.message} {...register('label')} />

        <AdminSelect label="Type" {...register('type')}>
          {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </AdminSelect>

        <label className={styles.checkboxLabel}>
          <input type="checkbox" {...register('isRequired')} />
          Required
        </label>
      </div>

      <div className={styles.formRow}>
        <TextField
          label="Sort order"
          type="number"
          min={0}
          error={errors.sortOrder?.message}
          {...register('sortOrder')}
        />

        <AdminSelect label="Surcharge" {...register('surchargeType')}>
          {Object.entries(SURCHARGE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </AdminSelect>

        <TextField
          label="Surcharge amount (optional)"
          type="number"
          step="0.01"
          error={errors.surchargeAmount?.message}
          {...register('surchargeAmount')}
        />
      </div>

      <TextField
        label="Help text (optional)"
        error={errors.helpText?.message}
        {...register('helpText')}
      />

      <div className={styles.field}>
        <label htmlFor="field-constraints" className={styles.textareaLabel}>
          Constraints (optional JSON — e.g. {'{"maxLength":40}'} or {'{"options":["Red","Blue"]}'})
        </label>
        <textarea
          id="field-constraints"
          className={styles.textarea}
          rows={2}
          {...register('constraints')}
        />
        {errors.constraints?.message && (
          <p className={styles.errorText}>{errors.constraints.message}</p>
        )}
      </div>

      <div className={styles.formActions}>
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
