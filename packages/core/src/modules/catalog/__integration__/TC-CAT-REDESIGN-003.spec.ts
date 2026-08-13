import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const PRODUCTS_PATH = '/api/catalog/products'

type ProductCreateResponse = {
  id?: string | null
  basePriceApplied?: boolean
}

function readTokenClaims(token: string): { tenantId?: string; orgId?: string | null } {
  const payloadSegment = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString()) as {
    tenantId?: string
    orgId?: string | null
  }
}

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies()
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), 'restricted catalog user should log in').toBe(true)
  const body = await readJsonSafe<{ token?: string }>(response)
  const token = typeof body?.token === 'string' ? body.token : ''
  expect(token.length, 'restricted login should return a token').toBeGreaterThan(0)
  const claims = readTokenClaims(token)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const cookies = [
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' as const },
  ]
  if (claims.tenantId) {
    cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' as const })
  }
  if (claims.orgId) {
    cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' as const })
  }
  await page.context().addCookies(cookies)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

test.describe('TC-CAT-REDESIGN-003: table and grid view parity', () => {
  test('view toggle persists and the WMS stock column obeys feature visibility', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const title = `QA REDESIGN 003 Grid ${stamp}`
    const sku = `QA-REDESIGN-003-${stamp}`
    const restrictedEmail = `qa-redesign-003-${stamp}@example.com`
    const restrictedPassword = 'Catalog-Grid-3!'
    let productId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token: adminToken,
        data: {
          title,
          sku,
          productType: 'simple',
          lifecycleState: 'active',
          basePrice: { unitPriceNet: '129.00', currencyCode: 'USD' },
        },
      })
      expect(createResponse.status(), 'grid fixture product should be created').toBe(201)
      const createBody = await readJsonSafe<ProductCreateResponse>(createResponse)
      productId = expectId(createBody?.id, 'grid fixture product should return an id')
      expect(typeof createBody?.basePriceApplied).toBe('boolean')

      roleId = await createRoleFixture(request, adminToken, {
        name: `catalog-grid-without-wms-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['catalog.products.view'],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password: restrictedPassword,
        organizationId,
        roles: [roleId],
        name: 'Catalog Grid Without WMS',
      })

      await login(page, 'admin')
      const initialResponse = page.waitForResponse(
        (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await page.goto('/backend/catalog/products')
      await initialResponse
      const searchInput = page.getByPlaceholder(/Search products, SKU/i)
      const tableSearchResponse = page.waitForResponse((response) => {
        if (response.request().method() !== 'GET') return false
        const url = new URL(response.url())
        return url.pathname === PRODUCTS_PATH && url.searchParams.get('search') === sku
      })
      await searchInput.fill(sku)
      await tableSearchResponse

      const viewControl = page.getByRole('radiogroup', { name: /^View$/i })
      await expect(viewControl.getByRole('radio', { name: /^Table$/i })).toBeChecked()
      const row = page.getByRole('row').filter({ hasText: title })
      await expect(row).toContainText(sku)
      await expect(row).toContainText(/Simple/i)
      await expect(row).toContainText(/Active/i)
      if (createBody?.basePriceApplied === true) {
        await expect(row).toContainText(/129\.00/)
      }
      await expect(page.getByRole('columnheader', { name: /Stock|wms\.catalogStock\.column/i })).toBeVisible()

      await viewControl.getByRole('radio', { name: /^Grid$/i }).click()
      await expect(viewControl.getByRole('radio', { name: /^Grid$/i })).toBeChecked()
      const gridCardButton = page.getByRole('button', { name: title, exact: true })
      const gridCard = gridCardButton.locator('..')
      await expect(gridCardButton).toBeVisible()
      await expect(gridCard.getByText(sku, { exact: true })).toBeVisible()
      await expect(gridCard.getByText('Active', { exact: true })).toBeVisible()
      await expect(gridCard.getByText('Simple', { exact: true })).toBeVisible()
      await expect(gridCard.getByRole('button', { name: /Variants \(0\)/i })).toBeVisible()
      if (createBody?.basePriceApplied === true) {
        await expect(gridCard).toContainText(/129\.00/)
      }

      const reloadResponse = page.waitForResponse(
        (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await page.reload()
      await reloadResponse
      const persistedViewControl = page.getByRole('radiogroup', { name: /^View$/i })
      await expect(persistedViewControl.getByRole('radio', { name: /^Grid$/i })).toBeChecked()
      const reloadedSearchResponse = page.waitForResponse((response) => {
        if (response.request().method() !== 'GET') return false
        const url = new URL(response.url())
        return url.pathname === PRODUCTS_PATH && url.searchParams.get('search') === sku
      })
      await page.getByPlaceholder(/Search products, SKU/i).fill(sku)
      await reloadedSearchResponse
      await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()

      await persistedViewControl.getByRole('radio', { name: /^Table$/i }).click()
      await expect(page.getByRole('row').filter({ hasText: title })).toContainText(sku)

      await loginWithCredentials(page, restrictedEmail, restrictedPassword)
      const restrictedListResponse = page.waitForResponse(
        (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await page.goto('/backend/catalog/products')
      await restrictedListResponse
      const restrictedSearchResponse = page.waitForResponse((response) => {
        if (response.request().method() !== 'GET') return false
        const url = new URL(response.url())
        return url.pathname === PRODUCTS_PATH && url.searchParams.get('search') === sku
      })
      await page.getByPlaceholder(/Search products, SKU/i).fill(sku)
      await restrictedSearchResponse
      await expect(page.getByRole('row').filter({ hasText: title })).toContainText(sku)
      await expect(page.getByRole('columnheader', { name: /Stock|wms\.catalogStock\.column/i })).toHaveCount(0)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
