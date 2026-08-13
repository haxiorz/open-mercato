"use client"

import * as React from 'react'
import { ArrowUpDown, Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'

export type ProductsToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  filterValues: FilterValues
  onFilterChange: (patch: FilterValues) => void
  productTypeOptions: FilterOption[]
  lifecycleOptions: FilterOption[]
  loadCategoryOptions: (term?: string) => Promise<FilterOption[]>
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
  viewMode: 'table' | 'grid'
  onViewModeChange: (mode: string) => void
}

type SortOption = {
  id: string
  field: string
  desc: boolean
  labelKey: string
  labelFallback: string
}

const SORT_OPTIONS: SortOption[] = [
  { id: 'title-asc', field: 'title', desc: false, labelKey: 'catalog.products.sort.nameAsc', labelFallback: 'Name A–Z' },
  { id: 'title-desc', field: 'title', desc: true, labelKey: 'catalog.products.sort.nameDesc', labelFallback: 'Name Z–A' },
  { id: 'created-desc', field: 'createdAt', desc: true, labelKey: 'catalog.products.sort.newest', labelFallback: 'Newest first' },
  { id: 'created-asc', field: 'createdAt', desc: false, labelKey: 'catalog.products.sort.oldest', labelFallback: 'Oldest first' },
  { id: 'updated-desc', field: 'updatedAt', desc: true, labelKey: 'catalog.products.sort.updated', labelFallback: 'Recently updated' },
  { id: 'sku-asc', field: 'sku', desc: false, labelKey: 'catalog.products.sort.skuAsc', labelFallback: 'SKU A–Z' },
]

function OptionRow({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-between font-normal"
      onClick={onSelect}
    >
      <span className="truncate">{label}</span>
      {selected ? <Check className="size-4 shrink-0 text-brand-violet" aria-hidden /> : null}
    </Button>
  )
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 py-1 text-overline font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}

