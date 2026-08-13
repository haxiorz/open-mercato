import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

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

type ProductListItem = Record<string, unknown> & {
  id?: string
  lifecycle_state?: string
  is_active?: boolean
}

async function readStats(request: APIRequestContext, token: string): Promise<CatalogStats> {
  const response = await apiRequest(request, 'GET', STATS_PATH, { token })
  expect(response.status(), 'catalog product stats should load').toBe(200)
  const body = await readJsonSafe<CatalogStats>(response)
  expect(body, 'catalog product stats should return JSON').not.toBeNull()
  return body as CatalogStats
}

async function createProduct(
  request: APIRequestContext,
  token: string,
  input: {
    title: string
    sku: string
    lifecycleState: 'active' | 'draft' | 'archived'
    isActive: boolean
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRODUCTS_PATH, {
    token,
    data: {
      ...input,
      description: 'Self-contained lifecycle fixture for the catalog redesign integration test.',
    },
  })
  expect(response.status(), `creating ${input.lifecycleState} product should succeed`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'product creation should return an id')
}

async function readProduct(request: APIRequestContext, token: string, productId: string): Promise<ProductListItem> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCTS_PATH}?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.status(), 'created product should be readable').toBe(200)
  const body = await readJsonSafe<{ items?: ProductListItem[] }>(response)
  const product = (body?.items ?? []).find((item) => item.id === productId)
  expect(product, 'created product should appear in its scoped list response').toBeTruthy()
  return product as ProductListItem
}

function waitForProductList(
  page: Page,
  expected: { lifecycleState?: string; isActive?: string; search?: string },
) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false
    const url = new URL(response.url())
    if (url.pathname !== PRODUCTS_PATH) return false
    if (expected.lifecycleState !== undefined && url.searchParams.get('lifecycleState') !== expected.lifecycleState) {
      return false
    }
    if (expected.isActive !== undefined && url.searchParams.get('isActive') !== expected.isActive) {
      return false
    }
    if (expected.search !== undefined && url.searchParams.get('search') !== expected.search) return false
    return true
  })
}

