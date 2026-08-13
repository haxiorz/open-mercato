"use client"

import * as React from 'react'
import { CircleCheck, Package, Tags, Wallet } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CatalogProductStats } from './useCatalogProductStats'

export type ProductsHeroProps = {
  stats: CatalogProductStats | null
  isLoading: boolean
  error: string | null
  actions?: React.ReactNode
}

type HeroKpiDef = {
  key: string
  label: string
  display: string | null
  caption: string | null
  icon: React.ComponentType<{ className?: string }>
}

function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return value.toLocaleString()
}

function formatCompactAmount(value: number, currency: string | null): string {
  const formatted = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
  return currency ? `${formatted} ${currency}` : formatted
}

function formatAverageAmount(value: number, count: number, currency: string | null): string | null {
  if (!count || !Number.isFinite(value)) return null
  const average = value / count
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(average)
  return currency ? `${formatted} ${currency}` : formatted
}

function HeroKpiCard({
  def,
  isLoading,
  error,
}: {
  def: HeroKpiDef
  isLoading: boolean
  error: string | null
}) {
  const Icon = def.icon
  return (
    <div className="flex flex-1 flex-col gap-2.5 rounded-xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-brand-violet/10 text-brand-violet">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-medium text-muted-foreground">{def.label}</span>
      </div>
      <div className="text-3xl font-bold leading-none tracking-tight text-foreground">
        {isLoading ? (
          <span
            role="status"
            aria-label={def.label}
            className="inline-block h-7 w-16 animate-pulse rounded bg-muted-foreground/15"
          />
        ) : error || def.display === null ? (
          <span className="text-base font-medium text-muted-foreground">—</span>
        ) : (
          def.display
        )}
      </div>
      {!isLoading && !error && def.caption ? (
        <span className="text-xs text-muted-foreground">{def.caption}</span>
      ) : null}
    </div>
  )
}

export function ProductsHero({ stats, isLoading, error, actions }: ProductsHeroProps) {
  const t = useT()

  const total = stats?.totals.all ?? null
  const active = stats?.totals.active ?? null
  const inOffers = stats?.productsInActiveOffers ?? null
  const catalogValue = stats?.catalogValue ?? null
  const catalogCurrency = stats?.catalogValueCurrency ?? null
  const catalogValueProductCount = stats?.catalogValueProductCount ?? null

  const activePercent =
    total && active !== null && total > 0 ? Math.round((active / total) * 100) : null
  const averagePerItem =
    catalogValue !== null && catalogValueProductCount
      ? formatAverageAmount(catalogValue, catalogValueProductCount, catalogCurrency)
      : null

  const kpis: HeroKpiDef[] = [
    {
      key: 'total',
      label: t('catalog.products.list.kpi.total', 'Total products'),
      display: formatCount(total),
      caption: null,
      icon: Package,
    },
    {
      key: 'active',
      label: t('catalog.products.list.kpi.active', 'Active'),
      display: formatCount(active),
      caption:
        activePercent !== null
          ? t('catalog.products.list.kpi.activeCaption', '{percent}% of catalog', {
              percent: activePercent,
            })
          : null,
      icon: CircleCheck,
    },
    {
      key: 'inActiveOffers',
      label: t('catalog.products.list.kpi.inActiveOffers', 'In active offers'),
      display: formatCount(inOffers),
      caption: null,
      icon: Tags,
    },
    {
      key: 'catalogValue',
      label: t('catalog.products.list.kpi.catalogValue', 'Catalog value'),
      display: catalogValue !== null ? formatCompactAmount(catalogValue, catalogCurrency) : null,
      caption: averagePerItem
        ? t('catalog.products.list.kpi.catalogValueCaption', 'avg {amount} / item', {
            amount: averagePerItem,
          })
        : null,
      icon: Wallet,
    },
  ]

  return (
    <div className="flex flex-col gap-5 overflow-hidden rounded-xl bg-gradient-to-br from-muted via-card to-brand-violet/10 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('catalog.products.list.heroTitle', 'Product catalog')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('catalog.products.list.heroSubtitle', 'Services, physical goods & subscriptions')}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((def) => (
          <HeroKpiCard key={def.key} def={def} isLoading={isLoading} error={error} />
        ))}
      </div>
    </div>
  )
}
