/**
 * Scoring v4 admin surfaces against mocked APIs. Needs a scratch-only
 * `src/app/(app)/preview/[name]/page.tsx` that renders TrainingDataCenter /
 * ScoringQaCenter without auth (see docs/RELAY_E2E_AUDIT_2026-10-22.md §18),
 * so it runs only with E2E_PREVIEW=1 against a demo-mode server.
 */
import { test, expect } from '@playwright/test'

test.skip(process.env.E2E_PREVIEW !== '1', 'needs the scratch-only /preview route and a demo-mode server')

const KEY = 'a'.repeat(64)
const row = {
  opportunityKey: KEY, primary: { kind: 'lead', id: '11111111-1111-4111-8111-111111111111' }, representations: [{ kind: 'lead', id: '11111111-1111-4111-8111-111111111111' }, { kind: 'prospect', id: '22222222-2222-4222-8222-222222222222' }],
  platform: 'linkedin', createdAt: '2026-10-20T10:00:00Z', repId: 'rep-1', company: 'Fieldnote (fixture)', contactName: null,
  rawSource: 'Fixture Founder\nFounder & CEO at Fieldnote\nWe are looking for an agency to rebuild our React dashboard. Budget approved.', sourceLength: 120, language: 'en', sourceCompleteness: 83,
  production: { score: 52, display: 5, qualification: 'MAYBE', buyerIntent: 'UNKNOWN', relationshipRole: 'BUILDER', commercialPotential: 'MEDIUM', fit: 'MEDIUM', authority: 'FOUNDER', timing: 'NONE', access: 'CONNECTION', confidence: 'MEDIUM', action: 'OBSERVE', reasons: ['Active product'], watchOut: ['No clear buyer request signal'], contradictions: 0, fallbackUsed: false, stale: false, versions: { scoringVersion: 'relay_decision_v3.3.0' }, decisionRunId: 'run-1', currentSenderId: null, bestSenderId: null, bestSenderMatch: null },
  evidence: { quotes: [{ quote: 'We are looking for an agency', verbatim: true }], rejected: [] },
  features: { fit: { level: 'GOOD', needs: ['web_frontend'], stack: [] }, accountValue: { companyMaturity: 'EARLY', buildIntensity: 'MEDIUM', technicalComplexity: 'LOW' } },
  candidates: [
    { engine: 'calibrated_v4', version: 'calibrated_v4.1', score: 68, qualification: 'WORTH_PURSUING', action: 'CONNECT_WITH_NOTE', confidence: 0.7, accountValue: 55, intentValue: 90, guards: [], reasons: [] },
    { engine: 'ordinal_logit', version: 'ordinal_logit_v1', score: 71, qualification: 'WORTH_PURSUING', action: 'CONNECT_WITH_NOTE', confidence: 0.6, accountValue: 50, intentValue: 90, guards: [], reasons: [] },
  ],
  messages: { drafts: 1, sent: 1, inbound: 0, edited: 1, firstSentPreview: 'Hi — saw your post about the dashboard rebuild.' },
  outcome: { connectionAccepted: true, replied: false, meeting: false, won: false, lost: false, status: 'contacted' },
  feedback: [{ type: 'SCORE_TOO_LOW', note: 'clear ask', createdAt: '2026-10-20T11:00:00Z' }],
  labels: [],
  priority: { score: 85, reasons: ['unlabelled', 'engines disagree', 'human feedback', 'wrong score feedback'] },
}
const trainingResponse = {
  since: '2026-07-22T00:00:00Z',
  summary: { rawRecords: 2, uniqueOpportunities: 1, labelled: 0, unlabelled: 1, withOutcome: 0, withFeedback: 1, priorityReasons: { unlabelled: 1, 'engines disagree': 1, 'human feedback': 1 } },
  rows: [row],
  ranges: [{ id: 'wp_high', min: 65, max: 74, label: '65–74 · Worth pursuing (strong)' }, { id: 'maybe_high', min: 45, max: 54, label: '45–54 · Maybe (plausible)' }],
  enums: { relationshipRole: ['BUYER', 'BUILDER'], buyerIntent: ['HIGH', 'UNKNOWN'], commercialPotential: ['MEDIUM', 'HIGH'], fit: ['GOOD', 'STRONG'], authority: ['HIGH'], timing: ['CURRENT'], access: ['CONNECTION'], expectedAction: ['CONTACT_NOW', 'CONNECT_WITH_NOTE'], labelerConfidence: ['HIGH', 'MEDIUM'] },
  engines: { all: ['v3', 'calibrated_v4', 'ordinal_logit', 'gbdt_pairwise', 'knn_features'], production: 'v3', shadow: ['calibrated_v4', 'ordinal_logit'] },
}

