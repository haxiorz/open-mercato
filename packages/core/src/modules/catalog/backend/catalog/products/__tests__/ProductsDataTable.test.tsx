/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ProductsDataTable from '../../../../components/products/ProductsDataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const mockTranslate = (key: string, fallback?: string, params?: Record<string, unknown>) => {
  const template = fallback ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

// Captures the props passed to the (mocked) DataTable so individual cell
// renderers can be exercised directly in tests.
let mockLatestColumns: any[] = []
let mockLatestProps: any = null

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: any) => {
    mockLatestColumns = props.columns
    mockLatestProps = props
    return (
      <div data-testid="data-table-mock">
        <div data-testid="data-table-cache-status">{props.pagination?.cacheStatus ?? ''}</div>
        <div data-testid="data-table-sticky-actions">{String(Boolean(props.stickyActionsColumn))}</div>
        <div data-testid="row-actions-wrapper">
          {props.rowActions?.({ id: 'prod-1', title: 'Mock product', updated_at: '2026-08-10T00:00:00Z' })}
        </div>
        {props.actions}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...rest }: any) =>
    asChild ? <span {...rest}>{children}</span> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/segmented-control', () => ({
  SegmentedControl: ({ children }: any) => <div>{children}</div>,
  SegmentedControlItem: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => ({
  StatusBadge: ({ children, variant, dot }: any) => (
    <span data-testid="status-badge" data-variant={variant} data-dot={String(Boolean(dot))}>{children}</span>
  ),
}))

jest.mock('@open-mercato/ui/primitives/tag', () => ({
  Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
}))

jest.mock('@open-mercato/ui/primitives/pagination', () => ({
  Pagination: () => <div data-testid="pagination-mock" />,
}))

