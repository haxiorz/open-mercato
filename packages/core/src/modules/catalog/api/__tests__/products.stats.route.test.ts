/** @jest-environment node */

type ProductFixture = {
  id: string
  organization_id: string
  tenant_id: string
  lifecycle_state: 'draft' | 'active' | 'archived'
  is_active: boolean
  deleted_at: Date | null
}

type OfferFixture = {
  product_id: string
  organization_id: string
  tenant_id: string
  is_active: boolean
  deleted_at: Date | null
}

type PriceFixture = {
  product_id: string
  currency_code: string | null
  unit_price_net: string | null
  price_kind_id: string
  organization_id: string
  tenant_id: string
}

type PriceKindFixture = {
  id: string
  code: string
  is_active: boolean
  deleted_at: Date | null
  organization_id: string
  tenant_id: string
}

type CatalogValueRow = {
  currency_code: string | null
  total: string | number | bigint | null
  product_count: string | number | bigint | null
}

type FixtureDatabase = {
  products: ProductFixture[]
  offers: OfferFixture[]
  prices: PriceFixture[]
  priceKinds: PriceKindFixture[]
}

type WhereClause = {
  column: string
  operator: string
  value: unknown
}

type FakeQueryBuilder = {
  select: jest.Mock
  innerJoin: jest.Mock
  where: jest.Mock
  groupBy: jest.Mock
  execute: jest.Mock
  executeTakeFirst: jest.Mock
}

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveFeatureCheckContext = jest.fn()
const mockUserHasAllFeatures = jest.fn()

let fixtureDatabase: FixtureDatabase = { products: [], offers: [], prices: [], priceKinds: [] }
let activeScope: { tenantId: string; filterIds: string[] | null } = { tenantId: '', filterIds: null }
let aggregateQueryCount = 0

// Replicates the route's catalog-value SQL: per (product_id, currency) take the
// highest regular `unit_price_net`, then per currency sum the totals and count
// the priced products. Honors the SQL joins/filters exactly:
//  - regular price kind matched on (id, tenant_id), active, not deleted
//  - product matched on (id, tenant_id), not deleted (excludes soft-deleted /
//    missing / foreign-tenant products)
//  - price scoped to the resolved tenant + organization filter
function computeCatalogValueRows(): CatalogValueRow[] {
  const filterIds = activeScope.filterIds
  const priceMatchesRegularKind = (price: PriceFixture) =>
    fixtureDatabase.priceKinds.some(
      (kind) =>
        kind.id === price.price_kind_id &&
        kind.tenant_id === price.tenant_id &&
        kind.code === 'regular' &&
        kind.is_active &&
        kind.deleted_at === null,
    )
  const priceHasLiveProduct = (price: PriceFixture) =>
    fixtureDatabase.products.some(
      (product) =>
        product.id === price.product_id &&
        product.tenant_id === price.tenant_id &&
        product.deleted_at === null,
    )
  const perProductMax = new Map<string, number>()
  for (const price of fixtureDatabase.prices) {
    if (price.tenant_id !== activeScope.tenantId) continue
    if (Array.isArray(filterIds) && !filterIds.includes(price.organization_id)) continue
    if (!priceMatchesRegularKind(price)) continue
    if (!priceHasLiveProduct(price)) continue
    const net = Number(price.unit_price_net)
    if (!Number.isFinite(net)) continue
    const key = `${price.product_id}::${price.currency_code ?? ''}`
    const current = perProductMax.get(key)
    if (current === undefined || net > current) perProductMax.set(key, net)
  }
  const perCurrency = new Map<string, { total: number; productCount: number }>()
  for (const [key, value] of perProductMax) {
    const currency = key.split('::')[1] ?? ''
    const bucket = perCurrency.get(currency) ?? { total: 0, productCount: 0 }
    bucket.total += value
    bucket.productCount += 1
    perCurrency.set(currency, bucket)
  }
  return Array.from(perCurrency.entries()).map(([currency, bucket]) => ({
    currency_code: currency.length ? currency : null,
    total: String(bucket.total),
    product_count: String(bucket.productCount),
  }))
}

