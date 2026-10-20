/**
 * GET /api/dataset/export
 *
 * Export samples in the requested format + privacy mode.
 *
 * Query params:
 *   mode — FULL_AUDIT | TRAINING | MESSAGE_PREFERENCE | SCORING_EVAL | UPWORK_TRAINING
 *   format — jsonl | csv | json
 *   privacy — REDACTED | ANONYMIZED
 *   platform — linkedin | upwork (optional filter)
 */

import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { querySamples } from '@/lib/dataset/service'
import { exportSamples } from '@/lib/dataset/export'
import type { ExportFormat, ExportMode, PrivacyMode } from '@/lib/dataset/types'

const VALID_MODES: ExportMode[] = ['FULL_AUDIT', 'TRAINING', 'MESSAGE_PREFERENCE', 'SCORING_EVAL', 'UPWORK_TRAINING']
const VALID_FORMATS: ExportFormat[] = ['jsonl', 'csv', 'json']
const VALID_PRIVACY: PrivacyMode[] = ['REDACTED', 'ANONYMIZED']

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  // Export is admin/owner only
  if (!auth.isAdmin && !auth.isOwner && !auth.isManager) {
    return NextResponse.json({ error: 'Exports require admin or owner access.' }, { status: 403 })
  }

  const url = new URL(request.url)
  const sp = url.searchParams

  const mode = (sp.get('mode') ?? 'FULL_AUDIT') as ExportMode
  const format = (sp.get('format') ?? 'jsonl') as ExportFormat
  const privacy = (sp.get('privacy') ?? 'REDACTED') as PrivacyMode

  if (!VALID_MODES.includes(mode)) return NextResponse.json({ error: `mode must be one of ${VALID_MODES.join(', ')}` }, { status: 400 })
  if (!VALID_FORMATS.includes(format)) return NextResponse.json({ error: `format must be one of ${VALID_FORMATS.join(', ')}` }, { status: 400 })
  if (!VALID_PRIVACY.includes(privacy)) return NextResponse.json({ error: `privacy must be one of ${VALID_PRIVACY.join(', ')}` }, { status: 400 })

  // RAW export requires explicit admin confirmation
  if (privacy === 'ANONYMIZED' && mode === 'FULL_AUDIT' && sp.get('confirm') !== 'true') {
    return NextResponse.json({ error: 'Add confirm=true to export anonymized full data.' }, { status: 400 })
  }

  const client = createServiceSupabase()
  const samples = await querySamples(client, auth.orgId, {
    platform: sp.get('platform') as 'linkedin' | 'upwork' | undefined,
    limit: 500,
  })

  const result = exportSamples(samples, mode, format, privacy)

  return new Response(result.content, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Dataset-Schema-Version': result.schemaVersion,
      'X-Export-Mode': mode,
      'X-Privacy-Mode': privacy,
      'X-Sample-Count': String(samples.length),
    },
  })
}
