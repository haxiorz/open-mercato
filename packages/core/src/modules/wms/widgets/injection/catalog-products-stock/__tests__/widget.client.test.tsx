/** @jest-environment jsdom */

import { isValidElement } from 'react'
import { render, screen } from '@testing-library/react'
import injectionTable from '../../../injection-table'
import widget from '../widget'

function buildFixtureRow(state: string, available: string) {
  return {
    _wms: {
      inventoryProfile: null,
      stockSummary: [],
      reorderStatus: {
        state,
        available,
        reorderPoint: '10',
        safetyStock: '5',
      },
    },
  }
}

function renderStockCell(row: { _wms?: unknown }) {
  const cell = widget.columns[0]?.cell
  expect(cell).toBeDefined()

  const rendered = cell?.({ getValue: () => row._wms })
  expect(isValidElement(rendered)).toBe(true)
  render(rendered)
}

describe('catalog products stock column widget', () => {
  it('registers the catalog products column with the WMS feature gate', () => {
    expect(widget.metadata.features).toEqual(['wms.view'])
    expect(widget.columns[0]).toMatchObject({
      id: 'wms_catalog_stock',
      header: 'wms.catalogStock.column',
      accessorKey: '_wms',
      sortable: false,
    })
    expect(injectionTable['data-table:catalog.products:columns']).toEqual({
      widgetId: 'wms.injection.catalog-products-stock',
      priority: 50,
    })
    expect(injectionTable['data-table:catalog.products.list:columns']).toEqual({
      widgetId: 'wms.injection.catalog-products-stock',
      priority: 50,
    })
  })

  it.each([
    ['below_safety_stock', '4', 'text-status-error-text'],
    ['below_reorder_point', '8', 'text-status-warning-text'],
    ['healthy', '18', 'text-foreground'],
  ])('renders %s quantity with its semantic severity class', (state, available, severityClass) => {
    renderStockCell(buildFixtureRow(state, available))

    expect(screen.getByText(available)).toHaveClass('text-sm', 'tabular-nums', severityClass)
  })

  it('renders a muted fallback when the WMS enrichment is absent', () => {
    renderStockCell({})

    expect(screen.getByText('—')).toHaveClass('text-sm', 'text-muted-foreground')
  })
})
