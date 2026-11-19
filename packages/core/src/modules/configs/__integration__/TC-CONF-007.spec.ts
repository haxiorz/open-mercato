import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  QUEUE_STATUS_TEST_QUEUE,
  cleanupTestJobs,
  openTestQueue,
  uniqueMarker,
} from './helpers/queueStatusFixtures'
import polish from '../i18n/pl.json' with { type: 'json' }
import type { QueueStatusEntryDto, QueueStatusSnapshot } from '../lib/queue-status.types'

type Snapshot = {
  generatedAt: string
  canInspectPayloads: boolean
  queues: Array<{
    queue: string
    strategy: 'local' | 'async'
    counts: Record<string, number>
    error?: string
    failedJobs?: Array<Record<string, unknown>>
    inFlight?: Array<Record<string, unknown>>
    agedWaiting?: Array<{ id: string; type?: string; state: string }>
  }>
}

/**
 * TC-CONF-007: Queue status snapshot (Tier 1) — GET /api/configs/queues-status
 * Source: issue #3105
 *
 * Covers the dispatcher feature gate, payload-freeness of the broadly granted response, the
 * payload-free job-type filter and the unknown-queue / invalid-query contracts. The job is created
 * through the real enqueue path of whichever strategy the harness runs (local or BullMQ).
 */
test.describe('TC-CONF-007: Queue status snapshot (Tier 1)', () => {
  test('requires configs.queues_status.view and never exposes a job payload', async ({ request }) => {
    const queue = openTestQueue()
    const secret = uniqueMarker('payload-secret')
    const jobType = uniqueMarker('qs-type')
    const tenantId = '00000000-0000-4000-8000-0000000000a1'
    try {
      await queue.enqueue({ tenantId, jobType, note: secret })

      const anonymous = await request.fetch('/api/configs/queues-status', { method: 'GET' })
      expect([401, 403], 'anonymous callers must be rejected').toContain(anonymous.status())

      const employeeToken = await getAuthToken(request, 'employee')
      const denied = await apiRequest(request, 'GET', '/api/configs/queues-status', { token: employeeToken })
      expect(denied.status(), 'a role without configs.queues_status.view is denied').toBe(403)

      const adminToken = await getAuthToken(request, 'admin')
      const response = await apiRequest(request, 'GET', `/api/configs/queues-status?queue=${QUEUE_STATUS_TEST_QUEUE}`, {
        token: adminToken,
      })
      expect(response.status()).toBe(200)
      const body = (await readJsonSafe<Snapshot>(response)) as Snapshot
      expect(body.canInspectPayloads, 'admin does not hold the Tier 2 feature').toBe(false)

      const entry = body.queues.find((candidate) => candidate.queue === QUEUE_STATUS_TEST_QUEUE)
      expect(entry, 'the registered queue is listed').toBeDefined()
      expect(entry?.error).toBeUndefined()
      expect(entry!.counts.waiting + (entry!.counts.delayed ?? 0)).toBeGreaterThanOrEqual(1)

      const serialized = JSON.stringify(body)
      expect(serialized, 'the payload must never be part of the Tier 1 response').not.toContain(secret)
      expect(serialized).not.toContain('"payload"')
      expect(serialized).not.toContain('"failedReason"')
    } finally {
      await cleanupTestJobs(queue, [tenantId])
    }
  })

  test('filters the bounded summaries by the payload-free job type', async ({ request }) => {
    const queue = openTestQueue()
    const matchingType = uniqueMarker('qs-match')
    const otherType = uniqueMarker('qs-other')
    const tenantId = '00000000-0000-4000-8000-0000000000a2'
    try {
      const matchingId = await queue.enqueue({ tenantId, jobType: matchingType })
      await queue.enqueue({ tenantId, jobType: otherType })

      const adminToken = await getAuthToken(request, 'admin')
      const response = await apiRequest(
        request,
        'GET',
        `/api/configs/queues-status?queue=${QUEUE_STATUS_TEST_QUEUE}&type=${encodeURIComponent(matchingType)}`,
        { token: adminToken },
      )
      expect(response.status()).toBe(200)
      const body = (await readJsonSafe<Snapshot>(response)) as Snapshot
      const entry = body.queues.find((candidate) => candidate.queue === QUEUE_STATUS_TEST_QUEUE)

      const queued = entry?.agedWaiting ?? []
      expect(queued.map((job) => job.id)).toContain(matchingId)
      expect(queued.every((job) => job.type === matchingType), 'only the requested type is listed').toBe(true)
      // A pending job is listed once, even on a strategy that cannot tell waiting from delayed.
      expect(new Set(queued.map((job) => job.id)).size).toBe(queued.length)
    } finally {
      await cleanupTestJobs(queue, [tenantId])
    }
  })

  test('answers an unknown queue with an empty snapshot and rejects malformed queries with 400', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const unknown = await apiRequest(request, 'GET', '/api/configs/queues-status?queue=does-not-exist-qs', { token: adminToken })
    expect(unknown.status()).toBe(200)
    expect(((await readJsonSafe<Snapshot>(unknown)) as Snapshot).queues).toEqual([])

    const tooLong = await apiRequest(request, 'GET', `/api/configs/queues-status?type=${'x'.repeat(500)}`, { token: adminToken })
    expect(tooLong.status(), 'validation errors are a 400, never a 500').toBe(400)
  })

  test('keeps Polish count labels and long failure reasons within the queue card', async ({ page }) => {
    const queue = 'queue-layout-check'
    const reason = `queue.${'long_failure_code_'.repeat(25)}`
    const entry: QueueStatusEntryDto = {
      queue,
      workerIds: ['test:worker'],
      concurrency: 1,
      strategy: 'async',
      fidelity: 'exact',
      counts: { waiting: 1, active: 2, completed: 3, failed: 1, delayed: 5 },
      failedJobs: [{ id: 'failed-job', queue, errorCode: reason }],
      failedJobsUnavailable: false,
      inFlightUnavailable: false,
    }
    const snapshot: QueueStatusSnapshot = {
      generatedAt: new Date().toISOString(),
      filter: { queue: null, type: null },
      canInspectPayloads: false,
      queues: [entry, { ...entry, queue: 'second-queue-layout-check', failedJobs: [] }],
    }

    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: 'pl', url: new URL(page.url()).origin }])
    await page.route('**/api/configs/queues-status', (route) => route.fulfill({ json: snapshot }))
    await page.goto('/backend/config/queues-status')

    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: queue, exact: true }) })
    const failures = card.getByRole('region', { name: polish['configs.queuesStatus.failed.title'] })
    for (const width of [1440, 640, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const count of ['waiting', 'active', 'completed', 'failed', 'delayed'] as const) {
        const badge = card.getByText(polish[`configs.queuesStatus.counts.${count}`], { exact: true })
        await expect(badge).toBeVisible()
        await expect.poll(() => badge.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const bounds = element.getBoundingClientRect()
          const tile = element.parentElement!.getBoundingClientRect()
          return bounds.right <= tile.right + 1 && Array.from(range.getClientRects()).every(
            (rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
          )
        }), `${count} label fits at ${width}px`).toBe(true)
      }
      await expect(failures.getByRole('cell', { name: reason, exact: true })).toBeVisible()
      await expect.poll(() => failures.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const cardBounds = element.closest('article')!.getBoundingClientRect()
        return getComputedStyle(element).overflowX === 'auto' && bounds.left >= cardBounds.left && bounds.right <= cardBounds.right
      }), `the failures scroll region fits in its card at ${width}px`).toBe(true)
    }
  })
})
