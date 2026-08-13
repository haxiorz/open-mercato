import {
  commercialKind,
  deriveProductDisplayStatus,
  productLifecycleLabelKey,
  productStatusDot,
  productStatusMap,
  type ProductDisplayStatus,
} from '../productPresentation'

describe('commercialKind', () => {
  it.each([
    ['simple', 'physical'],
    ['configurable', 'physical'],
    ['virtual', 'service'],
    ['downloadable', 'service'],
    ['bundle', 'physical'],
    ['grouped', 'physical'],
    ['service', 'service'],
    ['subscription', 'subscription'],
    ['unknown', 'physical'],
  ] as const)('maps %s to %s presentation', (productType, expectedKind) => {
    expect(commercialKind(productType)).toBe(expectedKind)
  })
})

describe('deriveProductDisplayStatus', () => {
  const lifecycleStates = ['active', 'draft', 'archived', null, undefined, 'unknown'] as const
  const activeStates = [true, false, null, undefined] as const

  const expectedStatus = (
    lifecycleState: (typeof lifecycleStates)[number],
    isActive: (typeof activeStates)[number],
  ): ProductDisplayStatus => {
    if (lifecycleState === 'archived') return 'archived'
    if (lifecycleState === 'draft') return 'draft'
    if ((lifecycleState === 'active' || lifecycleState == null) && isActive === false) {
      return 'discontinued'
    }
    return 'active'
  }

  it.each(
    lifecycleStates.flatMap((lifecycleState) =>
      activeStates.map((isActive) => ({ lifecycleState, isActive })),
    ),
  )('derives the status for lifecycleState=$lifecycleState and isActive=$isActive', (input) => {
    expect(deriveProductDisplayStatus(input)).toBe(
      expectedStatus(input.lifecycleState, input.isActive),
    )
  })
})

describe('product status presentation', () => {
  it('maps display statuses to semantic badge variants', () => {
    expect(productStatusMap).toEqual({
      active: 'success',
      draft: 'neutral',
      archived: 'neutral',
      discontinued: 'error',
    })
  })

  it('enables dots only for light badges', () => {
    expect(productStatusDot).toEqual({
      active: true,
      draft: false,
      archived: false,
      discontinued: true,
    })
  })
})

describe('productLifecycleLabelKey', () => {
  it.each(['active', 'draft', 'archived', 'discontinued'] as const)(
    'returns the catalog lifecycle key for %s',
    (status) => {
      expect(productLifecycleLabelKey(status)).toBe(`catalog.products.lifecycle.${status}`)
    },
  )
})
