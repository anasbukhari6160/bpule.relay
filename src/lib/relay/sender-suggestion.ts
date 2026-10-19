/**
 * Org-wide sender suggestion.
 *
 * A rep can only send from profiles they own or are assigned. But the org may
 * have a profile with much stronger, relevant proof for a given lead. This
 * scores EVERY profile in the org against the lead (skills + proof cards +
 * legacy proof + project technologies) and, when a profile the rep cannot use
 * is clearly stronger, returns it as a suggestion with who holds it — so the
 * rep can hand the lead over or ask an admin for access. Read-only: nothing is
 * assigned or changed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { profileDisplayName, profileDisplayRole } from '@/lib/profile-intelligence/legacy-display'

export interface SenderCandidate {
  id: string
  name: string | null
  role: string | null
  platform: string | null
  skills: string[]
  proof: Array<{ text: string; tags: string[]; strong: boolean; verified: boolean }>
  holders: Array<{ repId: string; name: string }>
  accessibleToRep: boolean
}

export interface SenderScore {
  profileId: string
  score: number
  matchedTerms: string[]
  topProof: string | null
}

export interface SenderSuggestion {
  profileId: string
  name: string | null
  role: string | null
  platform: string | null
  score: number
  currentBestScore: number
  matchedTerms: string[]
  topProof: string | null
  holders: string[]
  reason: string
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}.+#\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Deterministic lead ↔ profile relevance. Proof outweighs self-declared skills. */
export function scoreSender(candidate: SenderCandidate, leadTerms: string[]): SenderScore {
  const terms = [...new Set(leadTerms.map(norm).filter((t) => t.length > 1))]
  const matched = new Set<string>()
  let score = 0

  const skillSet = new Set(candidate.skills.map(norm))
  for (const t of terms) {
    if (skillSet.has(t) || [...skillSet].some((s) => s.length > 2 && (s.includes(t) || t.includes(s)))) {
      score += 2
      matched.add(t)
    }
  }

  let bestProof: { text: string; points: number } | null = null
  for (const p of candidate.proof) {
    const hay = norm(`${p.text} ${p.tags.join(' ')}`)
    const hits = terms.filter((t) => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(hay))
    if (hits.length === 0) continue
    const points = hits.length * 3 + (p.strong ? 2 : 0) + (p.verified ? 2 : 0)
    score += points
    hits.forEach((h) => matched.add(h))
    if (!bestProof || points > bestProof.points) bestProof = { text: p.text, points }
  }

  return { profileId: candidate.id, score, matchedTerms: [...matched], topProof: bestProof?.text ?? null }
}

/**
 * Suggest a stronger profile the rep does not hold. Only fires when it is
 * clearly better (≥ +5 points and ≥ 1.5× the rep's best), same platform when
 * one is required, so reps are not nagged by marginal differences.
 */
export function pickSuggestion(
  candidates: SenderCandidate[],
  leadTerms: string[],
  opts: { platform?: string | null; currentProfileId?: string | null } = {},
): SenderSuggestion | null {
  const eligible = candidates.filter((c) => !opts.platform || !c.platform || c.platform === opts.platform)
  const scored = eligible.map((c) => ({ c, s: scoreSender(c, leadTerms) }))
  const mine = scored.filter((x) => x.c.accessibleToRep)
  const current = opts.currentProfileId ? mine.find((x) => x.c.id === opts.currentProfileId) : null
  const bestMine = current?.s.score ?? Math.max(0, ...mine.map((x) => x.s.score))
  const others = scored.filter((x) => !x.c.accessibleToRep && x.s.score > 0).sort((a, b) => b.s.score - a.s.score)
  const top = others[0]
  if (!top) return null
  if (top.s.score < bestMine + 5 || top.s.score < bestMine * 1.5) return null

  const holders = top.c.holders.map((h) => h.name)
  const who = holders.length > 0 ? holders.join(', ') : 'an admin'
  const terms = top.s.matchedTerms.slice(0, 4).join(', ')
  return {
    profileId: top.c.id,
    name: top.c.name,
    role: top.c.role,
    platform: top.c.platform,
    score: top.s.score,
    currentBestScore: bestMine,
    matchedTerms: top.s.matchedTerms,
    topProof: top.s.topProof,
    holders,
    reason: `${top.c.name ?? 'Another profile'} has stronger proof for this lead${terms ? ` (${terms})` : ''}. ` +
      `Sending from it is more likely to get a reply — ask ${who} to send it, or ask an admin for access.`,
  }
}

