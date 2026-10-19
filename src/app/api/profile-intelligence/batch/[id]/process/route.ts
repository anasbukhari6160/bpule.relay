import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { createServiceSupabase } from '@/lib/supabase/service'
import { DocumentParseError, parseDocument } from '@/lib/profile-intelligence/parse-document'
import { parseSpreadsheet, spreadsheetToText } from '@/lib/profile-intelligence/parse-spreadsheet'
import { runExtractionPipeline, synthesizeAiContext } from '@/lib/profile-intelligence/pipeline'
import { resolveIdentity } from '@/lib/profile-intelligence/identity-resolution'
import { mergeSkillLists } from '@/lib/profile-intelligence/skill-normalization'
import type { ExtractedFacts, ExtractedProject, ExtractedProof } from '@/lib/domain/types'
import { profileAccess } from '@/lib/profile-intelligence/access'
import {
  STUCK_AFTER_MS,
  TERMINAL_EXTRACTION,
  finalizeBatchStatus,
  stuckSourceUpdate,
  type SourceOutcome,
} from '@/lib/profile-intelligence/batch-status'

const SPREADSHEET_MIMES = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

// One source per call; long multi-person PDFs need several parallel AI calls.
export const maxDuration = 300
/** Work stops early enough to save results before the platform kills the call. */
const TIME_BUDGET_MS = 260_000
const SPREADSHEET_PERSON_CONCURRENCY = 3

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
type SourceRow = {
  id: string
  storage_path: string
  mime_type: string
  original_filename: string
  parsing_status: string
  extraction_status: string
  error_message: string | null
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: batchId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!profileAccess(authCtx).canManage) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const deadline = Date.now() + TIME_BUDGET_MS
  const client: Db = createServiceSupabase()
  const orgId = authCtx.orgId

  const { data: batch, error: batchError } = await client
    .from('profile_import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (batchError) return NextResponse.json({ error: 'Could not load the batch. Retrying.', done: false }, { status: 503 })
  if (!batch) return NextResponse.json({ error: 'Batch not found.', done: true, status: 'failed' }, { status: 404 })

  await recoverStuckSources(client, batchId)

  const claim = await claimNextSource(client, batchId)
  if (claim.kind === 'error') {
    return NextResponse.json({ error: 'Could not read the batch queue. Retrying.', done: false }, { status: 503 })
  }
  if (claim.kind === 'busy') {
    return NextResponse.json({ batch_id: batchId, done: false, status: 'extracting', batch: await refreshCounters(client, batchId) })
  }
  if (claim.kind === 'empty') {
    return finalizeOrWait(client, batchId)
  }

  const source = claim.source
  let outcome: SourceOutcome
  try {
    outcome = await processSource(client, source, orgId, authCtx.repId, deadline)
  } catch (err) {
    // Anything unexpected still ends the source with a reason, never silently.
    outcome = { extraction: 'failed', message: `Processing failed: ${errorText(err)}` }
  }
  await writeOutcome(client, source.id, outcome)

  return NextResponse.json({
    batch_id: batchId,
    done: false,
    status: 'extracting',
    batch: await refreshCounters(client, batchId),
    last: { sourceId: source.id, filename: source.original_filename, status: outcome.extraction, error: outcome.message ?? null },
  })
}

/* ─── queue ─────────────────────────────────────────────────────────────── */

type Claim = { kind: 'source'; source: SourceRow } | { kind: 'empty' } | { kind: 'busy' } | { kind: 'error' }

