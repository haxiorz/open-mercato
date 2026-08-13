import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export type ProductCommercialKind = 'physical' | 'service' | 'subscription'
export type ProductDisplayStatus = 'active' | 'draft' | 'archived' | 'discontinued'

export const productStatusMap: StatusMap<ProductDisplayStatus> = {
  active: 'success',
  draft: 'neutral',
  archived: 'neutral',
  discontinued: 'error',
}

export const productStatusDot: Record<ProductDisplayStatus, boolean> = {
  active: true,
  draft: false,
  archived: false,
  discontinued: true,
}

export function commercialKind(productType: string): ProductCommercialKind {
  if (productType === 'subscription') return 'subscription'
  if (productType === 'service' || productType === 'virtual' || productType === 'downloadable') {
    return 'service'
  }
  return 'physical'
}

export function deriveProductDisplayStatus(input: {
  lifecycleState?: string | null
  isActive?: boolean | null
}): ProductDisplayStatus {
  if (input.lifecycleState === 'archived') return 'archived'
  if (input.lifecycleState === 'draft') return 'draft'
  if ((input.lifecycleState === 'active' || input.lifecycleState == null) && input.isActive === false) {
    return 'discontinued'
  }
  return 'active'
}

export function productLifecycleLabelKey(
  status: ProductDisplayStatus,
): `catalog.products.lifecycle.${ProductDisplayStatus}` {
  return `catalog.products.lifecycle.${status}`
}

export function commercialKindLabelKey(
  kind: ProductCommercialKind,
): `catalog.products.commercialKind.${ProductCommercialKind}` {
  return `catalog.products.commercialKind.${kind}`
}

export function formatProductAmount(
  value: string | number | null | undefined,
  currency?: string | null,
): string | null {
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(numeric)) return null
  const amount = numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const code = currency?.trim().toUpperCase()
  return code ? `${amount} ${code}` : amount
}

export function productBillingSuffix(salesUnit?: string | null): string | null {
  const unit = salesUnit?.trim()
  return unit ? `/${unit}` : null
}

export type ProductListPricingShape = {
  currency_code?: string | null
  unit_price_net?: string | null
  unit_price_gross?: string | null
}

export function formatProductPrice(
  pricing: ProductListPricingShape | null | undefined,
  salesUnit?: string | null,
  fallbackCurrency?: string | null,
): { amount: string; suffix: string | null } | { amount: null; suffix: null } {
  if (!pricing) return { amount: null, suffix: null }
  const net = pricing.unit_price_net?.trim()
  const gross = pricing.unit_price_gross?.trim()
  const unit = net && net.length ? net : gross && gross.length ? gross : null
  const currency = pricing.currency_code ?? fallbackCurrency ?? null
  const amount = unit !== null ? formatProductAmount(unit, currency) : null
  if (!amount) return { amount: null, suffix: null }
  return { amount, suffix: productBillingSuffix(salesUnit) }
}
