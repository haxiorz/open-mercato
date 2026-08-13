"use client"

import * as React from 'react'
import Link from 'next/link'
import { BriefcaseBusiness, Layers3, Package } from 'lucide-react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CrudForm,
  type CrudField,
  type CrudFormSubmitContext,
} from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  LookupSelect,
  type LookupSelectItem,
} from '@open-mercato/ui/backend/inputs/LookupSelect'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  createCrud,
  type CrudResponse,
} from '@open-mercato/ui/backend/utils/crud'
import {
  createCrudFormError,
  mapCrudServerErrorToFormErrors,
} from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import {
  AmountInput,
  type AmountValue,
} from '@open-mercato/ui/primitives/amount-input'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

const FORM_ID = 'catalog-product-quick-create-form'
const PUBLISH_BUTTON_ID = 'catalog-product-quick-create-publish'
const PRICING_FEATURE = 'catalog.pricing.manage'

const productQuickCreateFormSchema = z.object({
  title: z.string().trim().min(1, 'catalog.products.quickCreate.displayNameRequired'),
  productType: z.enum(['service', 'simple', 'subscription']),
  sku: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  description: z.string().optional(),
  defaultSalesUnit: z.string().optional(),
  basePrice: z
    .object({
      amount: z.string(),
      currency: z.string(),
    })
    .optional(),
})

type ProductQuickCreateFormValues = z.infer<typeof productQuickCreateFormSchema>
type ProductQuickCreateType = ProductQuickCreateFormValues['productType']
type LifecycleState = 'draft' | 'active'

type ProductQuickCreatePayload = {
  title: string
  productType: ProductQuickCreateType
  lifecycleState: LifecycleState
  sku?: string
  description?: string
  categoryIds?: string[]
  defaultUnit?: string
  defaultSalesUnit?: string
  basePrice?: {
    unitPriceNet: string
    currencyCode: string
  }
}

type ProductQuickCreateResponse = {
  id?: string | null
  basePriceApplied?: boolean
}

const featureCheckResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    granted: z.array(z.string()).optional(),
  })
  .passthrough()

const categoryListResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            parentName: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

const unitDictionaryResponseSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            value: z.string(),
            label: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

type UnitOption = {
  value: string
  label: string
}

export type ProductQuickCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

const INITIAL_VALUES: ProductQuickCreateFormValues = {
  title: '',
  productType: 'simple',
  sku: '',
  categoryId: null,
  description: '',
  defaultSalesUnit: '',
  basePrice: { amount: '', currency: '' },
}

function resolveProductType(value: unknown): ProductQuickCreateType {
  if (value === 'service' || value === 'subscription') return value
  return 'simple'
}

const FALLBACK_CURRENCY = 'PLN'

function resolveAmountValue(value: unknown, defaultCurrency: string): AmountValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { amount: '', currency: defaultCurrency }
  }
  const record = value as Record<string, unknown>
  return {
    amount: typeof record.amount === 'string' ? record.amount : '',
    currency:
      typeof record.currency === 'string' && record.currency.trim().length > 0
        ? record.currency
        : defaultCurrency,
  }
}

function resolveLifecycleState(context?: CrudFormSubmitContext): LifecycleState {
  return context?.submitter?.value === 'draft' ? 'draft' : 'active'
}

function toOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function ProductQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: ProductQuickCreateDialogProps) {
  const t = useT()
  const [productType, setProductType] = React.useState<ProductQuickCreateType>('simple')
  const [pricingAccess, setPricingAccess] = React.useState<'loading' | 'allowed' | 'denied'>('loading')
  const [unitOptions, setUnitOptions] = React.useState<UnitOption[]>([])
  const [unitsLoading, setUnitsLoading] = React.useState(false)
  const [defaultCurrency, setDefaultCurrency] = React.useState(FALLBACK_CURRENCY)
  const defaultCurrencyResolved = React.useRef(false)

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setProductType('simple')
        setPricingAccess('loading')
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setPricingAccess('loading')

    void (async () => {
      try {
        const response = await apiCall<unknown>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: [PRICING_FEATURE] }),
        })
        if (cancelled) return
        const parsed = featureCheckResponseSchema.safeParse(response.result)
        const granted = parsed.success ? parsed.data.granted ?? [] : []
        const allowed = response.ok && parsed.success && granted.includes(PRICING_FEATURE)
        setPricingAccess(allowed ? 'allowed' : 'denied')
      } catch {
        if (!cancelled) setPricingAccess('denied')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  React.useEffect(() => {
    if (!open || productType !== 'service' || unitOptions.length > 0) return
    let cancelled = false
    setUnitsLoading(true)

    void (async () => {
      try {
        const response = await apiCall<unknown>('/api/catalog/dictionaries/unit')
        if (cancelled) return
        const parsed = unitDictionaryResponseSchema.safeParse(response.result)
        const entries = response.ok && parsed.success ? parsed.data.entries ?? [] : []
        setUnitOptions(
          entries
            .map((entry) => ({ value: entry.value, label: entry.label ?? entry.value }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        )
      } catch {
        if (!cancelled) setUnitOptions([])
      } finally {
        if (!cancelled) setUnitsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, productType, unitOptions.length])

  React.useEffect(() => {
    if (!open || defaultCurrencyResolved.current) return
    let cancelled = false

    void (async () => {
      try {
        const response = await apiCall<unknown>('/api/catalog/dictionaries/currency')
        if (cancelled) return
        const parsed = unitDictionaryResponseSchema.safeParse(response.result)
        const entries = response.ok && parsed.success ? parsed.data.entries ?? [] : []
        const firstCurrency = entries[0]?.value?.trim().toUpperCase()
        if (firstCurrency) {
          defaultCurrencyResolved.current = true
          setDefaultCurrency(firstCurrency)
        }
      } catch {
        // keep the initial fallback currency when the dictionary is unavailable
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  const loadCategories = React.useCallback(
    async (query: string): Promise<LookupSelectItem[]> => {
      const params = new URLSearchParams({
        view: 'manage',
        status: 'active',
        page: '1',
        pageSize: '50',
      })
      const trimmedQuery = query.trim()
      if (trimmedQuery) params.set('search', trimmedQuery)

      try {
        const response = await apiCall<unknown>(`/api/catalog/categories?${params.toString()}`)
        const parsed = categoryListResponseSchema.safeParse(response.result)
        if (!response.ok || !parsed.success) return []
        return (parsed.data.items ?? []).map((category) => ({
          id: category.id,
          title: category.name?.trim() || category.id,
          subtitle: category.parentName ?? undefined,
        }))
      } catch {
        return []
      }
    },
    [],
  )

  const canManagePricing = pricingAccess === 'allowed'

  const fields = React.useMemo<CrudField[]>(() => {
    const adaptiveFields: CrudField[] = [
      {
        id: 'productType',
        label: t('catalog.products.quickCreate.type.label', 'Product type'),
        type: 'custom',
        component: ({ value, setValue }) => (
          <SegmentedControl
            value={resolveProductType(value)}
            onValueChange={(nextValue) => {
              const nextProductType = resolveProductType(nextValue)
              setValue(nextProductType)
              setProductType(nextProductType)
            }}
            aria-label={t('catalog.products.quickCreate.type.ariaLabel', 'Product type')}
            className="w-full"
          >
            <SegmentedControlItem value="service" className="flex-1">
              <BriefcaseBusiness className="size-4" aria-hidden="true" />
              {t('catalog.products.quickCreate.type.service', 'Service')}
            </SegmentedControlItem>
            <SegmentedControlItem value="simple" className="flex-1">
              <Package className="size-4" aria-hidden="true" />
              {t('catalog.products.quickCreate.type.physical', 'Physical')}
            </SegmentedControlItem>
            <SegmentedControlItem value="subscription" className="flex-1">
              <Layers3 className="size-4" aria-hidden="true" />
              {t('catalog.products.quickCreate.type.subscription', 'Subscription')}
            </SegmentedControlItem>
          </SegmentedControl>
        ),
      },
      {
        id: 'title',
        label: t('catalog.products.quickCreate.displayName', 'Display name'),
        type: 'text',
        required: true,
        placeholder: t(
          'catalog.products.quickCreate.displayNamePlaceholder',
          productType === 'service'
            ? 'e.g. Brand Identity Package'
            : productType === 'subscription'
              ? 'e.g. Growth'
              : 'e.g. Oak Lounge Chair',
        ),
      },
      {
        id: 'categoryId',
        label: t('catalog.products.quickCreate.category', 'Category'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue, disabled }) => (
          <LookupSelect
            value={typeof value === 'string' ? value : null}
            onChange={setValue}
            fetchItems={loadCategories}
            minQuery={2}
            disabled={disabled}
            searchPlaceholder={t(
              'catalog.products.quickCreate.categorySearch',
              'Search categories',
            )}
            clearLabel={t(
              'catalog.products.quickCreate.categoryClear',
              'Clear category',
            )}
            emptyLabel={t(
              'catalog.products.quickCreate.categoryEmpty',
              'No categories found',
            )}
            loadingLabel={t(
              'catalog.products.quickCreate.categoryLoading',
              'Searching categories…',
            )}
            selectLabel={t(
              'catalog.products.quickCreate.categorySelect',
              'Select category',
            )}
            selectedLabel={t(
              'catalog.products.quickCreate.categorySelected',
              'Selected',
            )}
            minQueryHintLabel={t(
              'catalog.products.quickCreate.categoryMinQuery',
              'Type at least 2 characters to search.',
            )}
            startTypingLabel={t(
              'catalog.products.quickCreate.categoryStartTyping',
              'Start typing to search categories.',
            )}
          />
        ),
      },
      {
        id: 'sku',
        label:
          productType === 'subscription'
            ? t('catalog.products.quickCreate.planCode', 'Plan code')
            : t('catalog.products.quickCreate.sku', 'SKU'),
        type: 'text',
        layout: 'half',
        placeholder: t('catalog.products.quickCreate.skuOptional', 'Optional'),
      },
      {
        id: 'description',
        label: t('catalog.products.quickCreate.description', 'Description'),
        type: 'textarea',
        rows: 3,
        placeholder: t(
          'catalog.products.quickCreate.descriptionPlaceholder',
          'Short description shown in the catalog.',
        ),
      },
    ]

    if (canManagePricing) {
      adaptiveFields.push({
        id: 'basePrice',
        label:
          productType === 'subscription'
            ? t('catalog.products.quickCreate.monthlyPrice', 'Monthly price')
            : t('catalog.products.quickCreate.basePrice', 'Base price'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue, disabled }) => (
          <AmountInput
            value={resolveAmountValue(value, defaultCurrency)}
            onChange={setValue}
            disabled={disabled}
            aria-label={
              productType === 'subscription'
                ? t('catalog.products.quickCreate.monthlyPrice', 'Monthly price')
                : t('catalog.products.quickCreate.basePrice', 'Base price')
            }
          />
        ),
      })
    } else if (pricingAccess === 'denied') {
      adaptiveFields.push({
        id: 'pricingLocked',
        label: '',
        type: 'custom',
        component: () => (
          <Alert status="feature" style="lighter" size="default">
            <AlertDescription>
              {t(
                'catalog.products.quickCreate.pricingLocked',
                'You need catalog pricing permission to set a price during creation.',
              )}
            </AlertDescription>
          </Alert>
        ),
      })
    }

    if (productType === 'service') {
      adaptiveFields.push({
        id: 'defaultSalesUnit',
        label: t('catalog.products.quickCreate.billingUnit', 'Billing unit'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue, disabled }) => (
          <Select
            value={typeof value === 'string' && value ? value : undefined}
            onValueChange={setValue}
            disabled={disabled || unitsLoading}
          >
            <SelectTrigger
              aria-label={t('catalog.products.quickCreate.billingUnit', 'Billing unit')}
            >
              <SelectValue
                placeholder={
                  unitsLoading
                    ? t('catalog.products.quickCreate.billingUnitLoading', 'Loading units…')
                    : t('catalog.products.quickCreate.billingUnitPlaceholder', 'Select unit')
                }
              />
            </SelectTrigger>
            <SelectContent>
              {unitOptions.map((unit) => (
                <SelectItem key={unit.value} value={unit.value}>
                  {unit.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      })
    }

    if (productType === 'simple' || productType === 'subscription') {
      adaptiveFields.push({
        id: `${productType}Hint`,
        label: '',
        type: 'custom',
        component: () => (
          <Alert status="information" style="lighter" size="default">
            <AlertDescription>
              {productType === 'simple'
                ? t(
                    'catalog.products.quickCreate.physicalHint',
                    'Stock and barcodes are managed after creation.',
                  )
                : t(
                    'catalog.products.quickCreate.subscriptionHint',
                    'Configure billing cycles, trials, seats, and entitlements in the follow-up plans phase.',
                  )}
            </AlertDescription>
          </Alert>
        ),
      })
    }

    return adaptiveFields
  }, [
    canManagePricing,
    defaultCurrency,
    loadCategories,
    pricingAccess,
    productType,
    t,
    unitOptions,
    unitsLoading,
  ])

  const handleSubmit = React.useCallback(
    async (
      values: ProductQuickCreateFormValues,
      context?: CrudFormSubmitContext,
    ) => {
      const title = values.title.trim()
      if (!title) {
        const message = t(
          'catalog.products.quickCreate.displayNameRequired',
          'Display name is required.',
        )
        throw createCrudFormError(message, { title: message })
      }

      const payload: ProductQuickCreatePayload = {
        title,
        productType: values.productType,
        lifecycleState: resolveLifecycleState(context),
      }
      const sku = toOptionalText(values.sku)
      const description = toOptionalText(values.description)
      const defaultSalesUnit = toOptionalText(values.defaultSalesUnit)
      const amount = values.basePrice?.amount.trim()

      if (sku) payload.sku = sku
      if (description) payload.description = description
      if (values.categoryId) payload.categoryIds = [values.categoryId]
      if (values.productType === 'service' && defaultSalesUnit) {
        payload.defaultUnit = defaultSalesUnit
        payload.defaultSalesUnit = defaultSalesUnit
      }
      if (canManagePricing && amount) {
        payload.basePrice = {
          unitPriceNet: amount,
          currencyCode: values.basePrice?.currency?.trim() || defaultCurrency,
        }
      }

      let response: CrudResponse<ProductQuickCreateResponse>
      try {
        response = await createCrud<ProductQuickCreateResponse>(
          'catalog/products',
          payload,
        )
      } catch (error: unknown) {
        const mapped = mapCrudServerErrorToFormErrors(error)
        const fieldErrors = { ...(mapped.fieldErrors ?? {}) }
        const nestedPriceError = fieldErrors['basePrice.unitPriceNet']
        if (nestedPriceError && !fieldErrors.basePrice) {
          fieldErrors.basePrice = nestedPriceError
        }
        throw createCrudFormError(
          mapped.message ??
            t('catalog.products.quickCreate.createError', 'Failed to create product.'),
          fieldErrors,
        )
      }

      flash(
        t('catalog.products.quickCreate.created', 'Product created.'),
        'success',
      )
      if (payload.basePrice && response.result?.basePriceApplied === false) {
        flash(
          t(
            'catalog.products.quickCreate.noRegularPriceKind',
            'The product was created, but no regular price kind is available for its base price.',
          ),
          'info',
        )
      }
      onCreated()
      handleOpenChange(false)
    },
    [canManagePricing, defaultCurrency, handleOpenChange, onCreated, t],
  )

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      event.preventDefault()
      const form = document.getElementById(FORM_ID)
      const publishButton = document.getElementById(PUBLISH_BUTTON_ID)
      if (form instanceof HTMLFormElement && publishButton instanceof HTMLButtonElement) {
        form.requestSubmit(publishButton)
      }
    },
    [],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl" onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('catalog.products.quickCreate.title', 'Add product')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'catalog.products.quickCreate.subtitle',
              'Create a new product, save as draft or publish.',
            )}
          </DialogDescription>
        </DialogHeader>

        <CrudForm<ProductQuickCreateFormValues>
          formId={FORM_ID}
          embedded
          hideFooterActions
          fields={fields}
          initialValues={INITIAL_VALUES}
          schema={productQuickCreateFormSchema}
          onSubmit={handleSubmit}
        />

        <DialogFooter
          leading={
            <div className="flex flex-col items-start gap-1">
              <span className="text-xs text-muted-foreground">
                {t(
                  'catalog.products.quickCreate.draftNote',
                  'Drafts stay in draft status until you publish them.',
                )}
              </span>
              <LinkButton asChild variant="gray" size="sm">
                <Link href="/backend/catalog/products/create">
                  {t(
                    'catalog.products.quickCreate.advancedEditor',
                    'Open advanced editor',
                  )}
                </Link>
              </LinkButton>
            </div>
          }
        >
          <Button
            type="submit"
            form={FORM_ID}
            name="lifecycleState"
            value="draft"
            variant="outline"
          >
            {t('catalog.products.quickCreate.saveDraft', 'Save as draft')}
          </Button>
          <Button
            id={PUBLISH_BUTTON_ID}
            type="submit"
            form={FORM_ID}
            name="lifecycleState"
            value="active"
          >
            {t('catalog.products.quickCreate.publish', 'Publish product')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ProductQuickCreateDialog
