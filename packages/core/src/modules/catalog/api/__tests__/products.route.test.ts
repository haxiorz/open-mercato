type CapturedCrudOptions = {
  hooks?: {
    afterList?: (
      payload: { items?: Array<Record<string, unknown>> },
      ctx: Record<string, unknown>,
    ) => Promise<void>
  }
  actions?: {
    create?: {
      mapInput?: (args: {
        raw: unknown
        parsed: unknown
        ctx: Record<string, unknown>
      }) => Promise<unknown>
      response?: (args: {
        result: Record<string, unknown>
        logEntry: null
        ctx: Record<string, unknown>
      }) => unknown
    }
  }
}

let mockCrudOptions: CapturedCrudOptions | null = null

const mockMakeCrudRoute = jest.fn((options: CapturedCrudOptions) => {
  mockCrudOptions = options
  return {
    GET: jest.fn(),
    POST: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  }
})

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: CapturedCrudOptions) => mockMakeCrudRoute(options),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import {
  parseIdList,
  buildProductFilters,
  buildPricingContext,
  scoreProductSearchRelevance,
} from '../products/route'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'
import { buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  buildCustomFieldFiltersFromQuery: jest.fn(),
  extractAllCustomFieldEntries: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog products route helpers', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
    mockFindWithDecryption.mockImplementation(
      (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) =>
        em.find(...args),
    )
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValue({ custom: { $eq: 'value' } })
  })

  it('sanitizes search terms and parses identifiers', () => {
    expect(sanitizeSearchTerm('  shoes_% ')).toBe('shoes')
    expect(parseBooleanFlag('true')).toBe(true)
    expect(parseBooleanFlag('unknown')).toBeUndefined()
    expect(parseIdList('id1,not-a-uuid')).toHaveLength(0)
    expect(parseIdList('11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222')).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
  })

  it('builds pricing context with sensible defaults and fallbacks', () => {
    const ctx = buildPricingContext({ quantity: 'not-a-number', priceDate: 'invalid', channelId: null } as any, 'channel-fallback')
    expect(ctx.quantity).toBe(1)
    expect(ctx.channelId).toBe('channel-fallback')
    expect(ctx.date).toBeInstanceOf(Date)
  })

  it('builds product filters and merges offer + custom field context', async () => {
    const productRows = [
      { id: 'prod-1' },
      { id: 'prod-2' },
      { id: 'prod-3' },
    ]
    const offerRows = [
      { id: 'offer-1', product: 'prod-1' },
      { id: 'offer-2', product: { id: 'prod-2' } },
    ]
    const forkedEm = {
      find: jest
        .fn()
        .mockResolvedValueOnce(productRows)
        .mockResolvedValueOnce(offerRows),
    }
    const em = { fork: () => forkedEm }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    const filters = await buildProductFilters(
      {
        search: '  luxe_% ',
        status: ' status ',
        isActive: 'true',
        configurable: 'false',
        channelIds: '11111111-1111-4111-8111-111111111111',
        customFieldset: ' fashion ',
      } as any,
      { container, auth: { tenantId: 'tenant-1' } } as any,
    )

    expect(forkedEm.find).toHaveBeenCalledTimes(2)
    expect(buildCustomFieldFiltersFromQuery).toHaveBeenCalledWith({
      entityIds: expect.any(Array),
      query: expect.any(Object),
      em,
      tenantId: 'tenant-1',
      fieldset: 'fashion',
    })
    expect(filters.status_entry_id).toEqual({ $eq: 'status' })
    expect(filters.is_active).toBe(true)
    expect(filters.is_configurable).toBe(false)
    expect(filters.id).toEqual({ $in: ['prod-1', 'prod-2'] })
    expect((filters as any).custom).toEqual({ $eq: 'value' })
  })

  it('maps lifecycleState to the lifecycle_state equality filter', async () => {
    const em = { fork: () => ({ find: jest.fn() }) }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValueOnce({})

    const filters = await buildProductFilters(
      { lifecycleState: 'draft' } as never,
      { container, auth: { tenantId: 'tenant-1' } } as never,
    )

    expect(filters.lifecycle_state).toEqual({ $eq: 'draft' })
  })

  it('adds grouped non-deleted variant counts to every listed product', async () => {
    const whereCalls: unknown[][] = []
    const countQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn((...args: unknown[]) => {
        whereCalls.push(args)
        return countQuery
      }),
      groupBy: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([
        { product_id: 'product-1', count: '2' },
        { product_id: 'product-2', count: 1 },
      ]),
    }
    const database = {
      selectFrom: jest.fn().mockReturnValue(countQuery),
    }
    const forkedEm = {
      getKysely: jest.fn().mockReturnValue(database),
    }
    const pricingService = {
      resolvePriceMany: jest.fn().mockResolvedValue([null, null, null]),
    }
    const container = {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return { fork: () => forkedEm }
        if (token === 'catalogPricingService') return pricingService
        throw new Error(`Unexpected dependency: ${token}`)
      }),
    }
    mockFindWithDecryption.mockResolvedValue([])
    const items: Array<Record<string, unknown>> = [
      { id: 'product-1', title: 'One', sku: 'ONE' },
      { id: 'product-2', title: 'Two', sku: 'TWO' },
      { id: 'product-3', title: 'Three', sku: 'THREE' },
    ]
    const afterList = mockCrudOptions?.hooks?.afterList

    expect(afterList).toBeDefined()
    await afterList?.(
      { items },
      {
        container,
        auth: { tenantId: 'tenant-1', orgId: 'org-1' },
        selectedOrganizationId: 'org-1',
        query: {},
      },
    )

    expect(database.selectFrom).toHaveBeenCalledWith('catalog_product_variants')
    expect(whereCalls).toEqual(expect.arrayContaining([
      ['product_id', 'in', ['product-1', 'product-2', 'product-3']],
      ['deleted_at', 'is', null],
      ['organization_id', '=', 'org-1'],
      ['tenant_id', '=', 'tenant-1'],
    ]))
    expect(countQuery.groupBy).toHaveBeenCalledWith('product_id')
    expect(items.map((item) => item.variants_count)).toEqual([2, 1, 0])
  })

  it('passes basePriceApplied through the create action response', () => {
    const response = mockCrudOptions?.actions?.create?.response?.({
      result: {
        productId: '11111111-1111-4111-8111-111111111111',
        basePriceApplied: true,
      },
      logEntry: null,
      ctx: {},
    })

    expect(response).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      basePriceApplied: true,
    })
  })

  it('rejects basePrice before command execution without catalog.pricing.manage', async () => {
    const userHasAllFeatures = jest.fn().mockResolvedValue(false)
    const container = {
      resolve: jest.fn((token: string) => {
        if (token === 'rbacService') return { userHasAllFeatures }
        throw new Error(`Unexpected dependency: ${token}`)
      }),
    }
    const mapInput = mockCrudOptions?.actions?.create?.mapInput

    expect(mapInput).toBeDefined()
    await expect(mapInput?.({
      raw: { title: 'Restricted product', basePrice: { unitPriceNet: '12.00' } },
      parsed: {},
      ctx: {
        container,
        auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
        selectedOrganizationId: 'org-1',
      },
    })).rejects.toMatchObject({ status: 403 })
    expect(userHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['catalog.pricing.manage'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('dispatches independent filter prequeries concurrently and intersects them (issue #3179)', async () => {
    const expectedConcurrent = 4
    let dispatched = 0
    let releaseBarrier: () => void = () => {}
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })

    const rowsForWhere = (where: any) => {
      if (where?.$or) return [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
      if (where?.channelId) return [{ id: 'o2', product: 'p2' }, { id: 'o3', product: 'p3' }, { id: 'o4', product: 'p4' }]
      if (where?.category) return [{ id: 'a2', product: 'p2' }, { id: 'a3', product: 'p3' }]
      if (where?.tag) return [{ id: 't3', product: { id: 'p3' } }]
      return []
    }

    // Each query parks on a shared barrier that only releases once every
    // independent prequery has been dispatched. Sequential awaits can never
    // reach that count, so this resolves only when they run concurrently.
    const find = jest.fn().mockImplementation(async (_entity: unknown, where: any) => {
      dispatched += 1
      if (dispatched >= expectedConcurrent) releaseBarrier()
      await barrier
      return rowsForWhere(where)
    })
    const forkedEm = { find }
    const em = { fork: () => forkedEm }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValueOnce({})

    let timer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('filter prequeries were awaited sequentially, not dispatched concurrently')),
        1000,
      )
    })

    try {
      const filters = await Promise.race([
        buildProductFilters(
          {
            search: 'widget',
            channelIds: '11111111-1111-4111-8111-111111111111',
            categoryIds: '22222222-2222-4222-8222-222222222222',
            tagIds: '33333333-3333-4333-8333-333333333333',
          } as any,
          { container, auth: { tenantId: 'tenant-1' } } as any,
        ),
        guard,
      ])

      expect(find).toHaveBeenCalledTimes(expectedConcurrent)
      // search {p1,p2,p3} ∩ channel {p2,p3,p4} ∩ category {p2,p3} ∩ tag {p3} = {p3}
      expect(filters.id).toEqual({ $eq: 'p3' })
    } finally {
      if (timer) clearTimeout(timer)
      releaseBarrier()
    }
  })

  it('falls back to sentinel id when restricted products exclude the requested record', async () => {
    const forkedEm = {
      find: jest.fn().mockResolvedValue([{ product: 'prod-allowed' }]),
    }
    const em = { fork: () => forkedEm }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValueOnce({})

    const filters = await buildProductFilters(
      {
        id: 'prod-requested',
        channelIds: '11111111-1111-4111-8111-111111111111',
      } as any,
      { container, auth: { tenantId: 'tenant-1' } } as any,
    )

    expect(filters.id).toEqual({ $eq: '00000000-0000-0000-0000-000000000000' })
  })

  it('scores obvious product title and sku matches by relevance', () => {
    expect(scoreProductSearchRelevance('aurora', 'Aurora', 'AU-01')).toBe(0)
    expect(scoreProductSearchRelevance('aurora', 'Northern Lights', 'aurora')).toBe(1)
    expect(scoreProductSearchRelevance('aurora', 'Aurora Borealis', 'AB-01')).toBe(2)
    expect(scoreProductSearchRelevance('aurora', 'Northern Lights', 'AURORA-SKU')).toBe(3)
    expect(scoreProductSearchRelevance('aurora', 'Polar Aurora Light', 'NL-01')).toBe(4)
    expect(scoreProductSearchRelevance('aurora', 'Northern Lights', 'SKU-AURORA-01')).toBe(5)
    expect(scoreProductSearchRelevance('aurora', 'Borealis', 'NL-01')).toBe(6)
  })

  it('supports case-insensitive title matching for issue 1350 scenarios', () => {
    const ranked = [
      { title: 'Alpha', sku: 'SKU-A' },
      { title: 'Aurora', sku: 'AU-01' },
      { title: 'Northern Lights', sku: 'AURORA-SKU' },
      { title: 'Aurora Borealis', sku: 'AB-01' },
    ]
      .map((entry) => ({
        ...entry,
        score: scoreProductSearchRelevance('aurora', entry.title, entry.sku),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) return left.score - right.score
        return left.title.localeCompare(right.title)
      })

    expect(ranked.map((entry) => entry.title)).toEqual([
      'Aurora',
      'Aurora Borealis',
      'Northern Lights',
      'Alpha',
    ])
  })
})
