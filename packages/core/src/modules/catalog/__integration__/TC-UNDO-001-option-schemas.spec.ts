import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 catalog.optionSchemas (#2574) — relation-graph undo for option-schema templates.
 *
 * Option schemas define variant option types. Covers I1/I2/I3/I5/I6 via the shared helper
 * (asserted scalar `name`). The required `schema.options` payload is carried unchanged across
 * the create/update cycle so only the scalar under test changes.
 */

const OPTION_SCHEMAS = '/api/catalog/option-schemas'
const optionsBody = [{ code: 'color', label: 'Color', inputType: 'select' as const }]

test.describe('TC-UNDO-001 catalog.optionSchemas undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('option schema CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'catalog.optionSchemas',
      collectionPath: OPTION_SCHEMAS,
      field: 'name',
      createPayload: (s) => ({ name: `Undo Option Schema ${s}`, schema: { options: optionsBody } }),
      updatePayload: (id, s) => ({ id, name: `Undo Option Schema Renamed ${s}`, schema: { options: optionsBody } }),
    })
  })
})
