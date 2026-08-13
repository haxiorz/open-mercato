"use client"

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/catalog/extension-points'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, updateCrud, buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Package, RefreshCcw, Wrench } from 'lucide-react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { E } from '#generated/entities.ids.generated'
import { CATALOG_PRODUCT_LIFECYCLE_STATES } from '../../data/types'
import {
  commercialKind,
  commercialKindLabelKey,
  deriveProductDisplayStatus,
  formatProductPrice,
  productLifecycleLabelKey,
  productStatusDot,
  productStatusMap,
} from '../../lib/productPresentation'
import { ProductImageCell } from './ProductImageCell'
import { ProductsHero } from './ProductsHero'
import { useCatalogProductStats } from './useCatalogProductStats'
import { ProductsGridView, type ProductGridItem } from './ProductsGridView'
import { ProductQuickCreateDialog } from './ProductQuickCreateDialog'
import { ProductsToolbar } from './ProductsToolbar'

type PricingScope = {
  variant_id?: string | null
  offer_id?: string | null
  channel_id?: string | null
  user_id?: string | null
  user_group_id?: string | null
  customer_id?: string | null
  customer_group_id?: string | null
}

type PricingInfo = {
  kind?: string | null
  price_kind_id?: string | null
  price_kind_code?: string | null
  currency_code?: string | null
  unit_price_net?: string | null
  unit_price_gross?: string | null
  min_quantity?: number | null
  max_quantity?: number | null
  tax_rate?: string | null
  scope?: PricingScope | null
} | null

type OfferInfo = {
  id: string
  channelId: string
  channelName?: string | null
  channelCode?: string | null
  title: string
  description?: string | null
  isActive: boolean
}

type CategoryInfo = {
  id: string
  name?: string | null
}

export type ProductRow = {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  sku?: string | null
  handle?: string | null
  product_type?: string | null
  status_entry_id?: string | null
  lifecycle_state?: string | null
  variants_count?: number
  primary_currency_code?: string | null
  default_unit?: string | null
  default_media_id?: string | null
  default_media_url?: string | null
  is_configurable?: boolean
  is_active?: boolean
  metadata?: Record<string, unknown> | null
  custom_fieldset_code?: string | null
  created_at?: string
  updated_at?: string
  offers?: OfferInfo[]
  categories?: CategoryInfo[]
  pricing?: PricingInfo
} & Record<string, unknown>

const VIEW_MODE_STORAGE_PREFIX = 'om.catalog.products.viewMode'

