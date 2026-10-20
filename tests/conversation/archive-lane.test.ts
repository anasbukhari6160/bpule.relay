import { describe, expect, it } from 'vitest'
import { archiveLane } from '@/lib/conversation/archive'

describe('archiveLane', () => {
  it('files a client-last thread as needing a reply', () => {
    expect(archiveLane('replied', 'SEND_REPLY', 'client')).toBe('reply')
  })

  it('files a quiet thread whose follow-up is due', () => {
    expect(archiveLane('contacted', 'SEND_FOLLOWUP', 'me')).toBe('followup')
  })

  it('files our last message as waiting on them', () => {
    expect(archiveLane('contacted', 'WAIT_REPLY', 'me')).toBe('waiting')
  })

  it('files a closed status ahead of an open action', () => {
    expect(archiveLane('won', 'SEND_REPLY', 'client')).toBe('closed')
    expect(archiveLane('lost', 'CLOSED', 'me')).toBe('closed')
  })

  it('files a started thread that is not waiting', () => {
    expect(archiveLane('new', 'SEND_DM', 'client')).toBe('open')
  })
})
