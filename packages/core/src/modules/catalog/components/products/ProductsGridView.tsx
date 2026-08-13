"use client"

import * as React from 'react'
import { ChevronRight, Image as ImageIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardFooter } from '@open-mercato/ui/primitives/card'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  commercialKind,
  commercialKindLabelKey,
  deriveProductDisplayStatus,
  formatProductPrice,
  productLifecycleLabelKey,
  productStatusDot,
  productStatusMap,
  type ProductDisplayStatus,
} from '../../lib/productPresentation'

type ProductPricingScope = {
  variant_id?: string | null
  offer_id?: string | null
  channel_id?: string | null
  user_id?: string | null
  user_group_id?: string | null
  customer_id?: string | null
  customer_group_id?: string | null
}

type ProductListPricing = {
  kind?: string | null
  price_kind_id?: string | null
  price_kind_code?: string | null
  currency_code?: string | null
  unit_price_net?: string | null
  unit_price_gross?: string | null
  min_quantity?: number | null
  max_quantity?: number | null
  tax_rate?: string | null
  scope?: ProductPricingScope | null
}

export type ProductGridItem = {
  id: string
  title: string
  sku: string | null
  productType: string
  lifecycleState: string | null
  isActive: boolean
  defaultMediaUrl: string | null
  categories: string[]
  pricing: ProductListPricing | null
  salesUnit: string | null
  variantsCount: number
}

export type ProductsGridViewProps = {
  items: ProductGridItem[]
  isLoading: boolean
  emptyState: React.ReactNode
  onOpen: (item: ProductGridItem) => void
}

const SKELETON_CARD_IDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const

const statusFallbacks: Record<ProductDisplayStatus, string> = {
  active: 'Active',
  draft: 'Draft',
  archived: 'Archived',
  discontinued: 'Discontinued',
}

const commercialKindFallbacks: Record<'physical' | 'service' | 'subscription', string> = {
  physical: 'Physical',
  service: 'Service',
  subscription: 'Subscription',
}

function ProductGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SKELETON_CARD_IDS.map((cardId) => (
        <Card key={cardId} className="gap-4 p-4 py-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded" />
            <Skeleton className="h-6 w-16 rounded" />
          </div>
          <Skeleton className="h-5 w-28" />
          <div className="border-t border-border pt-4">
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function ProductsGridView({
  items,
  isLoading,
  emptyState,
  onOpen,
}: ProductsGridViewProps) {
  const t = useT()

  if (isLoading) return <ProductGridSkeleton />
  if (items.length === 0) return <>{emptyState}</>

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const displayStatus = deriveProductDisplayStatus({
          lifecycleState: item.lifecycleState,
          isActive: item.isActive,
        })
        const titleId = `product-grid-${item.id}-title`
        const categoryName = item.categories[0]
        const mediaUrl = item.defaultMediaUrl?.trim() || null
        const kind = commercialKind(item.productType)

        return (
          <Card
            key={item.id}
            className="relative gap-0 rounded-xl py-0 transition-colors"
          >
            <Button
              type="button"
              variant="ghost"
              aria-labelledby={titleId}
              onClick={() => onOpen(item)}
              className="absolute inset-0 h-auto w-auto rounded-xl bg-transparent p-0 text-card-foreground shadow-none hover:bg-muted/30 hover:text-card-foreground"
            />

            <div className="pointer-events-none relative flex flex-1 flex-col p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
                  {mediaUrl ? (
                    <img
                      src={mediaUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="size-4" aria-hidden="true" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div id={titleId} className="truncate font-semibold text-foreground">
                    {item.title}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {item.sku?.trim() || '—'}
                  </div>
                </div>

                <StatusBadge
                  variant={productStatusMap[displayStatus]}
                  dot={productStatusDot[displayStatus]}
                  className="shrink-0"
                >
                  {t(productLifecycleLabelKey(displayStatus), statusFallbacks[displayStatus])}
                </StatusBadge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {categoryName ? (
                  <Tag variant="neutral" shape="square">
                    {categoryName}
                  </Tag>
                ) : null}
                <Tag variant="neutral" shape="square">
                  {t(commercialKindLabelKey(kind), commercialKindFallbacks[kind])}
                </Tag>
              </div>

              <div className="mt-6 font-semibold text-foreground">
                {(() => {
                  const price = formatProductPrice(item.pricing, item.salesUnit)
                  if (!price.amount) return <span className="text-muted-foreground">—</span>
                  return (
                    <>
                      {price.amount}
                      {price.suffix ? (
                        <span className="ml-1 text-sm font-normal text-muted-foreground">
                          {price.suffix}
                        </span>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            </div>

            <CardFooter className="pointer-events-none relative border-t border-border px-4 py-3">
              <LinkButton
                type="button"
                variant="gray"
                size="sm"
                className="pointer-events-auto ml-auto"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpen(item)
                }}
              >
                {t('catalog.products.list.variants', 'Variants ({count})', {
                  count: item.variantsCount,
                })}
                <ChevronRight aria-hidden="true" />
              </LinkButton>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