export function ProductsToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  filterValues,
  onFilterChange,
  productTypeOptions,
  lifecycleOptions,
  loadCategoryOptions,
  sorting,
  onSortingChange,
  viewMode,
  onViewModeChange,
}: ProductsToolbarProps) {
  const t = useT()
  const [categoryOptions, setCategoryOptions] = React.useState<FilterOption[]>([])
  const [categoriesLoaded, setCategoriesLoaded] = React.useState(false)

  const ensureCategories = React.useCallback(async () => {
    if (categoriesLoaded) return
    const options = await loadCategoryOptions()
    setCategoryOptions(options)
    setCategoriesLoaded(true)
  }, [categoriesLoaded, loadCategoryOptions])

  const productType = typeof filterValues.productType === 'string' ? filterValues.productType : null
  const lifecycleState = typeof filterValues.lifecycleState === 'string' ? filterValues.lifecycleState : null
  const categoryIds = Array.isArray(filterValues.categoryIds)
    ? (filterValues.categoryIds as string[])
    : []
  const isActive = typeof filterValues.isActive === 'boolean' ? filterValues.isActive : null
  const configurable = typeof filterValues.configurable === 'boolean' ? filterValues.configurable : null

  const activeFilterCount =
    (lifecycleState ? 1 : 0) +
    (productType ? 1 : 0) +
    (categoryIds.length ? 1 : 0) +
    (isActive !== null ? 1 : 0) +
    (configurable !== null ? 1 : 0)

  const currentSort = sorting[0]
  const currentSortOption =
    SORT_OPTIONS.find(
      (option) => option.field === currentSort?.id && option.desc === Boolean(currentSort?.desc),
    ) ?? SORT_OPTIONS[0]

  const clearFilters = () =>
    onFilterChange({
      lifecycleState: undefined,
      productType: undefined,
      categoryIds: [],
      isActive: undefined,
      configurable: undefined,
    })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-full min-w-56 max-w-sm flex-1 sm:flex-none">
        <SearchInput
          value={search}
          onChange={onSearchChange}
          onClear={() => onSearchChange('')}
          placeholder={searchPlaceholder}
        />
      </div>

      <Popover onOpenChange={(open) => { if (open) void ensureCategories() }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={
              activeFilterCount
                ? 'h-9 shrink-0 gap-1.5 rounded-md px-3 text-xs font-semibold border-brand-violet text-brand-violet'
                : 'h-9 shrink-0 gap-1.5 rounded-md px-3 text-xs font-semibold text-muted-foreground'
            }
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {t('catalog.products.filters.label', 'Filters')}
            {activeFilterCount ? (
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-brand-violet/15 px-1 text-xs font-semibold text-brand-violet">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="flex flex-col gap-2">
            <FilterSection title={t('catalog.products.filters.status', 'Status')}>
              {lifecycleOptions.map((option) => (
                <OptionRow
                  key={option.value}
                  label={option.label}
                  selected={lifecycleState === option.value}
                  onSelect={() =>
                    onFilterChange({
                      lifecycleState: lifecycleState === option.value ? undefined : option.value,
                    })
                  }
                />
              ))}
            </FilterSection>

            <div className="-mx-2 h-px bg-border" />

            <FilterSection title={t('catalog.products.filters.productType', 'Type')}>
              {productTypeOptions.map((option) => (
                <OptionRow
                  key={option.value}
                  label={option.label}
                  selected={productType === option.value}
                  onSelect={() =>
                    onFilterChange({ productType: productType === option.value ? undefined : option.value })
                  }
                />
              ))}
            </FilterSection>

            <div className="-mx-2 h-px bg-border" />

            <FilterSection title={t('catalog.products.filters.categories', 'Category')}>
              <div className="max-h-40 overflow-auto">
                {categoryOptions.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    {categoriesLoaded
                      ? t('catalog.products.filters.categoriesEmpty', 'No categories')
                      : t('common.loading', 'Loading…')}
                  </p>
                ) : (
                  categoryOptions.map((option) => (
                    <OptionRow
                      key={option.value}
                      label={option.label}
                      selected={categoryIds.includes(option.value)}
                      onSelect={() =>
                        onFilterChange({
                          categoryIds: categoryIds.includes(option.value)
                            ? categoryIds.filter((id) => id !== option.value)
                            : [...categoryIds, option.value],
                        })
                      }
                    />
                  ))
                )}
              </div>
            </FilterSection>

            <div className="-mx-2 h-px bg-border" />

            <FilterSection title={t('catalog.products.filters.more', 'More')}>
              <OptionRow
                label={t('catalog.products.filters.activeOnly', 'Active only')}
                selected={isActive === true}
                onSelect={() => onFilterChange({ isActive: isActive === true ? undefined : true })}
              />
              <OptionRow
                label={t('catalog.products.filters.configurableOnly', 'Configurable only')}
                selected={configurable === true}
                onSelect={() =>
                  onFilterChange({ configurable: configurable === true ? undefined : true })
                }
              />
            </FilterSection>

            {activeFilterCount ? (
              <>
                <div className="-mx-2 h-px bg-border" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start font-normal text-muted-foreground"
                  onClick={clearFilters}
                >
                  {t('common.clearAll', 'Clear all')}
                </Button>
              </>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 gap-1.5 rounded-md px-3 text-xs font-semibold text-muted-foreground"
          >
            <ArrowUpDown className="size-3.5" aria-hidden />
            <span className="truncate">
              {t('catalog.products.sort.label', 'Sort')}: {t(currentSortOption.labelKey, currentSortOption.labelFallback)}
            </span>
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {SORT_OPTIONS.map((option) => (
            <OptionRow
              key={option.id}
              label={t(option.labelKey, option.labelFallback)}
              selected={option.id === currentSortOption.id}
              onSelect={() => onSortingChange([{ id: option.field, desc: option.desc }])}
            />
          ))}
        </PopoverContent>
      </Popover>

      <div className="hidden flex-1 sm:block" />

      <SegmentedControl
        value={viewMode}
        onValueChange={onViewModeChange}
        aria-label={t('catalog.products.list.viewToggle', 'View')}
      >
        <SegmentedControlItem value="table">
          {t('catalog.products.list.view.table', 'Table')}
        </SegmentedControlItem>
        <SegmentedControlItem value="grid">
          {t('catalog.products.list.view.grid', 'Grid')}
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
}

export default ProductsToolbar
