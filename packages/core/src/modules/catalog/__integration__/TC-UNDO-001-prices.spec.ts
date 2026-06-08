import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe, expectId } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog.prices (#2574) — relation-graph undo for product prices.
 *
 * Prices reference a product and a price kind, so the round trip closes over both parents.
 * The asserted scalar is the numeric `unit_price_net`, so I1/I6 verify that a price edit
 * reverts to (and redo re-applies) the exact pre-command amount. Prices are hard-deleted,
 * so I2 also proves delete→undo re-materializes the row from the command snapshot.
 */

const PRICES = '/api/catalog/prices'
const PRICE_KINDS = '/api/catalog/price-kinds'

test.describe('TC-UNDO-001 catalog.prices undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('price CRUD commands restore the exact amount on undo/redo', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let priceKindId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `Undo Price Parent ${stamp}`,
        sku: `upp-${stamp}`,
      })

      const kindRes = await apiRequest(request, 'POST', PRICE_KINDS, {
        token,
        data: { code: `undo_price_pk_${stamp}`, title: `Undo Price Kind ${stamp}` },
      })
      expect(kindRes.ok(), `price kind create ${kindRes.status()}`).toBeTruthy()
      priceKindId = expectId((await readJsonSafe<{ id?: string }>(kindRes))?.id, 'price kind id')

      const parentProductId = productId
      const parentKindId = priceKindId
      await runCrudUndoRoundTrip(request, token, {
        label: 'catalog.prices',
        collectionPath: PRICES,
        // The prices list filters by productId/variantId/etc., not by id, so read the
        // product-scoped collection and let the harness match the row by its operation id.
        readPath: () => `${PRICES}?productId=${parentProductId}`,
        field: 'unit_price_net',
        createPayload: () => ({
          productId: parentProductId,
          priceKindId: parentKindId,
          currencyCode: 'USD',
          unitPriceNet: 10,
        }),
        // The price update mutation guard requires the scope fields (productId/priceKindId/
        // currencyCode) on the body — a partial { id, unitPriceNet } update is rejected with 403.
        updatePayload: (id) => ({
          id,
          productId: parentProductId,
          priceKindId: parentKindId,
          currencyCode: 'USD',
          unitPriceNet: 12.5,
        }),
      })
    } finally {
      if (priceKindId) await apiRequest(request, 'DELETE', `${PRICE_KINDS}?id=${priceKindId}`, { token }).catch(() => {})
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
