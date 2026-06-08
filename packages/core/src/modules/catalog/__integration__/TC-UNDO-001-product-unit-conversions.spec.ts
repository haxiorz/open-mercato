import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe, expectId } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  expectOperation,
  expectTokenConsumed,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog.productUnitConversions (#2574) — relation-graph undo for unit conversions.
 *
 * Conversions reference a product and require a valid unit code (any non-empty code; `box` here
 * — a test-data choice, not a product defect). The create/update commands cover I3 (create→undo
 * removes), I5 (token consumed), I1 (update→undo restores `to_base_factor`) and I6 (redo
 * re-applies). The delete→undo (I2) case is quarantined below — see the `test.fixme` note.
 */

const CONVERSIONS = '/api/catalog/product-unit-conversions'

async function readConversion(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(
    await apiRequest(request, 'GET', `${CONVERSIONS}?id=${id}`, { token }),
  )
  return body?.items?.find((row) => row.id === id) ?? null
}

test.describe('TC-UNDO-001 catalog.productUnitConversions undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('conversion create/update commands restore scalar state on undo/redo', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `Undo Conversion Parent ${stamp}`,
        sku: `ucp-${stamp}`,
      })

      // I3 + I5: create → undo removes the row, and the token cannot be reused.
      const createForUndo = expectOperation(
        await apiRequest(request, 'POST', CONVERSIONS, { token, data: { productId, unitCode: 'box', toBaseFactor: 12 } }),
        'catalog.productUnitConversions.create',
      )
      const createdId = expectId(createForUndo.resourceId, 'conversion create id')
      expect(await readConversion(request, token, createdId), 'conversion readable after create').toBeTruthy()
      await undoOk(request, token, createForUndo.undoToken, 'undo conversion create')
      expect(await readConversion(request, token, createdId), 'create→undo removes conversion (I3)').toBeNull()
      await expectTokenConsumed(request, token, createForUndo.undoToken, 'conversion create token consumed (I5)')

      // I1 + I6: update → undo restores the prior factor, redo re-applies it.
      const cycleOp = expectOperation(
        await apiRequest(request, 'POST', CONVERSIONS, { token, data: { productId, unitCode: 'box', toBaseFactor: 12 } }),
        'catalog.productUnitConversions.create',
      )
      const cycleId = expectId(cycleOp.resourceId, 'conversion cycle id')
      const updateOp = expectOperation(
        await apiRequest(request, 'PUT', CONVERSIONS, { token, data: { id: cycleId, toBaseFactor: 24 } }),
        'catalog.productUnitConversions.update',
      )
      expect(Number((await readConversion(request, token, cycleId))?.to_base_factor), 'conversion updated').toBe(24)
      await undoOk(request, token, updateOp.undoToken, 'undo conversion update')
      expect(Number((await readConversion(request, token, cycleId))?.to_base_factor), 'update→undo restores to_base_factor (I1)').toBe(12)
      await redoOk(request, token, updateOp.logId, 'redo conversion update')
      expect(Number((await readConversion(request, token, cycleId))?.to_base_factor), 'redo re-applies update (I6)').toBe(24)
    } finally {
      // The conversions DELETE route is broken (see the fixme below), so children are cleaned up
      // by deleting the parent product.
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  // FIXME(#2574 follow-up): `DELETE /api/catalog/product-unit-conversions` cannot resolve the
  // record id, so delete→undo (I2) cannot be exercised. The route's delete `mapInput` validates a
  // flat `{ id }` schema against the CRUD factory's `{ body, query }` raw object
  // (packages/core/src/modules/catalog/api/product-unit-conversions/route.ts), so the `deleteCrud`
  // UI contract (`DELETE ?id=`) and a JSON `{ id }` body both return 400 — i.e. conversions cannot
  // be deleted from the UI either. Sibling catalog routes (variants/prices/option-schemas) resolve
  // the id via `resolveCrudRecordId(parsed, ctx)`. Drop `.fixme` once the route is fixed.
  test.fixme('conversion delete→undo re-materializes the row (I2)', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `Undo Conversion Delete ${stamp}`,
        sku: `ucd-${stamp}`,
      })
      const createOp = expectOperation(
        await apiRequest(request, 'POST', CONVERSIONS, { token, data: { productId, unitCode: 'box', toBaseFactor: 12 } }),
        'catalog.productUnitConversions.create',
      )
      const conversionId = expectId(createOp.resourceId, 'conversion id')

      const deleteOp = expectOperation(
        await apiRequest(request, 'DELETE', `${CONVERSIONS}?id=${conversionId}`, { token }),
        'catalog.productUnitConversions.delete',
      )
      expect(await readConversion(request, token, conversionId), 'deleted conversion should not read').toBeNull()
      await undoOk(request, token, deleteOp.undoToken, 'undo conversion delete')
      expect(await readConversion(request, token, conversionId), 'delete→undo re-materializes (I2)').toBeTruthy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
