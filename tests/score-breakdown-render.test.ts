import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ScoreBreakdown } from '@/components/score-breakdown'

type Props = Parameters<typeof ScoreBreakdown>[0]
const render = (props: Props) => renderToStaticMarkup(createElement(ScoreBreakdown, props))

const calculation = {
  modelSubtotal: 77.12,
  modelScore: 39,
  signalCheckTotal: 73,
  modelWeight: 0.5,
  finalScore: 56,
  steps: [
    { label: 'Opportunity model subtotal', value: '77.12/100', detail: 'Sum of the eight weighted model rows.' },
    { label: 'Episode status', value: '×0.5', detail: 'UNKNOWN episode.' },
    { label: 'Signal check blend', value: '56/100', detail: '50% model score 39 + 50% signal check 73, rounded.' },
  ],
}

describe('ScoreBreakdown (PRO-006 / PRO-007 / PRO-009)', () => {
  it('explains the total, cites quotes, and fills high-value bars', () => {
    const html = render({
        canonicalScore: 56,
        calculation,
        decisionAdjustments: ['Need owner HIRING_NEED → ORGANIZATION_NEED: the source asks for an external provider.'],
        dimensions: [
          { key: 'buyerRequest', label: 'Buyer Request', contribution: 19.6, weight: 0.2, note: 'Explicit request', group: 'model', evidence: [{ text: 'We are looking for an external software development agency', kind: 'quote' }] },
          { key: 'fit', label: 'Capability Fit', contribution: 20, weight: 0.2, note: '', group: 'model', evidence: [{ text: 'Model fit assessment', kind: 'inference' }] },
          { key: 'signal_buyerIntent', label: 'Buyer Intent', contribution: 25, weight: 0.25, note: '', group: 'signals', evidence: [{ text: 'Seeking vendor/partner', kind: 'signal' }] },
        ],
    })
    expect(html).toContain('Why 56/100?')
    expect(html).toContain('77.12/100')
    expect(html).toContain('Decision guards applied')
    expect(html).toContain('“We are looking for an external software development agency”')
    expect(html).toContain('Inferred')
    expect(html).toContain('Detected: Seeking vendor/partner')
    expect(html).toContain('blended at 50% into the total')
    expect(html).not.toContain('No source quote for this row')
    // 19.6/20 → 98% fill using a defined theme color, 20/20 → 100%.
    expect(html).toMatch(/bg-status-success" style="width:98%/)
    expect(html).toMatch(/bg-status-success" style="width:100%/)
  })

  it('says once that legacy results have no stored quotes or trace', () => {
    const html = render({ canonicalScore: 56, dimensions: [{ key: 'timing', label: 'Timing', contribution: 6.8, weight: 0.1, note: '' }] })
    expect(html.match(/Source quotes were not stored/g)).toHaveLength(1)
    expect(html).toContain('saved before the calculation trace was recorded')
  })
})
