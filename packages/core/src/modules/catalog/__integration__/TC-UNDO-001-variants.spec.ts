import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  expectOperation,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog.variants (#2574) — relation-graph undo for product variants.
 *
 * Covers I1 (update→undo restores scalar), I2 (delete→undo re-materializes),
 * I3 (create→undo removes), I5 (token consumed) and I6 (redo re-applies) via the shared
 * round-trip helper, plus an explicit relation assertion that a restored variant keeps
 * its parent `product_id` (children restore with the parent product).
 */

const VARIANTS = '/api/catalog/variants'

test.describe('TC-UNDO-001 catalog.variants undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('variant CRUD commands restore scalar state on undo/redo', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `Undo Variant Parent ${stamp}`,
        sku: `uvp-${stamp}`,
      })
      const parentId = productId

      await runCrudUndoRoundTrip(request, token, {
        label: 'catalog.variants',
        collectionPath: VARIANTS,
        field: 'name',
        createPayload: (s) => ({ productId: parentId, name: `Undo Variant ${s}`, sku: `uv-${s}`, isActive: true }),
        updatePayload: (id, s) => ({ id, name: `Undo Variant Renamed ${s}` }),
      })
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('variant re-materializes under its parent product on delete→undo (relation)', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let variantId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `Undo Variant Rel ${stamp}`,
        sku: `uvr-${stamp}`,
      })
      variantId = await createVariantFixture(request, token, {
        productId,
        name: `Rel Variant ${stamp}`,
        sku: `relv-${stamp}`,
      })

      const deleteOp = expectOperation(
        await apiRequest(request, 'DELETE', `${VARIANTS}?id=${variantId}`, { token }),
        'catalog.variants.delete',
      )
      const removed = await readJsonSafe<{ items?: unknown[] }>(
        await apiRequest(request, 'GET', `${VARIANTS}?id=${variantId}`, { token }),
      )
      expect(removed?.items ?? [], 'variant removed after delete').toHaveLength(0)

      await undoOk(request, token, deleteOp.undoToken, 'undo variant delete')

      const restored = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(
        await apiRequest(request, 'GET', `${VARIANTS}?id=${variantId}`, { token }),
      )
      const row = restored?.items?.[0]
      expect(row, 'variant re-materialized on undo (I2)').toBeTruthy()
      expect(row?.product_id, 'restored variant still linked to its parent product').toBe(productId)
    } finally {
      if (variantId) await apiRequest(request, 'DELETE', `${VARIANTS}?id=${variantId}`, { token }).catch(() => {})
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
