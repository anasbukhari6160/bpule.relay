/**
 * Which profile a draft is written from. The signature on a draft comes
 * from this profile and nothing else.
 *
 * Priority:
 *   1. the profile the rep picked for this draft (explicit);
 *   2. the sender stored on the lead;
 *   3. the profile linked to the lead's workspace identity;
 *   4. the first profile the rep can use.
 *
 * The workspace identity (3) is a fallback for leads with no sender, never
 * an override: a lead saved under workspace A but sent as profile B keeps
 * signing as B. The best-sender recommendation is not an input here; it
 * changes the sender only when the rep chooses it, which then arrives as
 * (1) or (2).
 */
export interface SenderProfileLike {
  id: string
  revenueIdentityId?: string | null
}

export function selectSenderProfile<P extends SenderProfileLike>(
  profiles: readonly P[],
  lead: { senderProfileId?: string | null; revenueIdentityId?: string | null },
  explicitProfileId?: string | null,
): { profile: P | null; source: 'explicit' | 'lead_sender' | 'workspace_identity' | 'first_available' | 'none'; crossWorkspace: boolean } {
  const explicit = explicitProfileId ? profiles.find((p) => p.id === explicitProfileId) ?? null : null
  if (explicit) {
    const crossWorkspace = Boolean(lead.revenueIdentityId && explicit.revenueIdentityId && explicit.revenueIdentityId !== lead.revenueIdentityId)
    return { profile: explicit, source: 'explicit', crossWorkspace }
  }
  const stored = lead.senderProfileId ? profiles.find((p) => p.id === lead.senderProfileId) ?? null : null
  if (stored) return { profile: stored, source: 'lead_sender', crossWorkspace: false }
  const identity = lead.revenueIdentityId ? profiles.find((p) => p.revenueIdentityId === lead.revenueIdentityId) ?? null : null
  if (identity) return { profile: identity, source: 'workspace_identity', crossWorkspace: false }
  const first = profiles[0] ?? null
  return { profile: first, source: first ? 'first_available' : 'none', crossWorkspace: false }
}
