"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const catalogProductStatsSchema = z.object({
  totals: z.object({
    all: z.number(),
    active: z.number(),
    draft: z.number(),
    archived: z.number(),
  }),
  productsInActiveOffers: z.number(),
  catalogValue: z.number(),
  catalogValueCurrency: z.string().nullable(),
  catalogValueProductCount: z.number(),
})

export type CatalogProductStats = z.infer<typeof catalogProductStatsSchema>

export function useCatalogProductStats(scopeVersion?: number) {
  const t = useT()
  const loadError = t('catalog.products.list.error.stats', 'Failed to load product statistics')
  const [stats, setStats] = React.useState<CatalogProductStats | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const previousScopeVersion = React.useRef(scopeVersion)

  const reload = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const scopeChanged = previousScopeVersion.current !== scopeVersion
    previousScopeVersion.current = scopeVersion

    if (scopeChanged) setStats(null)
    setIsLoading(true)
    setError(null)

    void apiCall<unknown>('/api/catalog/products/stats')
      .then((response) => {
        if (cancelled) return
        const parsedStats = catalogProductStatsSchema.safeParse(response.result)
        if (!response.ok || !parsedStats.success) {
          setError(loadError)
          return
        }
        setStats(parsedStats.data)
      })
      .catch(() => {
        if (!cancelled) {
          setError(loadError)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [loadError, reloadToken, scopeVersion])

  return { stats, isLoading, error, reload }
}
