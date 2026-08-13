export {}

const registerCommand = jest.fn()
const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

const emitCrudSideEffectsCalls: Array<Record<string, unknown>> = []
jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async (payload: Record<string, unknown>) => {
      emitCrudSideEffectsCalls.push(payload)
      return actual.emitCrudSideEffects(payload)
    }),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const PRICE_KIND_ID = '44444444-4444-4444-8444-444444444444'

type StoredRecord = Record<string, unknown> & {
  id: string
  organizationId: string
  tenantId: string
}

type CommandResult = {
  productId: string
  basePriceApplied: boolean
}

type TestCommand = {
  id: string
  prepare?: (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
  execute: (input: Record<string, unknown>, ctx: unknown) => Promise<CommandResult>
  captureAfter?: (
    input: Record<string, unknown>,
    result: CommandResult,
    ctx: unknown,
  ) => Promise<Record<string, unknown> | null>
  buildLog?: (params: {
    result: CommandResult
    snapshots: Record<string, unknown>
  }) => Promise<Record<string, unknown> | null>
  undo?: (params: {
    logEntry: Record<string, unknown>
    ctx: unknown
  }) => Promise<void>
}

type Harness = {
  command: TestCommand
  ctx: unknown
  products: StoredRecord[]
  prices: StoredRecord[]
  events: string[]
  dataEngine: { markOrmEntityChange: jest.Mock }
}

function entityName(entity: unknown): string {
  if (typeof entity === 'function' && 'name' in entity) return entity.name
  return String(entity)
}

function matchesId(record: StoredRecord, where: Record<string, unknown>): boolean {
  return typeof where.id !== 'string' || record.id === where.id
}

function createHarness(options?: {
  regularPriceKind?: boolean
  regularPriceKindActive?: boolean
  existingProduct?: Partial<StoredRecord>
}): Harness {
  const products: StoredRecord[] = []
  const prices: StoredRecord[] = []
  const events: string[] = []
  const regularPriceKind = options?.regularPriceKind === false
    ? null
    : {
        id: PRICE_KIND_ID,
        code: 'regular',
        title: 'Regular',
        tenantId: TENANT_ID,
        organizationId: null,
        isActive: options?.regularPriceKindActive ?? true,
        deletedAt: null,
      }

  if (options?.existingProduct) {
    products.push({
      id: PRODUCT_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      title: 'Existing product',
      productType: 'simple',
      lifecycleState: 'active',
      isConfigurable: false,
      isActive: true,
      requiresShipping: true,
      createdAt: new Date('2026-08-10T10:00:00.000Z'),
      updatedAt: new Date('2026-08-10T10:00:00.000Z'),
      ...options.existingProduct,
    })
  }

  const em = {
    fork: jest.fn(),
    create: jest.fn((entity: unknown, payload: Record<string, unknown>) => {
      const name = entityName(entity)
      const record = {
        ...payload,
        id:
          typeof payload.id === 'string'
            ? payload.id
            : name === 'CatalogProductPrice'
              ? `price-${prices.length + 1}`
              : PRODUCT_ID,
      } as StoredRecord
      events.push(`create:${name}`)
      if (name === 'CatalogProduct') products.push(record)
      if (name === 'CatalogProductPrice') prices.push(record)
      return record
    }),
    persist: jest.fn(),
    remove: jest.fn((record: StoredRecord) => {
      const productIndex = products.indexOf(record)
      if (productIndex >= 0) products.splice(productIndex, 1)
      const priceIndex = prices.indexOf(record)
      if (priceIndex >= 0) prices.splice(priceIndex, 1)
    }),
    nativeDelete: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entityName(entity) !== 'CatalogProductPrice') return 0
      const ids =
        where.id && typeof where.id === 'object' && '$in' in where.id
          ? (where.id as { $in: string[] }).$in
          : []
      const retained = prices.filter((price) => !ids.includes(price.id))
      const deleted = prices.length - retained.length
      prices.splice(0, prices.length, ...retained)
      return deleted
    }),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entityName(entity) === 'CatalogProduct') {
        return products.find((product) => matchesId(product, where)) ?? null
      }
      return null
    }),
    count: jest.fn().mockResolvedValue(0),
    getReference: jest.fn((entity: unknown, id: string) => {
      if (entityName(entity) === 'CatalogPriceKind') return { ...regularPriceKind, id }
      return { id }
    }),
    flush: jest.fn(async () => {
      events.push('flush')
    }),
    begin: jest.fn(async () => {
      events.push('begin')
    }),
    commit: jest.fn(async () => {
      events.push('commit')
    }),
    rollback: jest.fn(async () => {
      events.push('rollback')
    }),
  }
  em.fork.mockReturnValue(em)

  findOneWithDecryption.mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      const name = entityName(entity)
      if (name === 'CatalogPriceKind') return regularPriceKind
      if (name === 'CatalogProduct') {
        return products.find((product) => matchesId(product, where)) ?? null
      }
      return null
    },
  )
  findWithDecryption.mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entityName(entity) !== 'CatalogProductPrice') return []
      const productId =
        typeof where.product === 'string'
          ? where.product
          : where.product && typeof where.product === 'object' && 'id' in where.product
            ? String(where.product.id)
            : null
      return prices.filter((price) => {
        const product = price.product
        const priceProductId =
          typeof product === 'string'
            ? product
            : product && typeof product === 'object' && 'id' in product
              ? String(product.id)
              : null
        return !productId || priceProductId === productId
      })
    },
  )

  const dataEngine = {
    markOrmEntityChange: jest.fn(),
  }
  const taxCalculationService = {
    calculateUnitAmounts: jest.fn(async (input: { amount: number; taxRate?: number | null }) => ({
      netAmount: input.amount,
      grossAmount: input.amount,
      taxAmount: 0,
      taxRate: input.taxRate ?? null,
    })),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      if (token === 'taxCalculationService') return taxCalculationService
      return undefined
    }),
  }
  const ctx = {
    container,
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
    },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }

  jest.isolateModules(() => {
    require('../products')
  })
  const command = (registerCommand.mock.calls as Array<[TestCommand]>)
    .map(([candidate]) => candidate)
    .find((candidate) => candidate.id === 'catalog.products.create')
  if (!command) throw new Error('catalog.products.create was not registered')

  return { command, ctx, products, prices, events, dataEngine }
}