// Raw `sql\`...\`.execute(db)` path is fed from the fixture. Kept on a
// `mock`-prefixed holder so the jest.mock factory may reference it.
const mockRawSql = {
  execute: async (): Promise<{ rows: CatalogValueRow[] }> => {
    aggregateQueryCount += 1
    return { rows: computeCatalogValueRows() }
  },
}

jest.mock('kysely', () => {
  const makeRawBuilder = () => {
    const builder: Record<string, unknown> = {
      as: () => builder,
      execute: (...args: unknown[]) => mockRawSql.execute(...(args as [])),
    }
    return builder
  }
  const sql = (..._args: unknown[]) => makeRawBuilder()
  sql.ref = () => makeRawBuilder()
  sql.raw = () => makeRawBuilder()
  return { sql }
})

function readFixtureColumn(
  tableName: 'catalog_products' | 'catalog_product_offers',
  row: ProductFixture | OfferFixture,
  column: string,
): unknown {
  const normalizedColumn = column.includes('.') ? column.split('.').at(-1) ?? column : column
  if (column.startsWith('catalog_products.') && tableName === 'catalog_product_offers') {
    const offer = row as OfferFixture
    const product = fixtureDatabase.products.find((entry) => entry.id === offer.product_id)
    return product?.[normalizedColumn as keyof ProductFixture]
  }
  return row[normalizedColumn as keyof typeof row]
}

function matchesWhere(
  tableName: 'catalog_products' | 'catalog_product_offers',
  row: ProductFixture | OfferFixture,
  clause: WhereClause,
): boolean {
  const actual = readFixtureColumn(tableName, row, clause.column)
  if (clause.operator === '=') return actual === clause.value
  if (clause.operator === 'is') return actual === clause.value
  if (clause.operator === 'in') {
    return Array.isArray(clause.value) && clause.value.includes(actual)
  }
  throw new Error(`Unsupported operator: ${clause.operator}`)
}

function createFakeQueryBuilder(
  tableName: 'catalog_products' | 'catalog_product_offers',
): FakeQueryBuilder {
  const whereClauses: WhereClause[] = []
  const builder = {} as FakeQueryBuilder
  builder.select = jest.fn(() => builder)
  builder.innerJoin = jest.fn(() => builder)
  builder.where = jest.fn((column: string, operator: string, value: unknown) => {
    whereClauses.push({ column, operator, value })
    return builder
  })
  builder.groupBy = jest.fn(() => builder)
  builder.execute = jest.fn(async () => {
    aggregateQueryCount += 1
    const products = fixtureDatabase.products.filter((row) =>
      whereClauses.every((clause) => matchesWhere(tableName, row, clause)),
    )
    const grouped = new Map<string, { lifecycle_state: ProductFixture['lifecycle_state']; is_active: boolean; count: number }>()
    for (const product of products) {
      const key = `${product.lifecycle_state}:${String(product.is_active)}`
      const existing = grouped.get(key)
      if (existing) {
        existing.count += 1
      } else {
        grouped.set(key, {
          lifecycle_state: product.lifecycle_state,
          is_active: product.is_active,
          count: 1,
        })
      }
    }
    return Array.from(grouped.values()).map((row) => ({
      ...row,
      count: String(row.count),
    }))
  })
  builder.executeTakeFirst = jest.fn(async () => {
    aggregateQueryCount += 1
    const offers = fixtureDatabase.offers.filter((row) => {
      const productExists = fixtureDatabase.products.some(
        (product) => product.id === row.product_id,
      )
      return productExists && whereClauses.every((clause) =>
        matchesWhere(tableName, row, clause),
      )
    })
    return { count: String(new Set(offers.map((offer) => offer.product_id)).size) }
  })
  return builder
}

const mockDatabase = {
  selectFrom: jest.fn((tableName: 'catalog_products' | 'catalog_product_offers') =>
    createFakeQueryBuilder(tableName),
  ),
}