/** Atomically move one pending source to extracting; concurrent polls never share a file. */
async function claimNextSource(client: Db, batchId: string): Promise<Claim> {
  const { data: candidates, error } = await client
    .from('profile_sources')
    .select('id, storage_path, mime_type, original_filename, parsing_status, extraction_status, error_message')
    .eq('import_batch_id', batchId)
    .eq('extraction_status', 'pending')
    .order('uploaded_at', { ascending: true })
    .limit(3)
  if (error) return { kind: 'error' }
  if (!candidates || candidates.length === 0) return { kind: 'empty' }

  for (const candidate of candidates as SourceRow[]) {
    const { data: won, error: claimError } = await updateSource(
      client,
      candidate.id,
      { extraction_status: 'extracting', parsing_status: candidate.parsing_status === 'pending' ? 'parsing' : candidate.parsing_status },
      { onlyIfStatus: 'pending' },
    )
    if (claimError) return { kind: 'error' }
    if (Array.isArray(won) && won.length > 0) return { kind: 'source', source: candidate }
  }
  return { kind: 'busy' }
}

/**
 * A source left in "extracting" by a crashed or timed-out call is retried
 * once; a second timeout fails it with a reason instead of looping forever.
 */
async function recoverStuckSources(client: Db, batchId: string) {
  const { data, error } = await client
    .from('profile_sources')
    .select('id, error_message, updated_at, uploaded_at')
    .eq('import_batch_id', batchId)
    .eq('extraction_status', 'extracting')
  if (error || !Array.isArray(data)) return
  const now = Date.now()
  for (const row of data as Array<{ id: string; error_message: string | null; updated_at?: string | null; uploaded_at?: string | null }>) {
    const since = Date.parse(row.updated_at ?? row.uploaded_at ?? '')
    if (!Number.isFinite(since) || now - since < STUCK_AFTER_MS) continue
    await updateSource(client, row.id, stuckSourceUpdate(row.error_message), { onlyIfStatus: 'extracting' })
  }
}

async function finalizeOrWait(client: Db, batchId: string) {
  const { data: rows, error } = await client
    .from('profile_sources')
    .select('id, original_filename, parsing_status, extraction_status, error_message, profile_id')
    .eq('import_batch_id', batchId)
  if (error || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'Could not read batch results. Retrying.', done: false }, { status: 503 })
  }
  const sources = rows as Array<SourceRow & { profile_id: string | null }>
  const details = sources.map((s) => ({
    sourceId: s.id,
    filename: s.original_filename,
    parsingStatus: s.parsing_status,
    extractionStatus: s.extraction_status,
    error: s.error_message ?? null,
  }))

  // Done only when every source is terminal AND the batch status is saved.
  if (!sources.every((s) => TERMINAL_EXTRACTION.has(s.extraction_status))) {
    return NextResponse.json({ batch_id: batchId, done: false, status: 'extracting', sources: details, batch: await refreshCounters(client, batchId) })
  }

  const final = finalizeBatchStatus(sources)
  const counted = await countProfiles(client, batchId)
  const { data: saved, error: saveError } = await client
    .from('profile_import_batches')
    .update({
      status: final.status,
      processed_files: sources.length,
      failed_files: final.failedFiles,
      created_profiles: counted.created,
      merged_profiles: counted.merged,
      detected_people: counted.created + counted.merged,
      error_message: final.status === 'failed' ? 'No file produced a profile. See each file for the reason.' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)
    .select('*')
    .maybeSingle()
  if (saveError || !saved) {
    return NextResponse.json({ error: 'Could not save the batch result. Retrying.', done: false }, { status: 503 })
  }

  return NextResponse.json({
    batch_id: batchId,
    done: true,
    status: final.status,
    batch: saved,
    sources: details,
    errors: details.filter((d) => d.error && d.extractionStatus !== 'extracted'),
    notes: details.filter((d) => d.error && d.extractionStatus === 'extracted'),
  })
}