type ProductsResponse = {
  items?: ProductRow[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 25
const ENTITY_ID = E.catalog.catalog_product

const COMMERCIAL_KIND_ICON: Record<'physical' | 'service' | 'subscription', React.ComponentType<{ className?: string }>> = {
  physical: Package,
  service: Wrench,
  subscription: RefreshCcw,
}

const COMMERCIAL_KIND_FALLBACK: Record<'physical' | 'service' | 'subscription', string> = {
  physical: 'Physical',
  service: 'Service',
  subscription: 'Subscription',
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function renderOffers(offers: OfferInfo[] | undefined): React.ReactNode {
  if (!offers || offers.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  const visible = offers.slice(0, 3)
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((offer) => {
        const label =
          typeof offer.channelName === 'string' && offer.channelName.trim().length
            ? offer.channelName.trim()
            : typeof offer.title === 'string' && offer.title.trim().length
              ? offer.title.trim()
              : offer.channelId
        const badgeTitle =
          typeof offer.channelCode === 'string' && offer.channelCode.trim().length ? offer.channelCode : undefined
        return (
          <span
            key={offer.id}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
              offer.isActive ? 'bg-secondary/80 text-secondary-foreground' : 'bg-muted text-muted-foreground'
            }`}
            title={badgeTitle}
          >
            {label}
          </span>
        )
      })}
      {offers.length > visible.length ? (
        <span className="text-xs text-muted-foreground">+{offers.length - visible.length}</span>
      ) : null}
    </div>
  )
}

export type ProductsDataTableSnapshot = {
  search: string
  filterValues: FilterValues
  total: number
}

export type ProductsDataTableProps = {
  /**
   * Extra actions rendered alongside the built-in Create button in the
   * DataTable header. Used by the Step 4.9 AI merchandising sheet
   * trigger without coupling DataTable to the AI module.
   */
  extraActions?: React.ReactNode
  /**
   * Optional callback invoked whenever the table's search / filter /
   * total-matching snapshot changes. Used by the Step 4.9 AI merchandising
   * sheet to form a selection-aware pageContext per spec §10.1.
   */
  onSnapshotChange?: (snapshot: ProductsDataTableSnapshot) => void
}

export default function ProductsDataTable({
  extraActions,
  onSnapshotChange,
}: ProductsDataTableProps = {}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const currentUserId = useCurrentUserId()
  const router = useRouter()
  const [rows, setRows] = React.useState<ProductRow[]>([])
  const [viewMode, setViewMode] = React.useState<'table' | 'grid'>('table')
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false)
  const [canManageProducts, setCanManageProducts] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'title', desc: false }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  // Step 5.18 (spec §10 line 836, D18 demo): refresh the list when a
  // catalog.product.* event arrives via the DOM event bridge. Confirmed
  // AI bulk mutations (one `ai.action.confirmed` + one
  // `catalog.product.updated` per record) and direct API writes both
  // surface here so the table reflects the new state without a manual
  // reload.
  useAppEvent('catalog.product.*', () => {
    setReloadToken((token) => token + 1)
  })
  const { stats, isLoading: statsLoading, error: statsError, reload: reloadStats } = useCatalogProductStats(scopeVersion)
  React.useEffect(() => {
    if (reloadToken > 0) reloadStats()
  }, [reloadToken, reloadStats])
  React.useEffect(() => {
    if (!currentUserId) return
    const storageKey = `${VIEW_MODE_STORAGE_PREFIX}.${currentUserId}`
    const stored = window.localStorage.getItem(storageKey)
    if (stored === 'grid' || stored === 'table') setViewMode(stored)
  }, [currentUserId])
  const handleViewModeChange = React.useCallback(
    (mode: string) => {
      if (mode !== 'table' && mode !== 'grid') return
      setViewMode(mode)
      if (currentUserId) {
        window.localStorage.setItem(`${VIEW_MODE_STORAGE_PREFIX}.${currentUserId}`, mode)
      }
    },
    [currentUserId],
  )
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok?: boolean; granted?: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['catalog.products.manage'] }),
        })
        if (!cancelled && res.ok) {
          setCanManageProducts(Array.isArray(res.result?.granted) && res.result.granted.includes('catalog.products.manage'))
        }
      } catch {
        if (!cancelled) setCanManageProducts(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scopeVersion])
  const [customFieldsetFilter, setCustomFieldsetFilter] = React.useState<string | null>(null)
  const { data: customFieldDefs = [] } = useCustomFieldDefs(ENTITY_ID, {
    keyExtras: [scopeVersion, reloadToken],
  })
  const [channelOptionsCache, setChannelOptionsCache] = React.useState<Record<string, FilterOption>>({})
  const [categoryOptionsCache, setCategoryOptionsCache] = React.useState<Record<string, FilterOption>>({})
  const [tagOptionsCache, setTagOptionsCache] = React.useState<Record<string, FilterOption>>({})

  const registerOptions = React.useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Record<string, FilterOption>>>,
      options: FilterOption[]
    ) => {
      setter((prev) => {
        const next = { ...prev }
        options.forEach((opt) => {
          if (opt.value) next[opt.value] = opt
        })
        return next
      })
    },
    []
  )

  const registerChannelOptions = React.useCallback(
    (options: FilterOption[]) => registerOptions(setChannelOptionsCache, options),
    [registerOptions]
  )
  const registerCategoryOptions = React.useCallback(
    (options: FilterOption[]) => registerOptions(setCategoryOptionsCache, options),
    [registerOptions]
  )
  const registerTagOptions = React.useCallback(
    (options: FilterOption[]) => registerOptions(setTagOptionsCache, options),
    [registerOptions]
  )

  const channelOptions = React.useMemo(() => Object.values(channelOptionsCache), [channelOptionsCache])
  const categoryOptions = React.useMemo(() => Object.values(categoryOptionsCache), [categoryOptionsCache])
  const tagOptions = React.useMemo(() => Object.values(tagOptionsCache), [tagOptionsCache])

  const loadChannelOptions = React.useCallback(
    async (term?: string): Promise<FilterOption[]> => {
      try {
        const params = new URLSearchParams({ pageSize: '100', isActive: 'true' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; code?: string }> }>(
          `/api/sales/channels?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.channelsLoadError', 'Failed to load channels') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label =
              typeof entry.name === 'string'
                ? entry.name
                : typeof entry.code === 'string'
                  ? entry.code
                  : value
            return { value, label, description: typeof entry.code === 'string' ? entry.code : undefined }
          })
          .filter((option) => !!option) as FilterOption[]
        registerChannelOptions(options)
        return options
      } catch {
        return []
      }
    },
    [registerChannelOptions, t],
  )

  const loadCategoryOptions = React.useCallback(
    async (term?: string): Promise<FilterOption[]> => {
      try {
        const params = new URLSearchParams({ pageSize: '200', view: 'manage' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; parentName?: string | null }> }>(
          `/api/catalog/categories?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.categoriesLoadError', 'Failed to load categories') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label = typeof entry.name === 'string' && entry.name.trim().length ? entry.name : value
            const description =
              typeof entry.parentName === 'string' && entry.parentName.trim().length ? entry.parentName : null
            return { value, label, description }
          })
          .filter((option) => !!option) as FilterOption[]
        registerCategoryOptions(options)
        return options
      } catch {
        return []
      }
    },
    [registerCategoryOptions, t],
  )

  const loadTagOptions = React.useCallback(
    async (term?: string): Promise<FilterOption[]> => {
      try {
        const params = new URLSearchParams({ pageSize: '100' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; label?: string }> }>(
          `/api/catalog/tags?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.tagsLoadError', 'Failed to load tags') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label : value
            return { value, label }
          })
          .filter((option) => !!option) as FilterOption[]
        registerTagOptions(options)
        return options
      } catch {
        return []
      }
    },
    [registerTagOptions, t],
  )

  const productTypeOptions = React.useMemo<FilterOption[]>(() => [
    { value: 'simple', label: t('catalog.products.types.simple', 'Simple') },
    { value: 'configurable', label: t('catalog.products.types.configurable', 'Configurable') },
    { value: 'virtual', label: t('catalog.products.types.virtual', 'Virtual') },
    { value: 'downloadable', label: t('catalog.products.types.downloadable', 'Downloadable') },
    { value: 'service', label: t('catalog.products.types.service', 'Service') },
    { value: 'subscription', label: t('catalog.products.types.subscription', 'Subscription') },
    {
      value: 'bundle',
      label: `${t('catalog.products.types.bundle', 'Bundle')} (${t('common.comingSoon', 'Coming soon')})`,
    },
    {
      value: 'grouped',
      label: `${t('catalog.products.types.grouped', 'Grouped')} (${t('common.comingSoon', 'Coming soon')})`,
    },
  ], [t])

  const lifecycleOptions = React.useMemo<FilterOption[]>(
    () => CATALOG_PRODUCT_LIFECYCLE_STATES.map((state) => ({
      value: state,
      label: t(`catalog.products.lifecycle.${state}`, state),
    })),
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    { id: 'isActive', label: t('catalog.products.filters.active'), type: 'checkbox' },
    { id: 'configurable', label: t('catalog.products.filters.configurable'), type: 'checkbox' },
    { id: 'productType', label: t('catalog.products.filters.productType', 'Type'), type: 'select', options: productTypeOptions },
    {
      id: 'channelIds',
      label: t('catalog.products.filters.channels'),
      type: 'tags',
      loadOptions: loadChannelOptions,
      options: channelOptions,
      formatValue: (val) => channelOptionsCache[val]?.label ?? val,
      formatDescription: (val) => channelOptionsCache[val]?.description ?? null,
    },
    {
      id: 'categoryIds',
      label: t('catalog.products.filters.categories', 'Categories'),
      type: 'tags',
      loadOptions: loadCategoryOptions,
      options: categoryOptions,
      formatValue: (val) => categoryOptionsCache[val]?.label ?? val,
      formatDescription: (val) => categoryOptionsCache[val]?.description ?? null,
    },
    {
      id: 'tagIds',
      label: t('catalog.products.filters.tags', 'Tags'),
      type: 'tags',
      loadOptions: loadTagOptions,
      options: tagOptions,
      formatValue: (val) => tagOptionsCache[val]?.label ?? val,
    },
  ], [
    categoryOptions,
    categoryOptionsCache,
    channelOptions,
    channelOptionsCache,
    loadCategoryOptions,
    loadChannelOptions,
    loadTagOptions,
    productTypeOptions,
    tagOptions,
    tagOptionsCache,
    t,
  ])

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(() => {
    const base: ColumnDef<ProductRow>[] = [
      {
        id: 'media',
        header: '',
        size: 80,
        cell: ({ row }) => (
          <ProductImageCell
            mediaId={row.original.default_media_id}
            mediaUrl={row.original.default_media_url}
            title={row.original.title}
            cropType="contain"
          />
        ),
        meta: { sticky: true },
      },
      {
        accessorKey: 'title',
        header: t('catalog.products.table.product', 'Product'),
        cell: ({ row }) => {
          const categories = Array.isArray(row.original.categories) ? row.original.categories : []
          const categoryName = categories
            .map((entry) => (typeof entry?.name === 'string' ? entry.name.trim() : ''))
            .find((name) => name.length) ?? null
          return (
            <div className="flex flex-col">
              <span className="font-medium">{row.original.title || '—'}</span>
              {categoryName ? (
                <span className="text-xs text-muted-foreground">{categoryName}</span>
              ) : null}
            </div>
          )
        },
        meta: { sticky: true },
      },
      {
        id: 'type',
        header: t('catalog.products.table.type', 'Type'),
        enableSorting: false,
        cell: ({ row }) => {
          const kind = commercialKind(
            typeof row.original.product_type === 'string' ? row.original.product_type : 'simple',
          )
          const TypeIcon = COMMERCIAL_KIND_ICON[kind]
          return (
            <Tag variant="neutral" shape="square">
              <TypeIcon className="size-3 shrink-0" aria-hidden />
              {t(commercialKindLabelKey(kind), COMMERCIAL_KIND_FALLBACK[kind])}
            </Tag>
          )
        },
      },
      {
        accessorKey: 'sku',
        header: t('catalog.products.table.sku', 'SKU'),
        cell: ({ getValue }) => {
          const value = getValue()
          return value ? <span className="font-mono text-xs">{String(value)}</span> : <span className="text-xs text-muted-foreground">—</span>
        },
      },
      {
        accessorKey: 'pricing',
        header: t('catalog.products.table.price'),
        cell: ({ row }) => {
          const price = formatProductPrice(
            row.original.pricing ?? null,
            typeof row.original.default_sales_unit === 'string' ? row.original.default_sales_unit : null,
            typeof row.original.primary_currency_code === 'string' ? row.original.primary_currency_code : null,
          )
          if (!price.amount) return <span className="text-sm text-muted-foreground">—</span>
          return (
            <span className="text-sm font-semibold text-foreground">
              {price.amount}
              {price.suffix ? (
                <span className="ml-0.5 font-normal text-muted-foreground">{price.suffix}</span>
              ) : null}
            </span>
          )
        },
      },
      {
        id: 'lifecycle_status',
        header: t('catalog.products.table.status', 'Status'),
        enableSorting: false,
        cell: ({ row }) => {
          const status = deriveProductDisplayStatus({
            lifecycleState: typeof row.original.lifecycle_state === 'string' ? row.original.lifecycle_state : null,
            isActive: typeof row.original.is_active === 'boolean' ? row.original.is_active : null,
          })
          return (
            <StatusBadge variant={productStatusMap[status]} dot={productStatusDot[status]}>
              {t(productLifecycleLabelKey(status), status)}
            </StatusBadge>
          )
        },
      },
      {
        id: 'offers',
        header: t('catalog.products.table.offers', 'Offers'),
        enableSorting: false,
        cell: ({ row }) => {
          const offers = Array.isArray(row.original.offers) ? row.original.offers : []
          const activeCount = offers.filter((offer) => offer?.isActive).length
          if (activeCount === 0) return <span className="text-sm text-muted-foreground">—</span>
          return (
            <span className="text-sm text-muted-foreground">
              {t('catalog.products.table.offersCount', '{count} offers', { count: activeCount })}
            </span>
          )
        },
      },
    ]
    return base
  }, [t])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleCustomFieldsetFilterChange = React.useCallback(
    (value: string | null) => {
      if (value === customFieldsetFilter) return
      setCustomFieldsetFilter(value)
      setFilterValues((prev) => {
        const entries = Object.entries(prev)
        if (!entries.some(([key]) => key.startsWith('cf_'))) return prev
        const next: FilterValues = {}
        entries.forEach(([key, val]) => {
          if (!key.startsWith('cf_')) next[key] = val
        })
        return next
      })
      setPage(1)
    },
    [customFieldsetFilter],
  )

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort?.id) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    if (typeof filterValues.lifecycleState === 'string' && filterValues.lifecycleState) {
      params.set('lifecycleState', filterValues.lifecycleState)
    }
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    if (filterValues.configurable === true) params.set('configurable', 'true')
    if (filterValues.configurable === false) params.set('configurable', 'false')
    if (typeof filterValues.productType === 'string' && filterValues.productType.trim()) {
      params.set('productType', filterValues.productType.trim())
    }
    if (Array.isArray(filterValues.channelIds) && filterValues.channelIds.length) {
      const values = filterValues.channelIds
        .map((value) => (typeof value === 'string' ? value : null))
        .filter((value): value is string => !!value)
      if (values.length) params.set('channelIds', values.join(','))
    }
    if (Array.isArray(filterValues.categoryIds) && filterValues.categoryIds.length) {
      const values = filterValues.categoryIds
        .map((value) => (typeof value === 'string' ? value : null))
        .filter((value): value is string => !!value)
      if (values.length) params.set('categoryIds', values.join(','))
    }
    if (Array.isArray(filterValues.tagIds) && filterValues.tagIds.length) {
      const values = filterValues.tagIds
        .map((value) => (typeof value === 'string' ? value : null))
        .filter((value): value is string => !!value)
      if (values.length) params.set('tagIds', values.join(','))
    }
    Object.entries(filterValues).forEach(([key, value]) => {
      if (!key.startsWith('cf_') || value == null) return
      if (Array.isArray(value)) {
        const entries = value
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
          .filter((entry) => entry.length > 0)
        if (entries.length) params.set(key, entries.join(','))
      } else if (typeof value === 'object' && value !== null && ('from' in (value as Record<string, unknown>) || 'to' in (value as Record<string, unknown>))) {
        const range = value as { from?: string; to?: string }
        if (typeof range.from === 'string' && range.from.trim().length) {
          params.set(`${key}:from`, range.from.trim())
        }
        if (typeof range.to === 'string' && range.to.trim().length) {
          params.set(`${key}:to`, range.to.trim())
        }
      } else if (typeof value === 'string' && value.trim()) {
        params.set(key, value.trim())
      }
    })
    if (typeof customFieldsetFilter === 'string' && customFieldsetFilter.trim().length > 0) {
      params.set('customFieldset', customFieldsetFilter.trim())
    }
    return params.toString()
  }, [customFieldsetFilter, filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setCacheStatus(null)
      try {
        const fallback: ProductsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<ProductsResponse>(
          `/api/catalog/products?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const message = t('catalog.products.list.error.load', 'Failed to load products')
          flash(message, 'error')
          if (!cancelled) setCacheStatus(null)
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setCacheStatus(call.cacheStatus ?? null)
        const items = Array.isArray(payload.items) ? payload.items : []
        const normalized = items.filter((item): item is ProductRow => typeof item?.id === 'string')
        setRows(normalized)
        setTotal(typeof payload.total === 'number' ? payload.total : normalized.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (error) {
        if (!cancelled) {
          setCacheStatus(null)
          const message =
            error instanceof Error
              ? error.message
              : t('catalog.products.list.error.load', 'Failed to load products')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: ProductRow) => {
    const confirmed = await confirm({
      title: t('catalog.products.list.deleteConfirm', 'Delete this product?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(typeof row.updated_at === 'string' ? row.updated_at : null)
      await withScopedApiRequestHeaders(headers, () => (
        deleteCrud('catalog/products', row.id, {
          errorMessage: t('catalog.products.list.error.delete', 'Failed to delete product'),
        })
      ))
      flash(t('catalog.products.flash.deleted', 'Product deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('catalog.products.list.error.delete', 'Failed to delete product')
      flash(message, 'error')
    }
  }, [confirm, t])

  const handleLifecycleTransition = React.useCallback(
    async (row: ProductRow, nextState: 'archived' | 'active') => {
      if (nextState === 'archived') {
        const confirmed = await confirm({
          title: t('catalog.products.list.archiveConfirm', 'Archive this product?'),
          description: t(
            'catalog.products.list.archiveConfirmDescription',
            'Archived products move to the Archived tab. They keep their offers and prices.',
          ),
        })
        if (!confirmed) return
      }
      try {
        const headers = buildOptimisticLockHeader(typeof row.updated_at === 'string' ? row.updated_at : null)
        await withScopedApiRequestHeaders(headers, () => (
          updateCrud('catalog/products', { id: row.id, lifecycleState: nextState }, {
            errorMessage: t('catalog.products.list.error.lifecycle', 'Failed to update product status'),
          })
        ))
        flash(
          nextState === 'archived'
            ? t('catalog.products.flash.archived', 'Product archived')
            : t('catalog.products.flash.restored', 'Product restored'),
          'success',
        )
        setReloadToken((token) => token + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t)) {
          setReloadToken((token) => token + 1)
          return
        }
        const message =
          error instanceof Error
            ? error.message
            : t('catalog.products.list.error.lifecycle', 'Failed to update product status')
        flash(message, 'error')
      }
    },
    [confirm, t],
  )

  React.useEffect(() => {
    if (!onSnapshotChange) return
    onSnapshotChange({ search, filterValues, total })
  }, [onSnapshotChange, search, filterValues, total])

  const currentParams = React.useMemo(() => Object.fromEntries(new URLSearchParams(queryParams)), [queryParams])

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('catalog/products', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('catalog/products', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  const handleSortingChange = React.useCallback((updater: React.SetStateAction<SortingState>) => {
    setSorting(updater)
    setPage(1)
  }, [])

  const toolbarElement = (
    <ProductsToolbar
      search={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t('catalog.products.list.searchPlaceholder', 'Search products, SKU, EAN…')}
      filterValues={filterValues}
      onFilterChange={(patch) => handleFiltersApply({ ...filterValues, ...patch })}
      productTypeOptions={productTypeOptions}
      lifecycleOptions={lifecycleOptions}
      loadCategoryOptions={loadCategoryOptions}
      sorting={sorting}
      onSortingChange={handleSortingChange}
      viewMode={viewMode}
      onViewModeChange={handleViewModeChange}
    />
  )

  const gridItems = React.useMemo<ProductGridItem[]>(() => rows.map((row) => ({
    id: row.id,
    title: row.title,
    sku: typeof row.sku === 'string' ? row.sku : null,
    productType: typeof row.product_type === 'string' ? row.product_type : 'simple',
    lifecycleState: typeof row.lifecycle_state === 'string' ? row.lifecycle_state : null,
    isActive: row.is_active !== false,
    defaultMediaUrl: typeof row.default_media_url === 'string' ? row.default_media_url : null,
    categories: (Array.isArray(row.categories) ? row.categories : [])
      .map((entry) => (typeof entry?.name === 'string' ? entry.name : null))
      .filter((name): name is string => !!name),
    pricing: row.pricing ?? null,
    salesUnit: typeof row.default_sales_unit === 'string' ? row.default_sales_unit : null,
    variantsCount: typeof row.variants_count === 'number' ? row.variants_count : 0,
  })), [rows])

  const openProduct = React.useCallback((item: ProductGridItem) => {
    router.push(`/backend/catalog/products/${item.id}`)
  }, [router])

  const heroElement = (
    <ProductsHero
      stats={stats}
      isLoading={statsLoading}
      error={statsError}
      actions={canManageProducts ? (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => flash(t('catalog.products.customizeView.comingSoon', 'View customization is coming soon.'), 'info')}
          >
            {t('catalog.products.actions.customizeView', 'Customize view')}
          </Button>
          <Button type="button" onClick={() => setQuickCreateOpen(true)}>
            {t('catalog.products.actions.addProduct', 'Add product')}
          </Button>
        </>
      ) : null}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {heroElement}
      {toolbarElement}
      {viewMode === 'grid' ? (
        <div className="flex flex-col gap-4">
          <ProductsGridView
            items={gridItems}
            isLoading={isLoading}
            emptyState={(
              <ListEmptyState
                entityName={t('catalog.products.page.title', 'Products & services')}
                createHref="/backend/catalog/products/create"
                createLabel={t('catalog.products.actions.create', 'Create')}
              />
            )}
            onOpen={openProduct}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      ) : (
        <DataTable<ProductRow>
            embedded
            actions={extraActions}
            columns={columns}
            data={rows}
            emptyState={(
              <ListEmptyState
                entityName={t('catalog.products.page.title', 'Products & services')}
                createHref="/backend/catalog/products/create"
                createLabel={t('catalog.products.actions.create', 'Create')}
              />
            )}
            sorting={sorting}
            onSortingChange={handleSortingChange}
            injectionSpotId={extensionPoints.hosts.productsTable.baseSpotId}
            injectionContext={{
              search,
              filters: filterValues,
              customFieldset: customFieldsetFilter,
              page,
              sorting,
              scopeVersion,
              // Step 5.15: surface `total` so the merchandising AI widget
              // (rendered in `data-table:catalog.products:header`) can build
              // a selection-aware pageContext per spec §10.1 without taking a
              // dependency on the host page.
              total,
              totalMatching: total,
            }}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total,
              totalPages,
              onPageChange: setPage,
              cacheStatus,
            }}
            isLoading={isLoading}
            stickyActionsColumn
            rowActions={(row) => {
              const status = deriveProductDisplayStatus({
                lifecycleState: typeof row.lifecycle_state === 'string' ? row.lifecycle_state : null,
                isActive: typeof row.is_active === 'boolean' ? row.is_active : null,
              })
              return (
                <RowActions
                  items={[
                    {
                      id: 'edit',
                      label: t('catalog.products.table.actions.edit', 'Edit'),
                      href: `/backend/catalog/products/${row.id}`,
                    },
                    ...(status === 'archived'
                      ? [{
                          id: 'restore',
                          label: t('catalog.products.table.actions.restore', 'Restore'),
                          onSelect: () => {
                            void handleLifecycleTransition(row, 'active')
                          },
                        }]
                      : [{
                          id: 'archive',
                          label: t('catalog.products.table.actions.archive', 'Archive'),
                          onSelect: () => {
                            void handleLifecycleTransition(row, 'archived')
                          },
                        }]),
                    {
                      id: 'delete',
                      label: t('catalog.products.table.actions.delete', 'Delete'),
                      destructive: true,
                      onSelect: () => {
                        void handleDelete(row)
                      },
                    },
                  ]}
                />
              )
            }}
          />
      )}
      <ProductQuickCreateDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        onCreated={() => {
          setReloadToken((token) => token + 1)
        }}
      />
      {ConfirmDialogElement}
    </div>
  )
}
