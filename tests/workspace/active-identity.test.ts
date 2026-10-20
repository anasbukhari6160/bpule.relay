import { describe, expect, it } from 'vitest'
import { assignLead, chooseSender, leadBelongsToWorkspace, workspaceIdentityForSender, type LeadVisibility } from '@/lib/workspace/active-identity'

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

  it('keeps the creating workspace when the sender is a different profile', () => {
    expect(workspaceIdentityForSender(workspace, 'profile-2')).toBe('identity-1')
  })
})

describe('owner, workspace, sender, and best sender stay separate', () => {
  const repA = 'rep-a'
  const repB = 'rep-b'
  const workspaceA = { id: 'identity-a', profileId: 'profile-a' }
  const created: LeadVisibility = {
    ownerRepId: repA,
    workspaceIdentityId: 'identity-a',
    senderProfileId: 'profile-a',
    bestSenderProfileId: 'profile-b',
  }

  it('keeps the lead on Rep A after the best sender is Rep B', () => {
    const switched = chooseSender(created, created.bestSenderProfileId!)
    expect(switched.ownerRepId).toBe(repA)
    expect(switched.workspaceIdentityId).toBe('identity-a')
    expect(switched.senderProfileId).toBe('profile-b')
    expect(leadBelongsToWorkspace(
      { revenueIdentityId: switched.workspaceIdentityId, senderProfileId: switched.senderProfileId },
      workspaceA,
    )).toBe(true)
    expect(leadBelongsToWorkspace(
      { revenueIdentityId: switched.workspaceIdentityId, senderProfileId: switched.senderProfileId },
      { id: 'identity-b', profileId: 'profile-b' },
    )).toBe(false)
  })

  it('changes the owner only when the lead is explicitly assigned', () => {
    const referred = assignLead(chooseSender(created, 'profile-b'), repB, 'profile-b')
    expect(referred.ownerRepId).toBe(repB)
    expect(referred.workspaceIdentityId).toBe('identity-a')
    expect(referred.senderProfileId).toBe('profile-b')
  })
})
