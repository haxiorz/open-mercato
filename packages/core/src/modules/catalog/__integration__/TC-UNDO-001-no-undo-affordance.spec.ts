import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  extractOperation,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 §4 — non-undoable catalog command exposes no undo token (#2574).
 *
 * Every command-bus catalog mutation (products/variants/prices/offers/optionSchemas/
 * priceKinds/categories/productUnitConversions) is undoable. The product bulk-delete route is
 * the catalog command that intentionally does NOT support undo: it enqueues an async worker and
 * returns 202 with no `x-om-operation` envelope, so the UI shows no Undo affordance.
 *
 * Self-contained: the product is created via API; cleanup is best-effort because the worker may
 * have already removed it.
 */

const BULK_DELETE = '/api/catalog/bulk-delete'

test.describe('TC-UNDO-001 §4 catalog non-undoable command exposes no undo token', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('products bulk-delete emits no undo token', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `No Undo BulkDelete ${stamp}`,
        sku: `nubd-${stamp}`,
      })

      const res = await apiRequest(request, 'POST', BULK_DELETE, {
        token,
        data: { confirm: true, ids: [productId], scope: 'selected' },
      })
      expect(res.status(), `bulk-delete status ${res.status()}`).toBe(202)
      expect(extractOperation(res), 'catalog bulk-delete must not expose an undo token (§4)').toBeNull()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