function createInput(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    title: 'Test product',
    ...overrides,
  }
}

async function captureCreateLog(
  harness: Harness,
  input: Record<string, unknown>,
  result: CommandResult,
): Promise<Record<string, unknown>> {
  const after = await harness.command.captureAfter?.(input, result, harness.ctx)
  if (!after) throw new Error('Product create snapshot was not captured')
  const log = await harness.command.buildLog?.({ result, snapshots: { after } })
  if (!log) throw new Error('Product create log was not built')
  return log
}

describe('catalog.products lifecycle and base price', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    emitCrudSideEffectsCalls.length = 0
  })

  it('defaults lifecycle state to active', async () => {
    const harness = createHarness()

    await harness.command.execute(createInput(), harness.ctx)

    expect(harness.products[0]?.lifecycleState).toBe('active')
  })

  it('persists an explicit draft lifecycle state', async () => {
    const harness = createHarness()

    await harness.command.execute(
      createInput({ lifecycleState: 'draft' }),
      harness.ctx,
    )

    expect(harness.products[0]?.lifecycleState).toBe('draft')
  })

  it('defaults service shipping to false while preserving an explicit true value', async () => {
    const defaultHarness = createHarness()
    await defaultHarness.command.execute(
      createInput({ productType: 'service' }),
      defaultHarness.ctx,
    )

    const explicitHarness = createHarness()
    await explicitHarness.command.execute(
      createInput({ productType: 'service', requiresShipping: true }),
      explicitHarness.ctx,
    )

    expect(defaultHarness.products[0]?.requiresShipping).toBe(false)
    expect(explicitHarness.products[0]?.requiresShipping).toBe(true)
  })

  it('keeps the existing virtual product shipping default', async () => {
    const harness = createHarness()

    await harness.command.execute(
      createInput({ productType: 'virtual' }),
      harness.ctx,
    )

    expect(harness.products[0]?.requiresShipping).toBe(true)
  })

  it('creates a base price atomically and reports that it was applied', async () => {
    const harness = createHarness()

    const result = await harness.command.execute(
      createInput({
        basePrice: {
          unitPriceNet: '49.99',
          currencyCode: 'EUR',
          taxRate: 23,
        },
      }),
      harness.ctx,
    )

    expect(result.basePriceApplied).toBe(true)
    expect(harness.prices).toHaveLength(1)
    expect(harness.prices[0]).toMatchObject({
      product: harness.products[0],
      variant: null,
      offer: null,
      priceKind: expect.objectContaining({ id: PRICE_KIND_ID }),
      currencyCode: 'EUR',
      unitPriceNet: '49.99',
      taxRate: '23',
      minQuantity: 1,
    })
    expect(harness.events.indexOf('begin')).toBeLessThan(
      harness.events.indexOf('create:CatalogProductPrice'),
    )
    expect(harness.events.indexOf('create:CatalogProductPrice')).toBeLessThan(
      harness.events.indexOf('commit'),
    )
    expect(harness.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        events: expect.objectContaining({ module: 'catalog', entity: 'price' }),
      }),
    )
  })

  it('creates the product without a price when the regular kind is missing', async () => {
    const harness = createHarness({ regularPriceKind: false })

    const result = await harness.command.execute(
      createInput({
        basePrice: { unitPriceNet: 25, currencyCode: 'USD' },
      }),
      harness.ctx,
    )

    expect(result.basePriceApplied).toBe(false)
    expect(harness.products).toHaveLength(1)
    expect(harness.prices).toHaveLength(0)
  })

  it('undo removes both the created product and its base price', async () => {
    const harness = createHarness()
    const input = createInput({
      basePrice: { unitPriceNet: 10, currencyCode: 'PLN' },
    })
    const result = await harness.command.execute(input, harness.ctx)
    const log = await captureCreateLog(harness, input, result)

    await harness.command.undo?.({
      logEntry: { commandPayload: log.payload },
      ctx: harness.ctx,
    })

    expect(harness.products).toHaveLength(0)
    expect(harness.prices).toHaveLength(0)
    const priceDeletions = emitCrudSideEffectsCalls.filter(
      (call) => call.action === 'deleted' &&
        typeof call.identifiers === 'object' &&
        (call.identifiers as Record<string, unknown>).id === 'price-1',
    )
    expect(priceDeletions).toHaveLength(1)
  })

  it('creates the product without a price when the regular kind is inactive', async () => {
    const harness = createHarness({ regularPriceKindActive: false })
    const input = createInput({
      basePrice: { unitPriceNet: 10, currencyCode: 'PLN' },
    })

    const result = await harness.command.execute(input, harness.ctx)

    expect(result.basePriceApplied).toBe(false)
    expect(harness.products).toHaveLength(1)
    expect(harness.prices).toHaveLength(0)
  })

  it('round-trips lifecycle updates through undo', async () => {
    const harness = createHarness({ existingProduct: { lifecycleState: 'active' } })
    const updateCommand = (registerCommand.mock.calls as Array<[TestCommand]>)
      .map(([candidate]) => candidate)
      .find((candidate) => candidate.id === 'catalog.products.update')
    if (!updateCommand) throw new Error('catalog.products.update was not registered')
    const input = {
      id: PRODUCT_ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      lifecycleState: 'archived',
    }
    const snapshots = await updateCommand.prepare?.(input, harness.ctx)
    const result = await updateCommand.execute(input, harness.ctx)
    const after = await updateCommand.captureAfter?.(input, result, harness.ctx)
    const log = await updateCommand.buildLog?.({
      result,
      snapshots: { ...snapshots, after },
    })
    if (!log) throw new Error('Product update log was not built')

    expect(harness.products[0]?.lifecycleState).toBe('archived')
    expect(log.changes).toMatchObject({
      lifecycleState: { from: 'active', to: 'archived' },
    })

    await updateCommand.undo?.({
      logEntry: { commandPayload: log.payload },
      ctx: harness.ctx,
    })

    expect(harness.products[0]?.lifecycleState).toBe('active')
  })
})