jest.mock('@open-mercato/ui/primitives/search-input', () => ({
  SearchInput: () => <input data-testid="search-input" />,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: any) => (
    <div>
      {items.map((item: any) => (
        <button key={item.id} data-testid={`row-action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn(),
  updateCrud: jest.fn(),
  buildCrudExportUrl: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldColumns', () => ({
  applyCustomFieldVisibility: jest.fn((cols) => cols),
}))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => 'user-1',
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('lucide-react', () => ({
  Package: () => null,
  RefreshCcw: () => null,
  Wrench: () => null,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(() => {
      return new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(true), 0)
      })
    }),
    ConfirmDialogElement: null,
  }),
}))

const mockReloadStats = jest.fn()
jest.mock('../../../../components/products/useCatalogProductStats', () => ({
  useCatalogProductStats: () => ({
    stats: {
      totals: { all: 12, active: 8, draft: 3, archived: 1 },
      productsInActiveOffers: 5,
      catalogValue: 125000,
      catalogValueCurrency: 'USD',
    },
    isLoading: false,
    error: null,
    reload: mockReloadStats,
  }),
}))

jest.mock('../../../../components/products/ProductsHero', () => ({
  ProductsHero: ({ actions }: any) => <div data-testid="products-hero">{actions}</div>,
}))

jest.mock('../../../../components/products/ProductsGridView', () => ({
  ProductsGridView: ({ items }: any) => (
    <div data-testid="products-grid" data-count={items.length} />
  ),
}))

jest.mock('../../../../components/products/ProductQuickCreateDialog', () => ({
  ProductQuickCreateDialog: ({ open }: any) => (
    <div data-testid="quick-create-dialog" data-open={String(Boolean(open))} />
  ),
}))

jest.mock('../../../../components/products/ProductImageCell', () => ({
  ProductImageCell: () => <div data-testid="product-image-cell" />,
}))

// The toolbar is a sibling of the DataTable now (not a DataTable prop). Mocking
// it exposes the seams — filter / search / sort / view-mode callbacks — that
// drive the products query, replacing the removed lifecycle Tabs.
jest.mock('../../../../components/products/ProductsToolbar', () => ({
  ProductsToolbar: ({ onFilterChange, onSearchChange, onSortingChange, onViewModeChange }: any) => (
    <div data-testid="products-toolbar">
      <button data-testid="toolbar-filter-draft" onClick={() => onFilterChange({ lifecycleState: 'draft' })}>
        filter-draft
      </button>
      <button
        data-testid="toolbar-filter-legacy"
        onClick={() => onFilterChange({ status: 'legacy-uuid', productType: 'service' })}
      >
        filter-legacy
      </button>
      <button data-testid="toolbar-search" onClick={() => onSearchChange('widgets')}>
        search
      </button>
      <button data-testid="toolbar-sort-sku" onClick={() => onSortingChange([{ id: 'sku', desc: false }])}>
        sort-sku
      </button>
      <button data-testid="view-toggle-grid" onClick={() => onViewModeChange('grid')}>grid</button>
      <button data-testid="view-toggle-table" onClick={() => onViewModeChange('table')}>table</button>
    </div>
  ),
}))

function productsCalls(): string[] {
  return (apiCall as jest.Mock).mock.calls
    .map((call) => call[0] as string)
    .filter((url) => typeof url === 'string' && url.startsWith('/api/catalog/products?'))
}

describe('ProductsDataTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/catalog/products?')) {
        return {
          ok: true,
          cacheStatus: 'hit',
          result: {
            items: [{
              id: 'prod-1',
              title: 'Mock product',
              sku: 'SKU-001',
              product_type: 'simple',
              lifecycle_state: 'active',
              is_active: true,
              variants_count: 2,
              categories: [{ id: 'cat-1', name: 'Chairs' }, { id: 'cat-2', name: 'Furniture' }],
            }],
            total: 1,
            totalPages: 1,
          },
        }
      }
      return { ok: true, result: { ok: true, granted: ['catalog.products.manage'], userId: 'user-1' } }
    })
    ;(deleteCrud as jest.Mock).mockResolvedValue(undefined)
    ;(updateCrud as jest.Mock).mockResolvedValue(undefined)
    ;(useCustomFieldDefs as jest.Mock).mockReturnValue({ data: [], isLoading: false })
    ;(useOrganizationScopeVersion as jest.Mock).mockReturnValue(1)
  })

  it('renders the hero and toolbar and loads catalog data', async () => {
    render(<ProductsDataTable />)

    await waitFor(() => {
      expect(productsCalls().length).toBeGreaterThan(0)
      expect(screen.getByTestId('data-table-cache-status')).toHaveTextContent('hit')
    })
    expect(screen.getByTestId('data-table-sticky-actions')).toHaveTextContent('true')
    expect(productsCalls()[0]).toContain('/api/catalog/products?page=1&pageSize=25')
    expect(screen.getByTestId('products-hero')).toBeInTheDocument()
    expect(screen.getByTestId('products-toolbar')).toBeInTheDocument()
  })

  it('composes the toolbar lifecycle filter into the products query', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTestId('toolbar-filter-draft'))
    await waitFor(() => {
      expect(productsCalls().some((url) => url.includes('lifecycleState=draft'))).toBe(true)
    })
    expect(productsCalls().filter((url) => url.includes('lifecycleState=draft')).every((url) => !url.includes('isActive='))).toBe(true)
  })

  it('applies the toolbar search term to the products query', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTestId('toolbar-search'))
    await waitFor(() => expect(productsCalls().some((url) => url.includes('search=widgets'))).toBe(true))
  })

  it('applies the toolbar sort selection to the products query', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTestId('toolbar-sort-sku'))
    await waitFor(() => {
      expect(productsCalls().some((url) => url.includes('sortField=sku') && url.includes('sortDir=asc'))).toBe(true)
    })
  })

  it('ignores saved filter values for removed filter ids (perspective degradation)', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    // A saved perspective may restore an unknown/removed filter id (`status`)
    // alongside a live one. The unknown id must be dropped, not crash the table.
    fireEvent.click(screen.getByTestId('toolbar-filter-legacy'))
    await waitFor(() => {
      expect(productsCalls().some((url) => url.includes('productType=service'))).toBe(true)
    })
    expect(productsCalls().every((url) => !url.includes('status='))).toBe(true)
    expect(productsCalls().every((url) => !url.includes('legacy-uuid'))).toBe(true)
  })

  it('handles row deletion flow with confirmation', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    const deleteButton = await screen.findByTestId('row-action-delete')
    fireEvent.click(deleteButton)

    await waitFor(() => expect(deleteCrud).toHaveBeenCalledWith('catalog/products', 'prod-1', expect.any(Object)))
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('Product deleted'), 'success')
  })

  it('archives a product from the row actions', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    const archiveButton = await screen.findByTestId('row-action-archive')
    fireEvent.click(archiveButton)

    await waitFor(() => expect(updateCrud).toHaveBeenCalledWith(
      'catalog/products',
      { id: 'prod-1', lifecycleState: 'archived' },
      expect.any(Object),
    ))
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('Product archived'), 'success')
  })

  it('switches to the grid view and persists the choice per user', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(productsCalls().length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTestId('view-toggle-grid'))
    await waitFor(() => expect(screen.getByTestId('products-grid')).toBeInTheDocument())
    expect(screen.getByTestId('products-grid')).toHaveAttribute('data-count', '1')
    expect(window.localStorage.getItem('om.catalog.products.viewMode.user-1')).toBe('grid')
  })

  it('exposes the redesigned columns and drops the category column', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const columnIds = mockLatestColumns.map((col) => col.id ?? col.accessorKey)
    expect(columnIds).toEqual(['media', 'title', 'type', 'sku', 'pricing', 'lifecycle_status', 'offers'])
    expect(mockLatestColumns.some((col) => col.id === 'categories' || col.accessorKey === 'categories')).toBe(false)
  })

  it('renders the product identity and first category in the product cell', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const titleColumn = mockLatestColumns.find((col) => col.accessorKey === 'title')
    expect(titleColumn.header).toBe('Product')

    const { container } = render(titleColumn.cell({
      row: { original: { id: 'p1', title: 'Widget', categories: [{ id: 'c1', name: 'Chairs' }] } },
    }) as React.ReactElement)

    expect(container.textContent).toContain('Widget')
    expect(container.textContent).toContain('Chairs')
    // The type + variant count no longer live in the product cell.
    expect(container.textContent).not.toContain('variants')
    expect(container.textContent).not.toContain('Service')
  })

  it('renders the commercial-kind label in the type column', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const typeColumn = mockLatestColumns.find((col) => col.id === 'type')
    expect(typeColumn.header).toBe('Type')

    expect(render(typeColumn.cell({ row: { original: { id: 'p1', product_type: 'service' } } }) as React.ReactElement)
      .container.textContent).toContain('Service')
    expect(render(typeColumn.cell({ row: { original: { id: 'p2', product_type: 'subscription' } } }) as React.ReactElement)
      .container.textContent).toContain('Subscription')
    expect(render(typeColumn.cell({ row: { original: { id: 'p3', product_type: 'simple' } } }) as React.ReactElement)
      .container.textContent).toContain('Physical')
  })

  it('renders the SKU or a placeholder in the sku column', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const skuColumn = mockLatestColumns.find((col) => col.accessorKey === 'sku')
    expect(skuColumn.header).toBe('SKU')

    expect(render(skuColumn.cell({ getValue: () => 'SKU-9' }) as React.ReactElement).container.textContent).toBe('SKU-9')
    expect(render(skuColumn.cell({ getValue: () => null }) as React.ReactElement).container.textContent).toBe('—')
  })

  it('renders formatted price and the optional billing suffix in the price column', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const priceColumn = mockLatestColumns.find((col) => col.accessorKey === 'pricing')

    expect(render(priceColumn.cell({
      row: { original: { pricing: { currency_code: 'usd', unit_price_net: '148.0000' }, default_sales_unit: null } },
    }) as React.ReactElement).container.textContent).toBe('148 USD')

    const withSuffix = render(priceColumn.cell({
      row: { original: { pricing: { currency_code: 'usd', unit_price_net: '50.00' }, default_sales_unit: 'seat' } },
    }) as React.ReactElement).container
    expect(withSuffix.textContent).toContain('50 USD')
    expect(withSuffix.textContent).toContain('/seat')

    expect(render(priceColumn.cell({ row: { original: { pricing: null } } }) as React.ReactElement).container.textContent).toBe('—')
  })

  it('renders the active offers count in the offers column', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const offersColumn = mockLatestColumns.find((col) => col.id === 'offers')
    expect(offersColumn.header).toBe('Offers')

    expect(render(offersColumn.cell({
      row: { original: { offers: [{ id: 'o1', isActive: true }, { id: 'o2', isActive: false }, { id: 'o3', isActive: true }] } },
    }) as React.ReactElement).container.textContent).toContain('2 offers')

    expect(render(offersColumn.cell({
      row: { original: { offers: [{ id: 'o1', isActive: false }] } },
    }) as React.ReactElement).container.textContent).toBe('—')
  })

  it('derives the lifecycle status badge from lifecycle state and activity', async () => {
    render(<ProductsDataTable />)
    await waitFor(() => expect(mockLatestColumns.length).toBeGreaterThan(0))

    const statusColumn = mockLatestColumns.find((col) => col.id === 'lifecycle_status')
    expect(statusColumn).toBeTruthy()

    const activeCell = render(statusColumn.cell({
      row: { original: { id: 'p1', lifecycle_state: 'active', is_active: true } },
    }) as React.ReactElement)
    expect(activeCell.container.querySelector('[data-testid="status-badge"]')).toHaveAttribute('data-variant', 'success')

    const discontinuedCell = render(statusColumn.cell({
      row: { original: { id: 'p2', lifecycle_state: 'active', is_active: false } },
    }) as React.ReactElement)
    expect(discontinuedCell.container.querySelector('[data-testid="status-badge"]')).toHaveAttribute('data-variant', 'error')
  })
})