test.describe('scoring v4 admin surfaces (mocked API, demo mode)', () => {
  test('training-data page shows the queue, production vs candidates, and records a label', async ({ page }) => {
    const posted: unknown[] = []
    await page.route('**/api/admin/training-data?**', (r) => r.fulfill({ json: trainingResponse }))
    await page.route('**/api/admin/training-data/labels', async (r) => {
      posted.push(JSON.parse(r.request().postData() ?? '{}'))
      await r.fulfill({ status: 201, json: { ok: true, id: 'label-1', createdAt: new Date().toISOString(), labelVersion: 'label_v1' } })
    })
    await page.goto('/preview/training-data')
    await expect(page.getByText('Training data')).toBeVisible()
    await expect(page.getByText('1 unique opportunities from 2 records')).toBeVisible()
    const rowEl = page.getByTestId('training-row').first()
    await expect(rowEl).toContainText('Fieldnote (fixture)')
    await expect(rowEl).toContainText('priority 85')
    await rowEl.getByRole('button').first().click()
    await expect(page.getByText('production (v3)')).toBeVisible()
    await expect(page.getByText('calibrated_v4').first()).toBeVisible()
    await expect(page.getByText('We are looking for an agency to rebuild')).toBeVisible()
    await page.getByTestId('label-range').selectOption('wp_high')
    await page.getByTestId('label-submit').click()
    await expect(page.getByText('Label saved.')).toBeVisible()
    expect(posted).toHaveLength(1)
    const body = posted[0] as Record<string, unknown>
    expect(body.opportunityKey).toBe(KEY)
    expect(body.expectedRangeId).toBe('wp_high')
    expect((body.observed as Record<string, unknown>).score).toBe(52)
    await page.screenshot({ path: 'test-results/scoring-v4-training-data.png', fullPage: true })
  })

  test('scoring QA center shows production vs candidate engines per decision', async ({ page }) => {
    const qa = {
      since: '2026-10-06T00:00:00Z', total: 1, feedback: [],
      monitor: { window: { since: '2026-10-06T00:00:00Z', count: 1 }, scoreHistogram: { '50': 1 }, displayHistogram: { '5': 1 }, qualificationHistogram: { MAYBE: 1 }, actionHistogram: { OBSERVE: 1 }, intentHistogram: { UNKNOWN: 1 }, roleHistogram: { BUILDER: 1 }, rates: { unknownIntent: 1, contradiction: 0, fallback: 0, routingMismatch: 0, lowConfidence: 0, staleVersions: 0, deterministicEvents: 0 }, feedback: {}, alerts: [], scoringVersion: 'relay_decision_v3.3.0' },
      rows: [{ id: '11111111-1111-4111-8111-111111111111', kind: 'lead', company: 'Fieldnote (fixture)', contactName: null, repId: null, createdAt: '2026-10-20T10:00:00Z', canonicalScore: 52, displayScore: 5, qualification: 'MAYBE', storedQualification: 'maybe', buyerIntent: 'UNKNOWN', relationshipRole: 'BUILDER', commercialPotential: 'MEDIUM', fit: 'MEDIUM', timing: 'NONE', access: 'CONNECTION', confidence: 'MEDIUM', action: 'OBSERVE', currentSenderId: null, bestSenderId: null, bestSenderMatch: null, contradictions: 0, fallbackUsed: false, eventSource: 'deterministic', versions: { scoringVersion: 'relay_decision_v3.3.0' }, stale: false, rejectedSignals: [], decisionRunId: 'run-1', opportunityKey: KEY,
        candidates: [{ engine: 'calibrated_v4', version: 'calibrated_v4.1', score: 68, display: 7, qualification: 'WORTH_PURSUING', action: 'CONNECT_WITH_NOTE', confidence: 0.7, accountValue: 55, intentValue: 90, fit: 'GOOD' }] }],
    }
    await page.route('**/api/admin/scoring-qa?**', (r) => r.fulfill({ json: qa }))
    await page.goto('/preview/scoring-qa')
    await expect(page.getByText('Scoring QA')).toBeVisible()
    const rowEl = page.getByTestId('qa-row').first()
    await expect(rowEl).toContainText('candidates calibrated v4 7/10')
    await rowEl.getByRole('button').first().click()
    await expect(page.getByTestId('qa-candidates')).toBeVisible()
    await expect(page.getByTestId('qa-candidates')).toContainText('WORTH_PURSUING')
    await page.screenshot({ path: 'test-results/scoring-v4-qa.png', fullPage: true })
  })
})
