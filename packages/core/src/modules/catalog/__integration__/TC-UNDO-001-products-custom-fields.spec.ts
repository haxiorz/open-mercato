import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog.products custom fields (#2574, invariant I4) — a product custom-field
 * value reverts on undo and re-applies on redo.
 *
 * Self-contained: an ad-hoc integer custom field is created on the product entity
 * (`catalog:catalog_product` — the id the products list decorates) so the test never relies on
 * the demo product field-set. The shared round-trip then drives create→undo→…→delete with the
 * `cf_<key>` value as the asserted scalar, so I1 (update→undo) doubles as the I4 cf-restore
 * assertion and I6 (redo) re-applies it. The definition is removed in teardown.
 */

const PRODUCTS = '/api/catalog/products'
const DEFINITIONS = '/api/entities/definitions'
const PRODUCT_ENTITY_ID = 'catalog:catalog_product'

test.describe('TC-UNDO-001 catalog.products custom-field restore (I4)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('product custom field reverts on undo and re-applies on redo', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `undo_cf_${Date.now()}`
    let defCreated = false
    try {
      const def = await apiRequest(request, 'POST', DEFINITIONS, {
        token,
        data: { entityId: PRODUCT_ENTITY_ID, key, kind: 'integer', label: `Undo CF ${key}`, formEditable: true, listVisible: true },
      })
      expect(def.ok(), `cf def create ${def.status()}`).toBeTruthy()
      defCreated = true

      await runCrudUndoRoundTrip(request, token, {
        label: 'catalog.products(custom-fields)',
        collectionPath: PRODUCTS,
        field: `cf_${key}`,
        createPayload: (s) => ({ title: `CF Product ${s}`, sku: `cfp-${s}`, [`cf_${key}`]: 5 }),
        updatePayload: (id) => ({ id, [`cf_${key}`]: 10 }),
      })
    } finally {
      if (defCreated) {
        // The definitions DELETE route reads { entityId, key } from the request body, not the query string.
        await apiRequest(request, 'DELETE', DEFINITIONS, { token, data: { entityId: PRODUCT_ENTITY_ID, key } }).catch(() => {})
      }
    }
  })
})
