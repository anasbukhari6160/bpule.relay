/** BUG-01 — Connection request logged without a note advances the workflow. */
import { describe, expect, it } from 'vitest'
import { deriveNextLeadAction } from '@/lib/relay/lead-state-machine'
import { computeRelationshipState } from '@/lib/relay/relationship-state'
import { buildThread } from '@/lib/conversation/thread'
import { leadDetail, msg, newLead, store } from './helpers'

describe('BUG-01 connection without note', () => {
  it('reported: empty-note connection → waiting for acceptance (pure state)', () => {
    const lead = leadDetail([msg({ type: 'connection', sentText: '', sentAt: new Date().toISOString() })], { status: 'contacted' })
    expect(deriveNextLeadAction(lead).action).toBe('WAIT_CONNECTION')
    const rs = computeRelationshipState(lead)
    expect(rs.phase).toBe('connection_sent')
    expect(rs.waitingSince).not.toBeNull()
    expect(buildThread(lead)[0].text).toMatch(/no note/)
  })

  it('end to end on the store: logged once, idempotent on double submit, persists on reload', async () => {
    const s = store()
    const id = await newLead(s)
    expect(deriveNextLeadAction((await s.getLead(id))!).action).toBe('SEND_CONNECTION')
    const first = await s.markContacted(id, '', 'connection', { idempotencyKey: `${id}:connection:no-note` })
    const retry = await s.markContacted(id, '', 'connection', { idempotencyKey: `${id}:connection:no-note` })
    expect(first.allowed).toBe(true)
    expect(retry.idempotent).toBe(true)
    const reloaded = (await s.getLead(id))!
    expect(reloaded.messages.filter((m) => m.type === 'connection')).toHaveLength(1)
    expect(deriveNextLeadAction(reloaded).action).toBe('WAIT_CONNECTION')
    // An already-pending connection cannot be logged twice even with a new key.
    const again = await s.markContacted(id, '', 'connection', { idempotencyKey: 'other-key' })
    expect(again.idempotent).toBe(true)
    expect((await s.getLead(id))!.messages.filter((m) => m.type === 'connection')).toHaveLength(1)
  })

  it('control: with a note behaves the same; accepted → send DM', async () => {
    const s = store()
    const id = await newLead(s)
    await s.markContacted(id, 'Hi Pat, good to connect.', 'connection')
    expect(deriveNextLeadAction((await s.getLead(id))!).action).toBe('WAIT_CONNECTION')
    await s.markConnectionAccepted(id)
    expect(deriveNextLeadAction((await s.getLead(id))!).action).toBe('SEND_DM')
  })
})
