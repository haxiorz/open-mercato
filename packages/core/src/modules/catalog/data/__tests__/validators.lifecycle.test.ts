import { CATALOG_PRODUCT_LIFECYCLE_STATES } from '../types'
import { productCreateSchema, productUpdateSchema } from '../validators'

const baseProduct = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  title: 'Lifecycle product',
}

describe('product lifecycle and type validators', () => {
  it.each(CATALOG_PRODUCT_LIFECYCLE_STATES)(
    'accepts the %s lifecycle state on create',
    (lifecycleState) => {
      const result = productCreateSchema.safeParse({
        ...baseProduct,
        lifecycleState,
      })

      expect(result.success).toBe(true)
    },
  )

  it('rejects an unknown lifecycle state on create', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      lifecycleState: 'retired',
    })

    expect(result.success).toBe(false)
  })

  it.each(['service', 'subscription'] as const)(
    'accepts the %s product type on create',
    (productType) => {
      const result = productCreateSchema.safeParse({
        ...baseProduct,
        productType,
      })

      expect(result.success).toBe(true)
    },
  )

  it('does not inject a lifecycle state into partial updates', () => {
    const parsed = productUpdateSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
    })

    expect(parsed).not.toHaveProperty('lifecycleState')
  })
})

describe('product base price validator', () => {
  it('accepts and normalizes a valid base price', () => {
    const parsed = productCreateSchema.parse({
      ...baseProduct,
      basePrice: {
        unitPriceNet: '19.99',
        currencyCode: ' USD ',
        taxRate: '23',
      },
    })

    expect(parsed.basePrice).toEqual({
      unitPriceNet: 19.99,
      currencyCode: 'USD',
      taxRate: 23,
    })
  })

  it('rejects a negative base price amount', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      basePrice: {
        unitPriceNet: -0.01,
        currencyCode: 'USD',
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects a base price without a net amount', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      basePrice: {
        currencyCode: 'USD',
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects a base price with an invalid currency code', () => {
    const result = productCreateSchema.safeParse({
      ...baseProduct,
      basePrice: {
        unitPriceNet: 19.99,
        currencyCode: 'US',
      },
    })

    expect(result.success).toBe(false)
  })

  it('accepts create payloads without a base price', () => {
    const parsed = productCreateSchema.parse(baseProduct)

    expect(parsed).not.toHaveProperty('basePrice')
  })
})
