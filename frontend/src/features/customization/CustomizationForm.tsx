import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { CustomizationField } from '@/types/catalog'
import type { CustomizationValueDto } from '@/types/customization'
import { buildCustomizationSchema } from '@/schemas/customization.schema'
import { computeCustomizationsSurcharge, isFileFieldType } from '@/utils/customizationPricing'
import { toCustomizationValueDtos } from '@/utils/customizationValues'
import { formatPrice } from '@/utils/formatPrice'
import { TextCustomizationField } from './fields/TextCustomizationField'
import { ColorSelectField } from './fields/ColorSelectField'
import { FileUploadField } from './fields/FileUploadField'
import styles from './CustomizationForm.module.css'

export interface CustomizationFormState {
  values: CustomizationValueDto[]
  surcharge: number
  isValid: boolean
}

interface CustomizationFormProps {
  fields: CustomizationField[]
  /** Called on every value/validity change with the current state, mapped
   * into the exact shape AddCartItemDto.customizations expects. Pass a
   * memoized callback (useCallback) — this fires on every keystroke. */
  onChange?: (state: CustomizationFormState) => void
}

function buildDefaultValues(fields: CustomizationField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.id, '']))
}

/**
 * Renders one input per CustomizationField, already sorted by the backend
 * (sortOrder). Every field's value lives under its own id in a flat
 * Record<string, string> — for file fields that string is the
 * uploadedFileId returned by POST /uploads once the upload finishes
 * (FileUploadField), never the raw File.
 *
 * This is Phase 3's scope: the form itself, live validation matching
 * customization-validation.util.ts, and a running surcharge total.
 * Variant selection and the actual Add to Cart request are Phase 4's job
 * — see ProductDetailPage's comment at the call site.
 */
export function CustomizationForm({ fields, onChange }: CustomizationFormProps) {
  const schema = useMemo(() => buildCustomizationSchema(fields), [fields])
  const defaultValues = useMemo(() => buildDefaultValues(fields), [fields])

  const {
    register,
    control,
    formState: { errors },
  } = useForm<Record<string, string>>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onChange',
  })

  // useWatch (a subscription hook) rather than the form instance's own
  // watch() function — the latter is a plain function RHF returns fresh
  // per render that can't be memoized, which the React Compiler flags.
  const values = useWatch({ control, defaultValue: defaultValues })
  // Derive validity from the same Zod schema the resolver uses — RHF's
  // formState.isValid can lag a render behind Controller updates (file
  // upload onSuccess), which left Add to cart disabled after a successful
  // photo upload.
  const isValid = useMemo(
    () => schema.safeParse(values ?? defaultValues).success,
    [schema, values, defaultValues],
  )
  const surcharge = useMemo(
    () => computeCustomizationsSurcharge(fields, values),
    [fields, values],
  )

  useEffect(() => {
    onChange?.({
      values: toCustomizationValueDtos(fields, values),
      surcharge,
      isValid,
    })
  }, [fields, values, surcharge, isValid, onChange])

  if (fields.length === 0) {
    return null
  }

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>Customize this item</h2>
      {fields.map((field) => {
        const error = errors[field.id]?.message

        if (field.type === 'COLOR_SELECT') {
          return (
            <Controller
              key={field.id}
              name={field.id}
              control={control}
              render={({ field: controllerField }) => (
                <ColorSelectField
                  field={field}
                  value={controllerField.value}
                  onChange={controllerField.onChange}
                  error={error}
                />
              )}
            />
          )
        }

        if (isFileFieldType(field.type)) {
          return (
            <Controller
              key={field.id}
              name={field.id}
              control={control}
              render={({ field: controllerField }) => (
                <FileUploadField
                  field={field}
                  value={controllerField.value}
                  onChange={controllerField.onChange}
                  error={error}
                />
              )}
            />
          )
        }

        return (
          <TextCustomizationField
            key={field.id}
            field={field}
            register={register}
            error={error}
            liveValue={values[field.id]}
          />
        )
      })}

      {surcharge > 0 && (
        <p className={styles.surchargeTotal}>
          Customization total: <strong>{formatPrice(surcharge)}</strong>
        </p>
      )}
    </div>
  )
}
