'use client'

import { z } from 'zod'

const quantitySchema = z.union([z.string().min(1), z.number().finite()])

const stockSummaryItemSchema = z.object({
  catalogVariantId: z.string(),
  onHand: quantitySchema,
  reserved: quantitySchema,
  allocated: quantitySchema,
  available: quantitySchema,
})

const catalogStockSchema = z.object({
  inventoryProfile: z.unknown().nullable(),
  stockSummary: z.array(stockSummaryItemSchema),
  reorderStatus: z.object({
    state: z.enum(['no_profile', 'healthy', 'below_reorder_point', 'below_safety_stock']),
    available: quantitySchema,
    reorderPoint: quantitySchema,
    safetyStock: quantitySchema,
  }),
})

type ReorderState = z.infer<typeof catalogStockSchema>['reorderStatus']['state']

export type CatalogProductsStockCellProps = {
  value: unknown
}

function resolveQuantityClass(state: ReorderState): string {
  if (state === 'below_safety_stock') return 'text-status-error-text'
  if (state === 'below_reorder_point') return 'text-status-warning-text'
  if (state === 'healthy') return 'text-foreground'
  return 'text-muted-foreground'
}

export default function CatalogProductsStockCell({ value }: CatalogProductsStockCellProps) {
  const parsed = catalogStockSchema.safeParse(value)

  if (!parsed.success) {
    return <span className="text-sm text-muted-foreground">—</span>
  }

  const { available, state } = parsed.data.reorderStatus

  return (
    <span className={`text-sm tabular-nums ${resolveQuantityClass(state)}`}>
      {available}
    </span>
  )
}