const mockEntityManager = {
  fork: jest.fn(() => ({
    getKysely: jest.fn(() => mockDatabase),
  })),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') {
      return { userHasAllFeatures: mockUserHasAllFeatures }
    }
    if (token === 'em') return mockEntityManager
    throw new Error(`Unexpected dependency: ${token}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (request: Request) => mockGetAuthFromRequest(request),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (args: unknown) => mockResolveFeatureCheckContext(args),
}))

import { GET, metadata, openApi } from '../products/stats/route'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const organizationA = '33333333-3333-4333-8333-333333333333'
const organizationB = '44444444-4444-4444-8444-444444444444'

function setRequestScope(tenantId: string, organizationId: string) {
  activeScope = { tenantId, filterIds: [organizationId] }
  mockGetAuthFromRequest.mockResolvedValue({
    sub: '55555555-5555-4555-8555-555555555555',
    tenantId,
    orgId: organizationId,
  })
  mockResolveFeatureCheckContext.mockResolvedValue({
    organizationId,
    allowedOrganizationIds: [organizationId],
    scope: {
      tenantId,
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
    },
  })
}

function createRequest() {
  return new Request('http://localhost/api/catalog/products/stats')
}

beforeEach(() => {
  jest.clearAllMocks()
  fixtureDatabase = { products: [], offers: [], prices: [], priceKinds: [] }
  aggregateQueryCount = 0
  mockCreateRequestContainer.mockResolvedValue(mockContainer)
  mockUserHasAllFeatures.mockResolvedValue(true)
  setRequestScope(tenantA, organizationA)
})

describe('catalog product stats route', () => {
  it('declares the products view feature and OpenAPI GET documentation', () => {
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['catalog.products.view'],
    })
    expect(openApi.methods?.GET).toBeDefined()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await GET(createRequest())

    expect(response.status).toBe(401)
    expect(mockUserHasAllFeatures).not.toHaveBeenCalled()
    expect(aggregateQueryCount).toBe(0)
  })

  it('returns 403 without catalog.products.view', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      requiredFeatures: ['catalog.products.view'],
    })
    expect(aggregateQueryCount).toBe(0)
  })

  it('counts lifecycle fixtures and reports the dominant-currency catalog value', async () => {
    fixtureDatabase.products = [
      { id: 'active-visible', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: null },
      { id: 'active-disabled', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'active', is_active: false, deleted_at: null },
      { id: 'draft-visible', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'draft', is_active: true, deleted_at: null },
      { id: 'draft-disabled', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'draft', is_active: false, deleted_at: null },
      { id: 'archived-visible', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'archived', is_active: true, deleted_at: null },
      { id: 'archived-disabled', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'archived', is_active: false, deleted_at: null },
      { id: 'deleted-product', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: new Date() },
      { id: 'foreign-tenant', tenant_id: tenantB, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: null },
      { id: 'foreign-organization', tenant_id: tenantA, organization_id: organizationB, lifecycle_state: 'active', is_active: true, deleted_at: null },
    ]
    fixtureDatabase.offers = [
      { product_id: 'active-visible', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'active-visible', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'active-disabled', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'draft-visible', tenant_id: tenantA, organization_id: organizationA, is_active: false, deleted_at: null },
      { product_id: 'draft-disabled', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: new Date() },
      { product_id: 'archived-visible', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'deleted-product', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'foreign-tenant', tenant_id: tenantB, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'foreign-organization', tenant_id: tenantA, organization_id: organizationB, is_active: true, deleted_at: null },
    ]
    fixtureDatabase.priceKinds = [
      { id: 'kind-regular', code: 'regular', is_active: true, deleted_at: null, tenant_id: tenantA, organization_id: organizationA },
      { id: 'kind-promotion', code: 'promotion', is_active: true, deleted_at: null, tenant_id: tenantA, organization_id: organizationA },
    ]
    fixtureDatabase.prices = [
      // (active-visible, USD): highest regular price point wins -> 150
      { product_id: 'active-visible', currency_code: 'USD', unit_price_net: '100.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
      { product_id: 'active-visible', currency_code: 'USD', unit_price_net: '150.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
      // (draft-visible, USD) -> 50 ; USD total = 200
      { product_id: 'draft-visible', currency_code: 'USD', unit_price_net: '50.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
      // (active-visible, EUR) -> 40 ; EUR total = 40 (non-dominant)
      { product_id: 'active-visible', currency_code: 'EUR', unit_price_net: '40.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
      // promotion kind is excluded
      { product_id: 'active-disabled', currency_code: 'USD', unit_price_net: '999.00', price_kind_id: 'kind-promotion', tenant_id: tenantA, organization_id: organizationA },
      // other tenant / organization prices are excluded by scope
      { product_id: 'foreign-tenant', currency_code: 'USD', unit_price_net: '500.00', price_kind_id: 'kind-regular', tenant_id: tenantB, organization_id: organizationA },
      { product_id: 'foreign-organization', currency_code: 'USD', unit_price_net: '500.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationB },
    ]

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      totals: { all: 6, active: 1, draft: 2, archived: 2 },
      productsInActiveOffers: 3,
      catalogValue: 200,
      catalogValueCurrency: 'USD',
      // active-visible + draft-visible are the two USD-priced products
      catalogValueProductCount: 2,
    })
    // product counts + active offers + catalog value = 3 aggregate round-trips
    expect(aggregateQueryCount).toBe(3)
  })

  it('uses the resolved tenant scope and excludes fixtures from every other tenant', async () => {
    setRequestScope(tenantB, organizationA)
    fixtureDatabase.products = [
      { id: 'tenant-a-product', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'draft', is_active: true, deleted_at: null },
      { id: 'tenant-b-product', tenant_id: tenantB, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: null },
    ]
    fixtureDatabase.offers = [
      { product_id: 'tenant-a-product', tenant_id: tenantA, organization_id: organizationA, is_active: true, deleted_at: null },
      { product_id: 'tenant-b-product', tenant_id: tenantB, organization_id: organizationA, is_active: true, deleted_at: null },
    ]
    fixtureDatabase.priceKinds = [
      { id: 'kind-regular', code: 'regular', is_active: true, deleted_at: null, tenant_id: tenantB, organization_id: organizationA },
    ]
    fixtureDatabase.prices = [
      { product_id: 'tenant-a-product', currency_code: 'USD', unit_price_net: '300.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
      { product_id: 'tenant-b-product', currency_code: 'USD', unit_price_net: '75.00', price_kind_id: 'kind-regular', tenant_id: tenantB, organization_id: organizationA },
    ]

    const response = await GET(createRequest())

    await expect(response.json()).resolves.toEqual({
      totals: { all: 1, active: 1, draft: 0, archived: 0 },
      productsInActiveOffers: 1,
      catalogValue: 75,
      catalogValueCurrency: 'USD',
      catalogValueProductCount: 1,
    })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      expect.any(String),
      ['catalog.products.view'],
      { tenantId: tenantB, organizationId: organizationA },
    )
  })

  it('short-circuits to zeroed stats and skips every query for an empty organization scope', async () => {
    mockResolveFeatureCheckContext.mockResolvedValue({
      organizationId: null,
      allowedOrganizationIds: [],
      scope: { tenantId: tenantA, selectedId: null, filterIds: [], allowedIds: [] },
    })
    fixtureDatabase.products = [
      { id: 'unreachable', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: null },
    ]

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      totals: { all: 0, active: 0, draft: 0, archived: 0 },
      productsInActiveOffers: 0,
      catalogValue: 0,
      catalogValueCurrency: null,
      catalogValueProductCount: 0,
    })
    expect(aggregateQueryCount).toBe(0)
  })

  it('excludes a soft-deleted product price from catalog value and product count', async () => {
    fixtureDatabase.products = [
      { id: 'live-product', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: null },
      // Soft-deleted product: its (much larger) price must NOT count via the
      // `join catalog_products p ... and p.deleted_at is null` join.
      { id: 'gone-product', tenant_id: tenantA, organization_id: organizationA, lifecycle_state: 'active', is_active: true, deleted_at: new Date() },
    ]
    fixtureDatabase.priceKinds = [
      { id: 'kind-regular', code: 'regular', is_active: true, deleted_at: null, tenant_id: tenantA, organization_id: organizationA },
    ]
    fixtureDatabase.prices = [
      { product_id: 'live-product', currency_code: 'USD', unit_price_net: '30.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
      { product_id: 'gone-product', currency_code: 'USD', unit_price_net: '5000.00', price_kind_id: 'kind-regular', tenant_id: tenantA, organization_id: organizationA },
    ]

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      // gone-product is soft-deleted: excluded from product counts AND catalog value
      totals: { all: 1, active: 1, draft: 0, archived: 0 },
      productsInActiveOffers: 0,
      catalogValue: 30,
      catalogValueCurrency: 'USD',
      catalogValueProductCount: 1,
    })
  })
})
