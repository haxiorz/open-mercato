import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrganizationFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const PRODUCTS_PATH = '/api/catalog/products'
const STATS_PATH = '/api/catalog/products/stats'

type CatalogStats = {
  totals: {
    all: number
    active: number
    draft: number
    archived: number
  }
  productsInActiveOffers: number
}

type ScopedRequestOptions = {
  token: string
  tenantId: string
  organizationId: string
  data?: Record<string, unknown>
}

async function scopedApiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: ScopedRequestOptions,
): Promise<APIResponse> {
  return request.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: [
        `om_selected_tenant=${encodeURIComponent(options.tenantId)}`,
        `om_selected_org=${encodeURIComponent(options.organizationId)}`,
      ].join('; '),
    },
    data: options.data,
  })
}

async function readStats(request: APIRequestContext, token: string): Promise<CatalogStats> {
  const response = await apiRequest(request, 'GET', STATS_PATH, { token })
  expect(response.status(), 'catalog stats should return 200').toBe(200)
  const body = await readJsonSafe<CatalogStats>(response)
  expect(body, 'catalog stats should return JSON').not.toBeNull()
  return body as CatalogStats
}

async function readScopedStats(
  request: APIRequestContext,
  options: ScopedRequestOptions,
): Promise<CatalogStats> {
  const response = await scopedApiRequest(request, 'GET', STATS_PATH, options)
  expect(response.status(), 'scoped catalog stats should return 200').toBe(200)
  const body = await readJsonSafe<CatalogStats>(response)
  expect(body, 'scoped catalog stats should return JSON').not.toBeNull()
  return body as CatalogStats
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status(), 'foreign tenant fixture should be created').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'foreign tenant fixture should return an id')
}

async function createProduct(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRODUCTS_PATH, { token, data })
  expect(response.status(), 'catalog product fixture should be created').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'catalog product fixture should return an id')
}

test.describe('TC-CAT-REDESIGN-004: product stats endpoint', () => {
  test('counts lifecycle states, isolates tenants, and dispatches the static stats route', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = Date.now()
    const currentProductIds: string[] = []
    const baseline = await readStats(request, adminToken)
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null
    let foreignProductId: string | null = null

    try {
      currentProductIds.push(
        await createProduct(request, adminToken, {
          title: `QA REDESIGN 004 Active ${stamp}`,
          sku: `QA-REDESIGN-004-ACTIVE-${stamp}`,
          lifecycleState: 'active',
          isActive: true,
        }),
        await createProduct(request, adminToken, {
          title: `QA REDESIGN 004 Draft ${stamp}`,
          sku: `QA-REDESIGN-004-DRAFT-${stamp}`,
          lifecycleState: 'draft',
          isActive: true,
        }),
        await createProduct(request, adminToken, {
          title: `QA REDESIGN 004 Archived ${stamp}`,
          sku: `QA-REDESIGN-004-ARCHIVED-${stamp}`,
          lifecycleState: 'archived',
          isActive: true,
        }),
        await createProduct(request, adminToken, {
          title: `QA REDESIGN 004 Discontinued ${stamp}`,
          sku: `QA-REDESIGN-004-DISCONTINUED-${stamp}`,
          lifecycleState: 'active',
          isActive: false,
        }),
      )

      foreignTenantId = await createTenant(
        request,
        superadminToken,
        `QA REDESIGN 004 Foreign Tenant ${stamp}`,
      )
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA REDESIGN 004 Foreign Organization ${stamp}`,
        tenantId: foreignTenantId,
      })
      const foreignCreateResponse = await scopedApiRequest(request, 'POST', PRODUCTS_PATH, {
        token: superadminToken,
        tenantId: foreignTenantId,
        organizationId: foreignOrganizationId,
        data: {
          title: `QA REDESIGN 004 Foreign Active ${stamp}`,
          sku: `QA-REDESIGN-004-FOREIGN-${stamp}`,
          lifecycleState: 'active',
          isActive: true,
        },
      })
      expect(foreignCreateResponse.status(), 'foreign product fixture should be created').toBe(201)
      const foreignCreateBody = await readJsonSafe<{ id?: string }>(foreignCreateResponse)
      foreignProductId = expectId(foreignCreateBody?.id, 'foreign product fixture should return an id')

      const response = await apiRequest(request, 'GET', STATS_PATH, { token: adminToken })
      expect(response.status(), '/api/catalog/products/stats should reach the stats GET route').toBe(200)
      const responseBody = await readJsonSafe<CatalogStats & { items?: unknown }>(response)
      expect(responseBody).toEqual(
        expect.objectContaining({
          totals: expect.objectContaining({
            all: baseline.totals.all + 4,
            active: baseline.totals.active + 1,
            draft: baseline.totals.draft + 1,
            archived: baseline.totals.archived + 1,
          }),
          productsInActiveOffers: baseline.productsInActiveOffers,
        }),
      )
      expect(responseBody).not.toHaveProperty('items')

      const foreignStats = await readScopedStats(request, {
        token: superadminToken,
        tenantId: foreignTenantId,
        organizationId: foreignOrganizationId,
      })
      expect(foreignStats.totals).toEqual({ all: 1, active: 1, draft: 0, archived: 0 })
      expect(foreignStats.productsInActiveOffers).toBe(0)
    } finally {
      for (const productId of currentProductIds) {
        await deleteCatalogProductIfExists(request, adminToken, productId)
      }
      if (foreignTenantId && foreignOrganizationId && foreignProductId) {
        await scopedApiRequest(
          request,
          'DELETE',
          `${PRODUCTS_PATH}?id=${encodeURIComponent(foreignProductId)}`,
          {
            token: superadminToken,
            tenantId: foreignTenantId,
            organizationId: foreignOrganizationId,
          },
        ).catch(() => undefined)
      }
      if (foreignTenantId && foreignOrganizationId) {
        await scopedApiRequest(request, 'DELETE', '/api/directory/organizations', {
          token: superadminToken,
          tenantId: foreignTenantId,
          organizationId: foreignOrganizationId,
          data: { id: foreignOrganizationId },
        }).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/tenants',
        foreignTenantId,
      )
    }
  })
})
