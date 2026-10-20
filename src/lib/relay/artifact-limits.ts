/**
 * Single source of truth for per-artifact length limits.
 *
 * Both the server-side quality gate (`message-forge.evaluateMessage`) and the
 * workspace UI (`lead-workspace.tsx`) read from this map, so a draft can never
 * pass server checks at a limit the UI doesn't show (or fail one the UI
 * doesn't know about).
 */

export type ArtifactKind = 'words' | 'chars'

export interface ArtifactLimit {
  kind: ArtifactKind
  max: number
  label: string
}

export type ArtifactLimitKey = 'dm' | 'connection' | 'upwork' | 'followup' | 'reply'

export const ARTIFACT_LIMITS: Record<ArtifactLimitKey, ArtifactLimit> = {
  dm: { kind: 'words', max: 55, label: 'words' },
  connection: { kind: 'chars', max: 120, label: 'characters' },
  upwork: { kind: 'words', max: 350, label: 'words' },
  followup: { kind: 'words', max: 40, label: 'words' },
  reply: { kind: 'words', max: 200, label: 'words' },
}

export function countFor(kind: ArtifactKind, text: string): number {
  if (kind === 'chars') return text.length
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Hard cap: cuts a draft down to the artifact's limit. Model and fallback
 * drafts get truncated here so the text the user sees can never exceed the
 * limit the UI counts against — enforcement does not rely on the model
 * following a prompt instruction.
 */
export function enforceArtifactLimit(
  text: string,
  type: ArtifactLimitKey,
): { text: string; truncated: boolean } {
  const limit = ARTIFACT_LIMITS[type]
  if (limit.kind === 'chars') {
    if (text.length > limit.max) {
      return { text: text.slice(0, limit.max).trim(), truncated: true }
    }
    return { text, truncated: false }
  }
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length > limit.max) {
    return { text: words.slice(0, limit.max).join(' ').trim(), truncated: true }
  }
  return { text, truncated: false }
}