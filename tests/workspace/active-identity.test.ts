import { describe, expect, it } from 'vitest'
import { leadBelongsToWorkspace, workspaceIdentityForSender } from '@/lib/workspace/active-identity'

const workspace = { id: 'identity-1', profileId: 'profile-1' }

describe('leadBelongsToWorkspace', () => {
  it('keeps a lead saved under the selected identity', () => {
    expect(leadBelongsToWorkspace({ revenueIdentityId: 'identity-1', senderProfileId: null }, workspace)).toBe(true)
  })

  it('keeps a lead sent from the profile linked to the selected identity', () => {
    expect(leadBelongsToWorkspace({ revenueIdentityId: null, senderProfileId: 'profile-1' }, workspace)).toBe(true)
  })

  it('hides a lead that belongs to another identity and profile', () => {
    expect(leadBelongsToWorkspace({ revenueIdentityId: 'identity-2', senderProfileId: 'profile-2' }, workspace)).toBe(false)
  })

  it('hides a lead with no identity and no sender when a workspace is selected', () => {
    expect(leadBelongsToWorkspace({ revenueIdentityId: null, senderProfileId: null }, workspace)).toBe(false)
  })
})

describe('workspaceIdentityForSender', () => {
  it('stamps the workspace while prospecting through its profile', () => {
    expect(workspaceIdentityForSender(workspace, 'profile-1')).toBe('identity-1')
  })

  it('stamps the workspace when the identity has no linked profile yet', () => {
    expect(workspaceIdentityForSender({ id: 'identity-1', profileId: null }, 'profile-9')).toBe('identity-1')
  })

  it('does not stamp the workspace after the sender is changed to another profile', () => {
    expect(workspaceIdentityForSender(workspace, 'profile-2')).toBeNull()
  })
})
