/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ProductsGridView,
  type ProductGridItem,
} from '../ProductsGridView'

jest.mock('lucide-react', () => ({
  ChevronRight: () => <svg data-testid="chevron-right" />,
  Image: () => <svg data-testid="image-placeholder" />,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (
    key: string,
    fallback?: string,
    variables?: Record<string, string | number>,
  ) => {
    const message = fallback ?? key
    if (!variables) return message
    return message.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, doubleToken: string, singleToken: string) =>
      String(variables[doubleToken ?? singleToken] ?? ''),
    )
  }

  return { useT: () => translate }
})

const product: ProductGridItem = {
  id: 'product-1',
  title: 'Oak Lounge Chair',
  sku: 'FUR-OAK-01',
  productType: 'simple',
  lifecycleState: 'active',
  isActive: true,
  defaultMediaUrl: 'https://cdn.example.com/oak-chair.png',
  categories: ['Furniture', 'Living room'],
  pricing: {
    kind: 'regular',
    currency_code: 'usd',
    unit_price_net: '148.0000',
  },
  salesUnit: null,
  variantsCount: 4,
}

describe('ProductsGridView', () => {
  it('renders product identity, status, formatted price, and the commercial-kind chip', () => {
    render(
      <ProductsGridView
        items={[product]}
        isLoading={false}
        emptyState={null}
        onOpen={jest.fn()}
      />,
    )

    expect(screen.getByText('Oak Lounge Chair')).toBeInTheDocument()
    expect(screen.getByText('FUR-OAK-01')).toHaveClass('font-mono')
    expect(screen.getByText('Active').closest('[data-slot="badge"]')).toHaveAttribute(
      'data-variant',
      'success',
    )
    // Price is formatted (2-decimal max, uppercase currency) — no longer the raw
    // `unit_price_net`.
    expect(screen.getByText('148 USD')).toBeInTheDocument()
    expect(screen.queryByText('148.0000 USD')).not.toBeInTheDocument()
    expect(screen.getByText('Furniture')).toBeInTheDocument()
    // The type chip renders the commercial kind label (`simple` -> Physical),
    // not the raw product type.
    expect(screen.getByText('Physical')).toBeInTheDocument()
    expect(screen.queryByText('Simple')).not.toBeInTheDocument()
  })

  it('formats subscription pricing with a per-unit billing suffix', () => {
    const subscription: ProductGridItem = {
      id: 'product-2',
      title: 'Team Plan',
      sku: 'SUB-TEAM',
      productType: 'subscription',
      lifecycleState: 'active',
      isActive: true,
      defaultMediaUrl: null,
      categories: [],
      pricing: { kind: 'regular', currency_code: 'usd', unit_price_net: '50.00' },
      salesUnit: 'seat',
      variantsCount: 1,
    }

    render(
      <ProductsGridView
        items={[subscription]}
        isLoading={false}
        emptyState={null}
        onOpen={jest.fn()}
      />,
    )

    expect(screen.getByText('50 USD')).toBeInTheDocument()
    expect(screen.getByText('/seat')).toBeInTheDocument()
    expect(screen.getByText('Subscription')).toBeInTheDocument()
  })

  it('falls back to unit_price_gross when unit_price_net is blank/whitespace', () => {
    const grossOnly: ProductGridItem = {
      ...product,
      pricing: { kind: 'regular', currency_code: 'usd', unit_price_net: '   ', unit_price_gross: '99.00' },
    }

    render(
      <ProductsGridView
        items={[grossOnly]}
        isLoading={false}
        emptyState={null}
        onOpen={jest.fn()}
      />,
    )

    expect(screen.getByText('99 USD')).toBeInTheDocument()
  })

  it('renders no price amount when both unit_price_net and unit_price_gross are blank', () => {
    const priceless: ProductGridItem = {
      ...product,
      pricing: { kind: 'regular', currency_code: 'usd', unit_price_net: '  ', unit_price_gross: '' },
    }

    render(
      <ProductsGridView
        items={[priceless]}
        isLoading={false}
        emptyState={null}
        onOpen={jest.fn()}
      />,
    )

    expect(screen.queryByText(/USD/)).not.toBeInTheDocument()
  })

  it('passes through the provided empty state', () => {
    render(
      <ProductsGridView
        items={[]}
        isLoading={false}
        emptyState={<div>No products match this view</div>}
        onOpen={jest.fn()}
      />,
    )

    expect(screen.getByText('No products match this view')).toBeInTheDocument()
  })

  it('opens the product from both the card surface and variants link', () => {
    const onOpen = jest.fn()

    render(
      <ProductsGridView
        items={[product]}
        isLoading={false}
        emptyState={null}
        onOpen={onOpen}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Oak Lounge Chair' }))
    expect(onOpen).toHaveBeenLastCalledWith(product)

    onOpen.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Variants (4)' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenLastCalledWith(product)
  })

  it('renders skeleton cards while loading', () => {
    const { container } = render(
      <ProductsGridView
        items={[product]}
        isLoading
        emptyState={null}
        onOpen={jest.fn()}
      />,
    )

    expect(container.querySelectorAll('[data-slot="skeleton"]')).not.toHaveLength(0)
    expect(screen.queryByText('Oak Lounge Chair')).not.toBeInTheDocument()
  })
})