/** Loads every active profile in the org with its proof, marking which ones the rep can use. */
export async function loadSenderCandidates(
  client: SupabaseClient,
  orgId: string,
  repId: string,
): Promise<SenderCandidate[]> {
  const { data, error } = await client
    .from('profiles')
    .select(`
      id, rep_id, platform, label, headline, full_name, display_name, current_role,
      primary_skills, secondary_skills, technologies, specialties, service_capabilities,
      owner:reps(id, name),
      assignments:profile_assignments(rep_id, reps(id, name)),
      proof_cards(safe_claim, capability, tags, strength, verified),
      proof_items(project_summary, tags, review_quote, permission_on_file),
      portfolio_projects(project_title, description, technologies)
    `)
    .eq('organization_id', orgId)
    .is('archived_at', null)
  if (error) throw error

  // Reps assigned a sending identity built from a profile can send as it too.
  const { data: identityHolders } = await client
    .from('identity_assignments')
    .select('reps(id, name), revenue_identities(profile_id, status)')
    .eq('organization_id', orgId)
  const holdersByProfile = new Map<string, Array<{ id: string; name: string }>>()
  for (const row of (identityHolders ?? []) as any[]) {
    const identity = Array.isArray(row.revenue_identities) ? row.revenue_identities[0] : row.revenue_identities
    const rep = Array.isArray(row.reps) ? row.reps[0] : row.reps
    if (!identity?.profile_id || identity.status === 'archived' || !rep?.id) continue
    holdersByProfile.set(identity.profile_id, [...(holdersByProfile.get(identity.profile_id) ?? []), rep])
  }

  return (data ?? []).map((p: any) => {
    const holders = new Map<string, string>()
    for (const a of p.assignments ?? []) if (a.reps?.id) holders.set(a.reps.id, a.reps.name)
    for (const r of holdersByProfile.get(p.id) ?? []) holders.set(r.id, r.name)
    const owner = Array.isArray(p.owner) ? p.owner[0] : p.owner
    if (owner?.id) holders.set(owner.id, owner.name)
    const skills = [
      ...(p.primary_skills ?? []), ...(p.secondary_skills ?? []), ...(p.technologies ?? []),
      ...(p.specialties ?? []), ...(p.service_capabilities ?? []),
      ...(p.portfolio_projects ?? []).flatMap((pp: any) => pp.technologies ?? []),
    ].filter((s: unknown): s is string => typeof s === 'string')
    return {
      id: p.id,
      name: profileDisplayName({ ...p, rep: owner }),
      role: profileDisplayRole(p),
      platform: p.platform ?? null,
      skills: [...new Set(skills)],
      proof: [
        ...(p.proof_cards ?? []).map((c: any) => ({ text: c.safe_claim, tags: [...(c.tags ?? []), c.capability ?? ''], strong: c.strength === 'strong', verified: !!c.verified })),
        ...(p.proof_items ?? []).map((i: any) => ({ text: i.project_summary, tags: i.tags ?? [], strong: !!i.review_quote, verified: !!i.permission_on_file })),
        ...(p.portfolio_projects ?? []).map((pp: any) => ({ text: [pp.project_title, pp.description].filter(Boolean).join(' — '), tags: pp.technologies ?? [], strong: false, verified: false })),
      ].filter((x) => x.text),
      holders: [...holders].map(([id, name]) => ({ repId: id, name })),
      accessibleToRep: p.rep_id === repId || holders.has(repId),
    }
  })
}
