import { expect, test, type APIRequestContext, type Response } from '@playwright/test'
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
const PRICES_PATH = '/api/catalog/prices'

type ProductListItem = Record<string, unknown> & {
  id?: string
  sku?: string | null
  product_type?: string | null
  lifecycle_state?: string | null
  default_sales_unit?: string | null
  requires_shipping?: boolean | null
}

type ProductCreateResponse = {
  id?: string | null
  basePriceApplied?: boolean
}

async function readResponseJson<T>(response: Response): Promise<T | null> {
  const raw = await response.text()
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function createProduct(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ id: string; basePriceApplied: boolean }> {
  const response = await apiRequest(request, 'POST', PRODUCTS_PATH, { token, data })
  expect(response.status(), 'product fixture creation should return 201').toBe(201)
  const body = await readJsonSafe<ProductCreateResponse>(response)
  return {
    id: expectId(body?.id, 'product fixture creation should return an id'),
    basePriceApplied: body?.basePriceApplied === true,
  }
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
  expect(product, 'created product should appear in the scoped list').toBeTruthy()
  return product as ProductListItem
}

async function expectSkuAbsent(request: APIRequestContext, token: string, sku: string): Promise<void> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCTS_PATH}?search=${encodeURIComponent(sku)}&page=1&pageSize=20`,
    { token },
  )
  expect(response.status(), 'product search should succeed').toBe(200)
  const body = await readJsonSafe<{ items?: ProductListItem[] }>(response)
  expect((body?.items ?? []).some((item) => item.sku === sku)).toBe(false)
}

test.describe('TC-CAT-REDESIGN-002: adaptive quick-create and validation', () => {
  test('quick-create publishes a priced physical product and saves a service draft', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const physicalTitle = `QA REDESIGN 002 Physical ${stamp}`
    const physicalSku = `QA-REDESIGN-002-PHYSICAL-${stamp}`
    const serviceTitle = `QA REDESIGN 002 Service ${stamp}`
    const serviceSku = `QA-REDESIGN-002-SERVICE-${stamp}`
    const productIds: string[] = []

    try {
      await login(page, 'admin')
      await page.goto('/backend/catalog/products')
      await page.getByRole('button', { name: /^Add product$/i }).click()

      let dialog = page.getByRole('dialog', { name: /^Add product$/i })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('radio', { name: /^Physical$/i }).click()
      await expect(dialog.getByPlaceholder(/^e\.g\./)).toBeVisible()
      await expect(dialog.getByPlaceholder('Optional')).toBeVisible()
      await expect(dialog.getByLabel(/Base price/i)).toBeVisible()

      await dialog.getByPlaceholder(/^e\.g\./).fill(physicalTitle)
      await dialog.getByPlaceholder('Optional').fill(physicalSku)
      await dialog.getByLabel(/Base price/i).fill('49.50')
      await dialog.getByRole('radio', { name: /^Subscription$/i }).click()
      await expect(dialog.getByText('Plan code', { exact: true })).toBeVisible()
      await expect(dialog.getByLabel(/Monthly price/i)).toBeVisible()
      await dialog.getByRole('radio', { name: /^Physical$/i }).click()

      const physicalCreateResponse = page.waitForResponse(
        (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await dialog.getByRole('button', { name: /^Publish product$/i }).click()
      const physicalResponse = await physicalCreateResponse
      expect(physicalResponse.status(), 'physical quick-create should return 201').toBe(201)
      const physicalBody = await readResponseJson<ProductCreateResponse>(physicalResponse)
      const physicalId = expectId(physicalBody?.id, 'physical quick-create should return an id')
      productIds.push(physicalId)
      expect(physicalBody?.basePriceApplied).toBe(true)

      const physicalProduct = await readProduct(request, token, physicalId)
      expect(physicalProduct.product_type).toBe('simple')
      expect(physicalProduct.lifecycle_state).toBe('active')
      const pricesResponse = await apiRequest(
        request,
        'GET',
        `${PRICES_PATH}?productId=${encodeURIComponent(physicalId)}&page=1&pageSize=20`,
        { token },
      )
      expect(pricesResponse.status(), 'embedded base price should be readable').toBe(200)
      const pricesBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(pricesResponse)
      const productLevelPrice = (pricesBody?.items ?? []).find((price) => {
        const productId = price.product_id ?? price.productId
        const variantId = price.variant_id ?? price.variantId
        return productId === physicalId && (variantId === null || variantId === undefined)
      })
      expect(productLevelPrice, 'quick-create should atomically create a product-level price').toBeTruthy()
      expect(Number(productLevelPrice?.unit_price_net ?? productLevelPrice?.unitPriceNet)).toBeCloseTo(49.5, 2)

      await page.getByRole('button', { name: /^Add product$/i }).click()
      dialog = page.getByRole('dialog', { name: /^Add product$/i })
      await dialog.getByRole('radio', { name: /^Service$/i }).click()
      await expect(dialog.getByLabel(/Billing unit/i)).toBeVisible()
      await dialog.getByPlaceholder(/^e\.g\./).fill(serviceTitle)
      await dialog.getByPlaceholder('Optional').fill(serviceSku)
      const billingUnit = dialog.getByRole('combobox', { name: /Billing unit/i })
      await billingUnit.click()
      await page.getByRole('option', { name: /Piece|\bpc\b/i }).first().click()

      const serviceCreateResponse = page.waitForResponse(
        (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === PRODUCTS_PATH,
      )
      await dialog.getByRole('button', { name: /^Save as draft$/i }).click()
      const serviceResponse = await serviceCreateResponse
      expect(serviceResponse.status(), 'service quick-create should return 201').toBe(201)
      const serviceBody = await readResponseJson<ProductCreateResponse>(serviceResponse)
      const serviceId = expectId(serviceBody?.id, 'service quick-create should return an id')
      productIds.push(serviceId)

      const serviceProduct = await readProduct(request, token, serviceId)
      expect(serviceProduct.product_type).toBe('service')
      expect(serviceProduct.lifecycle_state).toBe('draft')
      expect(typeof serviceProduct.default_sales_unit).toBe('string')
      expect((serviceProduct.default_sales_unit ?? '').length).toBeGreaterThan(0)
      expect(serviceProduct.default_unit).toBe(serviceProduct.default_sales_unit)
      expect(serviceProduct.requires_shipping).toBe(false)
    } finally {
      for (const productId of productIds) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })

  test('new-type shipping defaults are additive and invalid payloads persist nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const productIds: string[] = []
    const invalidSkus = [
      `QA-REDESIGN-002-INVALID-PRICE-${stamp}`,
      `QA-REDESIGN-002-INVALID-LIFECYCLE-${stamp}`,
    ]

    try {
      const service = await createProduct(request, token, {
        title: `QA REDESIGN 002 API Service ${stamp}`,
        sku: `QA-REDESIGN-002-API-SERVICE-${stamp}`,
        productType: 'service',
        lifecycleState: 'draft',
        defaultUnit: 'pc',
        defaultSalesUnit: 'pc',
      })
      productIds.push(service.id)
      const serviceProduct = await readProduct(request, token, service.id)
      expect(serviceProduct.requires_shipping).toBe(false)
      expect(serviceProduct.default_sales_unit).toBe('pc')
      expect(serviceProduct.lifecycle_state).toBe('draft')

      const virtual = await createProduct(request, token, {
        title: `QA REDESIGN 002 API Virtual ${stamp}`,
        sku: `QA-REDESIGN-002-API-VIRTUAL-${stamp}`,
        productType: 'virtual',
      })
      productIds.push(virtual.id)
      const virtualProduct = await readProduct(request, token, virtual.id)
      expect(virtualProduct.requires_shipping).toBe(true)

      const invalidPriceResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token,
        data: {
          title: `QA REDESIGN 002 Invalid Price ${stamp}`,
          sku: invalidSkus[0],
          basePrice: { unitPriceNet: 'not-a-number', currencyCode: 'USD' },
        },
      })
      const invalidPriceBody = await readJsonSafe<ProductCreateResponse>(invalidPriceResponse)
      if (typeof invalidPriceBody?.id === 'string') productIds.push(invalidPriceBody.id)
      expect(invalidPriceResponse.status(), 'invalid basePrice should reject the whole create').toBe(400)
      await expectSkuAbsent(request, token, invalidSkus[0])

      const invalidLifecycleResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token,
        data: {
          title: `QA REDESIGN 002 Invalid Lifecycle ${stamp}`,
          sku: invalidSkus[1],
          lifecycleState: 'retired',
        },
      })
      const invalidLifecycleBody = await readJsonSafe<ProductCreateResponse>(invalidLifecycleResponse)
      if (typeof invalidLifecycleBody?.id === 'string') productIds.push(invalidLifecycleBody.id)
      expect(invalidLifecycleResponse.status(), 'invalid lifecycleState should be rejected').toBe(400)
      await expectSkuAbsent(request, token, invalidSkus[1])
    } finally {
      for (const productId of productIds) {
        await deleteCatalogProductIfExists(request, token, productId)
      }
    }
  })

  test('basePrice requires catalog.pricing.manage before any product write', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const email = `qa-redesign-002-${stamp}@example.com`
    const password = 'Catalog-Redesign-2!'
    const forbiddenSku = `QA-REDESIGN-002-FORBIDDEN-${stamp}`
    let roleId: string | null = null
    let userId: string | null = null
    let unpricedProductId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `catalog-product-without-pricing-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['catalog.products.view', 'catalog.products.manage'],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'Catalog Product Without Pricing',
      })
      const restrictedToken = await getAuthToken(request, email, password)

      const unpriced = await createProduct(request, restrictedToken, {
        title: `QA REDESIGN 002 Allowed Unpriced ${stamp}`,
        sku: `QA-REDESIGN-002-UNPRICED-${stamp}`,
      })
      unpricedProductId = unpriced.id

      const forbiddenResponse = await apiRequest(request, 'POST', PRODUCTS_PATH, {
        token: restrictedToken,
        data: {
          title: `QA REDESIGN 002 Forbidden Price ${stamp}`,
          sku: forbiddenSku,
          basePrice: { unitPriceNet: '19.00', currencyCode: 'USD' },
        },
      })
      expect(forbiddenResponse.status(), 'basePrice without catalog.pricing.manage should return 403').toBe(403)
      await expectSkuAbsent(request, adminToken, forbiddenSku)
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, unpricedProductId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
