import { describe, expect, it } from 'vitest'
import { analyzeInboundInput } from '@/lib/inbound/analysis'

const INPUT = {
  message: [
    'This is Zoë Müller, VP Engineering at Aurora Commerce.',
    'We need an external engineering partner to rebuild our checkout platform.',
    'Our approved budget is $120,000 and we need to start within 6 weeks.',
  ].join('\n'),
  source: 'email' as const,
  context: 'The procurement committee asked Zoë to select the delivery partner.',
}

describe('inbound authoritative score parity', () => {
  it.each([
    ['V2', false],
    ['V3', true],
  ] as const)('%s uses one deterministic architecture for preview and save recomputation', async (_label, useV3) => {
    const preview = await analyzeInboundInput(INPUT, { useV3 })
    const save = await analyzeInboundInput(INPUT, { useV3 })

    expect(save.canonicalScore).toBe(preview.canonicalScore)
    expect(save.qualification).toBe(preview.qualification)
    expect(save.buyerIntent).toEqual(preview.buyerIntent)
    expect(save.scoreVersion).toBe(preview.scoreVersion)
    expect(save.scoreBreakdown).toEqual(preview.scoreBreakdown)
    expect(save.canonicalIntelligence.canonicalScore).toBe(save.canonicalScore)
    expect(save.canonicalIntelligence.qualification).toBe(save.qualification)
  })
})
