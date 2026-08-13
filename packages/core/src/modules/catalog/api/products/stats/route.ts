import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely } from 'kysely'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CatalogProductLifecycleState } from '../../../data/types'

const logger = createLogger('catalog')
const VIEW_FEATURE = 'catalog.products.view'

type CatalogStatsDatabase = {
  catalog_products: {
    id: string
    organization_id: string
    tenant_id: string
    lifecycle_state: CatalogProductLifecycleState
    is_active: boolean
    deleted_at: Date | null
  }
  catalog_product_offers: {
    product_id: string
    organization_id: string
    tenant_id: string
    is_active: boolean
    deleted_at: Date | null
  }
  catalog_product_variant_prices: {
    product_id: string
    variant_id: string | null
    offer_id: string | null
    channel_id: string | null
    price_kind_id: string
    currency_code: string | null
    unit_price_net: string | null
    organization_id: string
    tenant_id: string
  }
  catalog_price_kinds: {
    id: string
    code: string
    is_active: boolean
    deleted_at: Date | null
    organization_id: string
    tenant_id: string
  }
}

type ProductCountRow = {
  lifecycle_state: CatalogProductLifecycleState
  is_active: boolean
  count: string | number | bigint
}

type OfferCountRow = {
  count: string | number | bigint
}

type CatalogValueRow = {
  currency_code: string | null
  total: string | number | bigint | null
  product_count: string | number | bigint | null
}

type FeatureAuthorizationService = {
  userHasAllFeatures: (
    userId: string,
    requiredFeatures: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

const totalsSchema = z.object({
  all: z.number(),
  active: z.number(),
  draft: z.number(),
  archived: z.number(),
})

const responseSchema = z.object({
  totals: totalsSchema,
  productsInActiveOffers: z.number(),
  catalogValue: z.number(),
  catalogValueCurrency: z.string().nullable(),
  catalogValueProductCount: z.number(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

function normalizeCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

async function loadStats(
  database: Kysely<CatalogStatsDatabase>,
  tenantId: string,
  organizationIds: string[] | null,
) {
  if (Array.isArray(organizationIds) && organizationIds.length === 0) {
    return {
      totals: { all: 0, active: 0, draft: 0, archived: 0 },
      productsInActiveOffers: 0,
      catalogValue: 0,
      catalogValueCurrency: null,
      catalogValueProductCount: 0,
    }
  }

  let productCountsQuery = database
    .selectFrom('catalog_products')
    .select([
      'lifecycle_state',
      'is_active',
      sql<string>`count(*)`.as('count'),
    ])
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)

  let activeOffersQuery = database
    .selectFrom('catalog_product_offers')
    .innerJoin(
      'catalog_products',
      'catalog_products.id',
      'catalog_product_offers.product_id',
    )
    .select(
      sql<string>`count(distinct ${sql.ref('catalog_product_offers.product_id')})`.as(
        'count',
      ),
    )
    .where('catalog_product_offers.tenant_id', '=', tenantId)
    .where('catalog_product_offers.deleted_at', 'is', null)
    .where('catalog_product_offers.is_active', '=', true)
    .where('catalog_products.tenant_id', '=', tenantId)
    .where('catalog_products.deleted_at', 'is', null)

  if (Array.isArray(organizationIds)) {
    productCountsQuery = productCountsQuery.where(
      'organization_id',
      'in',
      organizationIds,
    )
    activeOffersQuery = activeOffersQuery
      .where('catalog_product_offers.organization_id', 'in', organizationIds)
      .where('catalog_products.organization_id', 'in', organizationIds)
  }

  const organizationScope =
    Array.isArray(organizationIds) && organizationIds.length
      ? sql`and vp.organization_id = any(${organizationIds})`
      : sql``

  // Catalog value = sum of each product's highest regular price point (one value
  // per product across its variants/channels), grouped by currency so mixed-unit
  // catalogs report the dominant currency's total rather than adding unlike units.
  const [productRows, offerRow, catalogValueResult] = await Promise.all([
    productCountsQuery
      .groupBy(['lifecycle_state', 'is_active'])
      .execute() as Promise<ProductCountRow[]>,
    activeOffersQuery.executeTakeFirst() as Promise<OfferCountRow | undefined>,
    sql<CatalogValueRow>`
      select per_product.currency_code as currency_code,
             sum(per_product.product_price) as total,
             count(*) as product_count
      from (
        select vp.product_id, vp.currency_code,
               max(vp.unit_price_net) as product_price
        from catalog_product_variant_prices vp
        join catalog_price_kinds k
          on k.id = vp.price_kind_id and k.tenant_id = vp.tenant_id
        join catalog_products p
          on p.id = vp.product_id and p.tenant_id = vp.tenant_id
            and p.organization_id = vp.organization_id and p.deleted_at is null
        where k.code = 'regular' and k.is_active = true and k.deleted_at is null
          and vp.tenant_id = ${tenantId}
          ${organizationScope}
        group by vp.product_id, vp.currency_code
      ) per_product
      group by per_product.currency_code
    `.execute(database),
  ])
  const catalogValueRows = catalogValueResult.rows

  const totals = { all: 0, active: 0, draft: 0, archived: 0 }
  for (const row of productRows) {
    const count = normalizeCount(row.count)
    totals.all += count
    if (row.lifecycle_state === 'active' && row.is_active) {
      totals.active += count
    } else if (row.lifecycle_state === 'draft') {
      totals.draft += count
    } else if (row.lifecycle_state === 'archived') {
      totals.archived += count
    }
  }

  // Catalog value is a headline figure; when a tenant holds prices in multiple
  // currencies we report the dominant currency's sum rather than mixing units.
  let catalogValue = 0
  let catalogValueCurrency: string | null = null
  let catalogValueProductCount = 0
  for (const row of catalogValueRows) {
    const total = Number(row.total)
    if (!Number.isFinite(total)) continue
    if (total > catalogValue) {
      catalogValue = total
      catalogValueCurrency = row.currency_code ?? null
      catalogValueProductCount = normalizeCount(row.product_count)
    }
  }

  return {
    totals,
    productsInActiveOffers: normalizeCount(offerRow?.count),
    catalogValue,
    catalogValueCurrency,
    catalogValueProductCount,
  }
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request: req,
    })
    const tenantId = featureContext.scope.tenantId ?? auth.tenantId
    if (!tenantId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const rbacService = container.resolve('rbacService') as FeatureAuthorizationService
    const canView = await rbacService.userHasAllFeatures(auth.sub, [VIEW_FEATURE], {
      tenantId,
      organizationId: featureContext.organizationId,
    })
    if (!canView) {
      throw new CrudHttpError(403, {
        error: 'Forbidden',
        requiredFeatures: [VIEW_FEATURE],
      })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const database = em.getKysely<CatalogStatsDatabase>() as Kysely<CatalogStatsDatabase>
    const result = await loadStats(
      database,
      tenantId,
      featureContext.scope.filterIds,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    logger.error('catalog.products.stats.GET Unexpected error', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const getDoc: OpenApiMethodDoc = {
  summary: 'Read catalog product statistics',
  tags: ['Catalog'],
  responses: [
    { status: 200, description: 'Catalog product statistics', schema: responseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required' },
    { status: 403, description: 'Catalog product viewing permission required' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog product statistics',
  methods: {
    GET: getDoc,
  },
}