test.describe('TC-CAT-REDESIGN-001: lifecycle tabs and row actions', () => {
  test('tabs compose lifecycle filters and Archive/Restore transitions round-trip', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const searchPrefix = `QA REDESIGN 001 ${stamp}`
    const activeName = `${searchPrefix} Active`
    const draftName = `${searchPrefix} Draft`
    const archivedName = `${searchPrefix} Archived`
    const discontinuedName = `${searchPrefix} Discontinued`
    const productIds: string[] = []
    const baseline = await readStats(request, token)

    try {
      productIds.push(
        await createProduct(request, token, {
          title: activeName,
          sku: `QA-REDESIGN-001-ACTIVE-${stamp}`,
          lifecycleState: 'active',
          isActive: true,
        }),
        await createProduct(request, token, {
          title: draftName,
          sku: `QA-REDESIGN-001-DRAFT-${stamp}`,
          lifecycleState: 'draft',
          isActive: true,
        }),
        await createProduct(request, token, {
          title: archivedName,
          sku: `QA-REDESIGN-001-ARCHIVED-${stamp}`,
          lifecycleState: 'archived',
          isActive: true,
        }),
        await createProduct(request, token, {
          title: discontinuedName,
          sku: `QA-REDESIGN-001-DISCONTINUED-${stamp}`,
          lifecycleState: 'active',
          isActive: false,
        }),
      )

      const stats = await readStats(request, token)
      expect(stats.totals.all).toBe(baseline.totals.all + 4)
      expect(stats.totals.active).toBe(baseline.totals.active + 1)
      expect(stats.totals.draft).toBe(baseline.totals.draft + 1)
      expect(stats.totals.archived).toBe(baseline.totals.archived + 1)

      const compoundResponse = await apiRequest(
        request,
        'GET',
        `${PRODUCTS_PATH}?lifecycleState=active&isActive=true&search=${encodeURIComponent(searchPrefix)}&page=1&pageSize=20`,
        { token },
      )
      expect(compoundResponse.status(), 'compound Active-tab query should succeed').toBe(200)
      const compoundBody = await readJsonSafe<{ items?: ProductListItem[] }>(compoundResponse)
      expect((compoundBody?.items ?? []).map((item) => item.id)).toEqual([productIds[0]])

      await login(page, 'admin')
      const initialListResponse = waitForProductList(page, {})
      await page.goto('/backend/catalog/products')
      await initialListResponse

      const allTab = page.getByRole('tab', { name: /^All\s*\d*$/i })
      const activeTab = page.getByRole('tab', { name: /^Active\s*\d*$/i })
      const draftTab = page.getByRole('tab', { name: /^Draft\s*\d*$/i })
      const archivedTab = page.getByRole('tab', { name: /^Archived\s*\d*$/i })
      await expect(allTab).toHaveText(new RegExp(`^All\\s*${stats.totals.all}$`))
      await expect(activeTab).toHaveText(new RegExp(`^Active\\s*${stats.totals.active}$`))
      await expect(draftTab).toHaveText(new RegExp(`^Draft\\s*${stats.totals.draft}$`))
      await expect(archivedTab).toHaveText(new RegExp(`^Archived\\s*${stats.totals.archived}$`))

      const searchInput = page.getByPlaceholder(/Search products, SKU/i)
      const searchedAllResponse = waitForProductList(page, { search: searchPrefix })
      await searchInput.fill(searchPrefix)
      await searchedAllResponse
      await expect(page.getByText(activeName, { exact: true })).toBeVisible()
      await expect(page.getByText(draftName, { exact: true })).toBeVisible()
      await expect(page.getByText(archivedName, { exact: true })).toBeVisible()
      await expect(page.getByText(discontinuedName, { exact: true })).toBeVisible()

      const activeListResponse = waitForProductList(page, {
        lifecycleState: 'active',
        isActive: 'true',
        search: searchPrefix,
      })
      await activeTab.click()
      await activeListResponse
      await expect(page.getByText(activeName, { exact: true })).toBeVisible()
      await expect(page.getByText(discontinuedName, { exact: true })).toHaveCount(0)
      await expect(page.getByText(draftName, { exact: true })).toHaveCount(0)
      await expect(page.getByText(archivedName, { exact: true })).toHaveCount(0)

      const draftListResponse = waitForProductList(page, {
        lifecycleState: 'draft',
        search: searchPrefix,
      })
      await draftTab.click()
      await draftListResponse
      await expect(page.getByText(draftName, { exact: true })).toBeVisible()
      await expect(page.getByText(activeName, { exact: true })).toHaveCount(0)

      const archivedListResponse = waitForProductList(page, {
        lifecycleState: 'archived',
        search: searchPrefix,
      })
      await archivedTab.click()
      await archivedListResponse
      await expect(page.getByText(archivedName, { exact: true })).toBeVisible()
      await expect(page.getByText(activeName, { exact: true })).toHaveCount(0)

      const activeReturnResponse = waitForProductList(page, {
        lifecycleState: 'active',
        isActive: 'true',
        search: searchPrefix,
      })
      await activeTab.click()
      await activeReturnResponse
      const activeRow = page.getByRole('row').filter({ hasText: activeName })
      await activeRow.getByRole('button', { name: /Open actions/i }).click()
      await page.getByRole('menuitem', { name: /^Archive$/i }).click()
      const archiveResponse = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await page.getByRole('alertdialog').getByRole('button', { name: /^Confirm$/i }).click()
      expect((await archiveResponse).status(), 'Archive action should update the product').toBe(200)
      await expect(page.getByText(activeName, { exact: true })).toHaveCount(0)

      const archivedAfterActionResponse = waitForProductList(page, {
        lifecycleState: 'archived',
        search: searchPrefix,
      })
      await archivedTab.click()
      await archivedAfterActionResponse
      const archivedRow = page.getByRole('row').filter({ hasText: activeName })
      await archivedRow.getByRole('button', { name: /Open actions/i }).click()
      const restoreResponse = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await page.getByRole('menuitem', { name: /^Restore$/i }).click()
      expect((await restoreResponse).status(), 'Restore action should update the product').toBe(200)

      const restored = await readProduct(request, token, productIds[0])
      expect(restored.lifecycle_state).toBe('active')
      expect(restored.is_active).toBe(true)
    } finally {
      for (const productId of productIds) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })
})
