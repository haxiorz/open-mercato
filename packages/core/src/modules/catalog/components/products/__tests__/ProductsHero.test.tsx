/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ProductsHero } from '../ProductsHero'
import {
  useCatalogProductStats,
  type CatalogProductStats,
} from '../useCatalogProductStats'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (
    key: string,
    fallback?: string,
    variables?: Record<string, string | number>,
  ) => {
    const message = fallback ?? key
    if (!variables) return message
    return message.replace(
      /\{\{(\w+)\}\}|\{(\w+)\}/g,
      (_match, doubleToken: string, singleToken: string) =>
        String(variables[doubleToken ?? singleToken] ?? ''),
    )
  }

  return { useT: () => translate }
})

const stats: CatalogProductStats = {
  totals: {
    all: 100,
    active: 60,
    draft: 15,
    archived: 25,
  },
  productsInActiveOffers: 34,
  catalogValue: 90000,
  catalogValueCurrency: 'USD',
  // avg-per-item divides catalogValue by catalogValueProductCount (not totals.all):
  // 90000 / 100 = 900.
  catalogValueProductCount: 100,
}

describe('ProductsHero', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('renders the four KPI cards with the active and catalog-value captions', () => {
    render(<ProductsHero stats={stats} isLoading={false} error={null} />)

    expect(screen.getByText('Total products')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
    // percent = round(60 / 100 * 100)
    expect(screen.getByText('60% of catalog')).toBeInTheDocument()

    expect(screen.getByText('In active offers')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()

    // Compact currency string is locale-sensitive; assert the label + the
    // avg-per-item caption (avg = 90000 / 100 = 900) instead.
    expect(screen.getByText('Catalog value')).toBeInTheDocument()
    expect(screen.getByText('avg 900 USD / item')).toBeInTheDocument()

    // Draft and Archived KPI cards were removed in the redesign.
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
    // All four values resolved — no error placeholders.
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('renders an accessible loading placeholder per KPI card', () => {
    render(<ProductsHero stats={null} isLoading error={null} />)

    expect(screen.getAllByRole('status')).toHaveLength(4)
    expect(screen.getByRole('status', { name: 'Total products' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Active' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'In active offers' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Catalog value' })).toBeInTheDocument()
  })

  it('shows an em dash in every KPI card value on error', () => {
    render(
      <ProductsHero
        stats={null}
        isLoading={false}
        error="Product statistics are unavailable"
      />,
    )

    expect(screen.getAllByText('—')).toHaveLength(4)
    // The error surfaces as a placeholder dash, not the raw error string.
    expect(screen.queryByText('Product statistics are unavailable')).not.toBeInTheDocument()
  })

  it('renders the actions slot', () => {
    render(
      <ProductsHero
        stats={stats}
        isLoading={false}
        error={null}
        actions={<span>Product actions</span>}
      />,
    )

    expect(screen.getByText('Product actions')).toBeInTheDocument()
  })
})

describe('useCatalogProductStats', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('loads product statistics and refetches when the scope version changes', async () => {
    const scopedStats: CatalogProductStats = {
      totals: { all: 8, active: 6, draft: 1, archived: 1 },
      productsInActiveOffers: 3,
      catalogValue: 12000,
      catalogValueCurrency: 'USD',
      catalogValueProductCount: 6,
    }
    mockApiCall
      .mockResolvedValueOnce({ ok: true, result: stats })
      .mockResolvedValueOnce({ ok: true, result: scopedStats })

    const { result, rerender } = renderHook(
      ({ scopeVersion }: { scopeVersion: number }) => useCatalogProductStats(scopeVersion),
      { initialProps: { scopeVersion: 1 } },
    )

    await waitFor(() => expect(result.current.stats).toEqual(stats))
    rerender({ scopeVersion: 2 })
    await waitFor(() => expect(result.current.stats).toEqual(scopedStats))

    expect(mockApiCall).toHaveBeenCalledTimes(2)
    expect(mockApiCall).toHaveBeenCalledWith('/api/catalog/products/stats')
  })

  it('exposes reload for an explicit statistics refresh', async () => {
    const refreshedStats: CatalogProductStats = {
      totals: { all: 101, active: 61, draft: 15, archived: 25 },
      productsInActiveOffers: 35,
      catalogValue: 91000,
      catalogValueCurrency: 'USD',
      catalogValueProductCount: 100,
    }
    mockApiCall
      .mockResolvedValueOnce({ ok: true, result: stats })
      .mockResolvedValueOnce({ ok: true, result: refreshedStats })

    const { result } = renderHook(() => useCatalogProductStats())
    await waitFor(() => expect(result.current.stats).toEqual(stats))

    act(() => result.current.reload())
    await waitFor(() => expect(result.current.stats).toEqual(refreshedStats))

    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })
})