async function refreshCounters(client: Db, batchId: string) {
  const { data: rows } = await client.from('profile_sources').select('extraction_status').eq('import_batch_id', batchId)
  const list = (rows ?? []) as Array<{ extraction_status: string }>
  const { data } = await client
    .from('profile_import_batches')
    .update({
      status: 'extracting',
      processed_files: list.filter((s) => TERMINAL_EXTRACTION.has(s.extraction_status)).length,
      failed_files: list.filter((s) => s.extraction_status === 'failed').length,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)
    .select('*')
    .maybeSingle()
  return data ?? null
}

/**
 * Profiles created vs merged by this batch. Uses each source's saved result;
 * databases without extraction_result fall back to distinct linked profiles.
 */
async function countProfiles(client: Db, batchId: string): Promise<{ created: number; merged: number }> {
  const withResult = await client.from('profile_sources').select('extraction_result, profile_id').eq('import_batch_id', batchId)
  if (!withResult.error) {
    let created = 0
    let merged = 0
    for (const row of (withResult.data ?? []) as Array<{ extraction_result?: { created?: number; merged?: number } | null }>) {
      created += Number(row.extraction_result?.created ?? 0)
      merged += Number(row.extraction_result?.merged ?? 0)
    }
    return { created, merged }
  }
  const { data } = await client.from('profile_sources').select('profile_id').eq('import_batch_id', batchId)
  const ids = new Set(((data ?? []) as Array<{ profile_id: string | null }>).map((r) => r.profile_id).filter(Boolean))
  return { created: ids.size, merged: 0 }
}

/* ─── source processing ─────────────────────────────────────────────────── */

async function processSource(client: Db, source: SourceRow, orgId: string, repId: string, deadline: number): Promise<SourceOutcome> {
  // Rejected at upload (too large, unsupported): keep the upload's reason.
  if (source.parsing_status === 'failed' || source.parsing_status === 'unsupported' || !source.storage_path) {
    return { extraction: 'failed', parsing: source.parsing_status === 'unsupported' ? 'unsupported' : 'failed', message: source.error_message ?? 'The file was not uploaded.' }
  }

  const { data: fileData, error: downloadError } = await client.storage.from('profile-sources').download(source.storage_path)
  if (!fileData || downloadError) {
    const detail = downloadError?.message || 'file not found'
    return { extraction: 'failed', parsing: 'failed', message: `Could not download the uploaded file from storage (${detail}). Upload it again.` }
  }
  const buffer: ArrayBuffer = await fileData.arrayBuffer()

  return SPREADSHEET_MIMES.has(source.mime_type)
    ? processSpreadsheetSource(client, source, buffer, orgId, repId, deadline)
    : processDocumentSource(client, source, buffer, orgId, repId, deadline)
}

async function processDocumentSource(client: Db, source: SourceRow, buffer: ArrayBuffer, orgId: string, repId: string, deadline: number): Promise<SourceOutcome> {
  let parsed
  try {
    parsed = await parseDocument(buffer, source.mime_type, source.original_filename)
  } catch (err) {
    if (err instanceof DocumentParseError) {
      return { extraction: 'failed', parsing: err.ocrRequired ? 'ocr_required' : 'failed', message: err.userMessage }
    }
    return { extraction: 'failed', parsing: 'failed', message: `The file could not be read: ${errorText(err)}` }
  }

  await updateSource(client, source.id, {
    parsing_status: 'parsed',
    parsed_content: parsed.content.slice(0, 50000),
    page_count: parsed.pageCount,
    parsed_at: new Date().toISOString(),
  })

  let extraction
  try {
    extraction = await runExtractionPipeline(parsed, parsed.content, orgId, { deadline })
  } catch (err) {
    return { extraction: 'failed', message: `Could not extract a profile: ${errorText(err)}` }
  }
  if (extraction.people.length === 0) {
    const why = extraction.warnings.length > 0 ? ` (${extraction.warnings.join(' | ')})` : ''
    return { extraction: 'failed', message: `No person could be identified in this document. Make sure it names the person, e.g. a CV with their name at the top.${why}`, detectedPeople: [] }
  }

  const applied = await applyExtractionToProfiles(client, extraction, orgId, repId, source.id)
  const saved = applied.created + applied.merged
  if (saved === 0) {
    return { extraction: 'failed', message: `Profiles could not be saved: ${applied.failures.join(' | ') || 'unknown error'}`, detectedPeople: extraction.people, result: applied }
  }
  if (applied.failures.length > 0) {
    return { extraction: 'partial_failure', message: `Saved ${saved} of ${saved + applied.failures.length} people. ${applied.failures.join(' | ')}`, detectedPeople: extraction.people, result: applied }
  }
  // Truncation or skipped AI steps are notes, not failures.
  const notes = [...parsed.warnings, ...extraction.warnings.map((w) => `Partial extraction: ${w}`)]
  return { extraction: 'extracted', message: notes.length > 0 ? notes.join(' ') : null, detectedPeople: extraction.people, result: applied }
}

async function processSpreadsheetSource(client: Db, source: SourceRow, buffer: ArrayBuffer, orgId: string, repId: string, deadline: number): Promise<SourceOutcome> {
  let spreadsheet
  try {
    spreadsheet = await parseSpreadsheet(buffer, source.mime_type, source.original_filename)
  } catch (err) {
    return { extraction: 'failed', parsing: 'failed', message: `The spreadsheet could not be read: ${errorText(err)}` }
  }

  await updateSource(client, source.id, {
    parsing_status: 'parsed',
    parsed_content: JSON.stringify({
      headers: spreadsheet.headers,
      detected_people: spreadsheet.detectedPeople,
      row_count: spreadsheet.rows.length,
      warnings: spreadsheet.warnings,
    }).slice(0, 50000),
    page_count: spreadsheet.rows.length,
    parsed_at: new Date().toISOString(),
  })

  const groups = [...spreadsheet.personGroups.entries()].filter(([name]) => !name.startsWith('__unassigned'))
  if (groups.length === 0) {
    return { extraction: 'failed', message: 'No person names found in the spreadsheet. Add a column such as "Name" or "Full name" with one person per row.' }
  }

  const failures: string[] = []
  const allPeople: unknown[] = []
  let created = 0
  let merged = 0
  let skipped = 0
  let next = 0
  // Rows are independent: one bad row never sinks the sheet.
  const worker = async () => {
    while (next < groups.length) {
      const [groupKey, rows] = groups[next++]
      const personName = spreadsheet.personDisplayNames.get(groupKey) ?? groupKey
      if (Date.now() > deadline - 30_000) { skipped++; continue }
      try {
        const personText = spreadsheetToText(personName, rows)
        const extraction = await runExtractionPipeline(
          { content: personText, pages: [personText], pageCount: 1, needsOcr: false, warnings: [] },
          personText,
          orgId,
          { deadline, knownPersonName: personName, skipQualityGate: true },
        )
        allPeople.push(...extraction.people)
        const applied = await applyExtractionToProfiles(client, extraction, orgId, repId, source.id)
        created += applied.created
        merged += applied.merged
        failures.push(...applied.failures)
      } catch (err) {
        failures.push(`${personName}: ${errorText(err)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SPREADSHEET_PERSON_CONCURRENCY, groups.length) }, worker))

  const saved = created + merged
  const result = { created, merged, failures }
  const parts = [
    failures.length > 0 ? `Failed: ${failures.join(' | ')}` : '',
    skipped > 0 ? `${skipped} ${skipped === 1 ? 'person was' : 'people were'} not processed before the time limit; upload those rows again.` : '',
  ].filter(Boolean)
  if (saved === 0) return { extraction: 'failed', message: parts.join(' ') || 'No profile could be created from the spreadsheet.', detectedPeople: allPeople, result }
  if (parts.length > 0) return { extraction: 'partial_failure', message: `Saved ${saved} of ${groups.length} people. ${parts.join(' ')}`, detectedPeople: allPeople, result }
  return { extraction: 'extracted', message: null, detectedPeople: allPeople, result }
}

/* ─── profiles ──────────────────────────────────────────────────────────── */

async function fetchExistingProfiles(client: Db, orgId: string) {
  const { data } = await client
    .from('profiles')
    .select('id, full_name, display_name, label, headline, current_role, company, profile_url')
    .eq('organization_id', orgId)
    .is('archived_at', null)
  return data ?? []
}

async function createProfile(client: Db, facts: ExtractedFacts, orgId: string, repId: string): Promise<{ id: string | null; error: string | null }> {
  const readiness = computeReadiness(facts)
  const aiContext = await synthesizeAiContext(facts, [], [], orgId).catch(() => null)

  // Ensure we always have a name — the profiles table requires full_name.
  const name = facts.fullName ?? facts.displayName ?? 'Unknown'
  const { data, error } = await client
    .from('profiles')
    .insert({
      organization_id: orgId,
      rep_id: repId,
      // profiles began as per-rep platform identities: platform is NOT NULL
      // and limited to linkedin/upwork.
      platform: profilePlatform(facts),
      full_name: name,
      display_name: name,
      headline: facts.headline,
      current_role: facts.currentRole,
      company: facts.company,
      location: facts.location,
      bio: facts.bio,
      professional_summary: facts.professionalSummary,
      seniority: facts.seniority,
      years_experience: facts.yearsExperience,
      primary_skills: facts.primarySkills,
      secondary_skills: facts.secondarySkills,
      technologies: facts.technologies,
      industries: facts.industries,
      service_capabilities: facts.serviceCapabilities,
      specialties: facts.specialties,
      positioning: facts.positioning,
      differentiators: facts.differentiators,
      languages: facts.languages,
      communication_style: facts.communicationStyle ?? {},
      profile_confidence: 0.7,
      readiness,
      ai_context: aiContext ?? {},
      source_count: 1,
      extraction_version: 'v2',
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[profile-intelligence] createProfile failed:', error?.message ?? 'no row returned')
    return { id: null, error: error?.message ?? 'no row returned' }
  }
  return { id: data.id as string, error: null }
}

/** An imported person is a LinkedIn identity unless their documents point to Upwork. */
function profilePlatform(facts: ExtractedFacts): 'linkedin' | 'upwork' {
  const text = [facts.headline, facts.bio, facts.professionalSummary, facts.positioning].filter(Boolean).join(' ')
  return /upwork\.com|\bupwork\b/i.test(text) && !/linkedin\.com|\blinkedin\b/i.test(text) ? 'upwork' : 'linkedin'
}

async function mergeIntoProfile(client: Db, profileId: string, facts: ExtractedFacts, projects: ExtractedProject[], proofs: ExtractedProof[], orgId: string): Promise<boolean> {
  const { data: existing } = await client
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single()

  if (!existing) return false

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (facts.primarySkills?.length) updates.primary_skills = mergeSkillLists(existing.primary_skills ?? [], facts.primarySkills)
  if (facts.secondarySkills?.length) updates.secondary_skills = mergeSkillLists(existing.secondary_skills ?? [], facts.secondarySkills)
  if (facts.technologies?.length) updates.technologies = mergeSkillLists(existing.technologies ?? [], facts.technologies)
  if (facts.industries?.length) updates.industries = mergeSkillLists(existing.industries ?? [], facts.industries)
  if (facts.specialties?.length) updates.specialties = mergeSkillLists(existing.specialties ?? [], facts.specialties)
  if (facts.currentRole && !existing.current_role) updates.current_role = facts.currentRole
  if (facts.company && !existing.company) updates.company = facts.company
  if (facts.location && !existing.location) updates.location = facts.location
  if (facts.professionalSummary && !existing.professional_summary) updates.professional_summary = facts.professionalSummary
  if (facts.positioning && !existing.positioning) updates.positioning = facts.positioning
  if (facts.seniority && !existing.seniority) updates.seniority = facts.seniority
  if (facts.yearsExperience && !existing.years_experience) updates.years_experience = facts.yearsExperience

  updates.source_count = (existing.source_count ?? 0) + 1
  updates.readiness = computeReadiness(facts, existing)

  const { error } = await client.from('profiles').update(updates).eq('id', profileId)
  if (error) return false
  await saveProjects(client, profileId, projects, orgId)
  await saveProofs(client, profileId, proofs, orgId)
  return true
}

async function saveProjects(client: Db, profileId: string, projects: ExtractedProject[], orgId: string) {
  if (projects.length === 0) return

  const rows = projects.map((p) => ({
    organization_id: orgId,
    profile_id: profileId,
    project_title: p.name,
    my_role: p.role,
    description: p.summary,
    skills: p.technologies,
    technologies: p.technologies,
    source_kind: 'import',
  }))

  await client.from('portfolio_projects').upsert(rows, { onConflict: 'profile_id,project_title', ignoreDuplicates: true })
}

async function saveProofs(client: Db, profileId: string, proofs: ExtractedProof[], orgId: string) {
  if (proofs.length === 0) return

  const existingProofs = new Set<string>()
  const { data: existing } = await client
    .from('proof_cards')
    .select('safe_claim')
    .eq('profile_id', profileId)
  if (existing) {
    for (const row of existing) existingProofs.add(row.safe_claim)
  }

  const rows = proofs
    .filter((p) => !existingProofs.has(p.claim))
    .map((p) => ({
      organization_id: orgId,
      profile_id: profileId,
      capability: p.claim.slice(0, 100),
      strength: p.confidence > 0.8 ? 'strong' : p.confidence > 0.5 ? 'moderate' : 'weak',
      safe_claim: p.claim,
      source_type: p.evidenceType === 'fact' ? 'cv' : 'approved_fact',
      source_reference: p.technologyDomain,
      tags: p.technologyDomain ? [p.technologyDomain] : [],
      verified: p.safeForOutreach,
      forbidden_claims: [],
    }))

  if (rows.length > 0) {
    await client.from('proof_cards').insert(rows)
  }
}

function computeReadiness(facts: ExtractedFacts, existing?: Record<string, unknown>): string {
  const hasIdentity = !!(facts.fullName ?? facts.displayName ?? existing?.full_name)
  const hasRole = !!(facts.currentRole ?? existing?.current_role)
  const hasCapability = facts.primarySkills.length > 0 || facts.technologies.length > 0 ||
    (Array.isArray(existing?.primary_skills) && (existing.primary_skills as unknown[]).length > 0)
  const hasSource = true

  if (hasIdentity && hasRole && hasCapability && hasSource) return 'ready'
  if (hasIdentity && hasSource) return 'needs_review'
  if (hasSource) return 'incomplete'
  return 'needs_source'
}

/**
 * Create or merge one profile per extracted person. A failure for one person
 * is recorded and the rest continue; the caller decides the source status.
 */
async function applyExtractionToProfiles(
  client: Db,
  extraction: Awaited<ReturnType<typeof runExtractionPipeline>>,
  orgId: string,
  repId: string,
  sourceId: string,
): Promise<{ created: number; merged: number; failures: string[] }> {
  const existingProfiles = await fetchExistingProfiles(client, orgId)
  const touched: Array<{ id: string; fullName: string | null }> = []
  const failures: string[] = []
  let created = 0
  let merged = 0

  for (const [personName, facts] of extraction.factsByPerson.entries()) {
    if (!personName || typeof personName !== 'string' || !personName.trim()) continue
    const projects = extraction.projectsByPerson.get(personName) ?? []
    const proofs = extraction.proofsByPerson.get(personName) ?? []

    const resolution = resolveIdentity({
      normalizedName: personName,
      email: null,
      linkedinUrl: null,
      company: facts.company ?? null,
      role: facts.currentRole ?? null,
      aliases: [],
      sourceEvidence: [facts.professionalSummary ?? facts.bio ?? ''],
    }, existingProfiles)

    let profileId: string | null = null
    if (resolution.resolution === 'match_existing' && resolution.matchedProfileId) {
      if (await mergeIntoProfile(client, resolution.matchedProfileId, facts, projects, proofs, orgId)) {
        profileId = resolution.matchedProfileId
        merged++
      } else {
        failures.push(`${personName}: could not update the existing profile`)
      }
    } else {
      const finalName = facts.fullName ?? facts.displayName ?? personName
      const made = await createProfile(client, { ...facts, fullName: finalName, displayName: finalName }, orgId, repId)
      if (made.id) {
        profileId = made.id
        created++
        await saveProjects(client, made.id, projects, orgId)
        await saveProofs(client, made.id, proofs, orgId)
      } else {
        failures.push(`${personName}: profile could not be saved (${made.error})`)
      }
    }

    if (profileId) {
      await client.from('profile_sources').update({ profile_id: profileId }).eq('id', sourceId)
      const entry = {
        id: profileId,
        fullName: facts.fullName ?? personName,
        displayName: facts.displayName ?? null,
        label: facts.fullName ?? personName,
        headline: facts.headline ?? null,
        currentRole: facts.currentRole ?? null,
        company: facts.company ?? null,
        profileUrl: null,
      }
      existingProfiles.push(entry)
      touched.push({ id: profileId, fullName: entry.fullName })
    }
  }

  for (const review of extraction.reviews) {
    const targetName = review.assignedPersonName
    if (!targetName) continue
    const profileId = touched.find((p) => p.fullName === targetName)?.id
    if (!profileId) continue
    await client.from('profile_reviews').insert({
      organization_id: orgId,
      profile_id: profileId,
      source_id: sourceId,
      review_text: review.reviewText,
      reviewer_name: review.reviewerName,
      reviewer_company: review.reviewerCompany,
      relevant_skills: review.relevantSkills,
      project_context: review.projectContext,
      evidence_type: review.evidenceType ?? 'explicit_claim',
      confidence: review.confidence,
      safe_for_outreach: review.confidence > 0.7 && review.ownershipStatus === 'clear',
      ownership_status: review.ownershipStatus,
    })
  }

  return { created, merged, failures }
}

/* ─── writes ────────────────────────────────────────────────────────────── */

async function writeOutcome(client: Db, sourceId: string, outcome: SourceOutcome) {
  const fields: Record<string, unknown> = {
    extraction_status: outcome.extraction,
    error_message: outcome.message ? outcome.message.slice(0, 2000) : null,
  }
  if (outcome.parsing) fields.parsing_status = outcome.parsing
  if (outcome.extraction !== 'failed') fields.extracted_at = new Date().toISOString()
  if (outcome.detectedPeople) fields.detected_people = outcome.detectedPeople
  if (outcome.result) fields.extraction_result = outcome.result
  const { error } = await updateSource(client, sourceId, fields)
  if (error) {
    // Older databases lack extraction_result: save the status regardless.
    delete fields.extraction_result
    const retry = await updateSource(client, sourceId, fields)
    if (retry.error) console.error('[profile-intelligence] could not save source outcome:', retry.error.message)
  }
}

/**
 * Update a source, stamping updated_at. Databases without the updated_at
 * column (migration not applied) get the same update without it.
 */
async function updateSource(
  client: Db,
  sourceId: string,
  fields: Record<string, unknown>,
  opts: { onlyIfStatus?: string } = {},
): Promise<{ data: unknown; error: { message: string } | null }> {
  const run = (payload: Record<string, unknown>) => {
    let q = client.from('profile_sources').update(payload).eq('id', sourceId)
    if (opts.onlyIfStatus) q = q.eq('extraction_status', opts.onlyIfStatus)
    return q.select('id')
  }
  const first = await run({ ...fields, updated_at: new Date().toISOString() })
  if (first.error && /updated_at/.test(first.error.message ?? '')) return run(fields)
  return first
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg
}
