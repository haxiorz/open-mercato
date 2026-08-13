import * as React from 'react'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import CatalogProductsStockCell from './widget.client'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'wms.injection.catalog-products-stock',
    features: ['wms.view'],
    priority: 50,
  },
  columns: [
    {
      id: 'wms_catalog_stock',
      header: 'wms.catalogStock.column',
      accessorKey: '_wms',
      sortable: false,
      size: 120,
      cell: ({ getValue }) => React.createElement(CatalogProductsStockCell, { value: getValue() }),
    },
  ],
}

export default widget
