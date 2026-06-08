import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe, expectId } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  extractOperation,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog.offers (#2574) — relation-graph undo for product offers.
 *
 * Offers are scoped to a product and a sales channel, so the round trip closes over both
 * parent fixtures. Covers I1/I2/I3/I5/I6 via the shared helper (offers responses are
 * camelCase, so the asserted scalar is `title`).
 */

const OFFERS = '/api/catalog/offers'
const SALES_CHANNELS = '/api/sales/channels'

test.describe('TC-UNDO-001 catalog.offers undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('offer CRUD commands restore scalar state on undo/redo', async ({ request }: { request: APIRequestContext }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let channelId: string | null = null
    try {
      productId = await createProductFixture(request, token, {
        title: `Undo Offer Parent ${stamp}`,
        sku: `uop-${stamp}`,
      })

      const channelRes = await apiRequest(request, 'POST', SALES_CHANNELS, {
        token,
        data: { name: `Undo Offer Channel ${stamp}`, code: `undo-ch-${stamp}` },
      })
      expect(channelRes.ok(), `sales channel create ${channelRes.status()}`).toBeTruthy()
      channelId =
        extractOperation(channelRes)?.resourceId ??
        expectId((await readJsonSafe<{ id?: string }>(channelRes))?.id, 'sales channel id')

      const parentProductId = productId
      const parentChannelId = channelId
      await runCrudUndoRoundTrip(request, token, {
        label: 'catalog.offers',
        collectionPath: OFFERS,
        field: 'title',
        createPayload: (s) => ({ productId: parentProductId, channelId: parentChannelId, title: `Undo Offer ${s}` }),
        updatePayload: (id, s) => ({ id, title: `Undo Offer Renamed ${s}` }),
      })
    } finally {
      if (channelId) await apiRequest(request, 'DELETE', `${SALES_CHANNELS}?id=${channelId}`, { token }).catch(() => {})
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
