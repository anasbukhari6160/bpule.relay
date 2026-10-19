import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/organization'
import { safeErrorResponse } from '@/lib/errors'
import { createServiceSupabase } from '@/lib/supabase/service'
import { parseDocument } from '@/lib/profile-intelligence/parse-document'
import { parseSpreadsheet } from '@/lib/profile-intelligence/parse-spreadsheet'
import { runExtractionPipeline, synthesizeAiContext } from '@/lib/profile-intelligence/pipeline'
import { resolveIdentity } from '@/lib/profile-intelligence/identity-resolution'
import { mergeSkillLists } from '@/lib/profile-intelligence/skill-normalization'
import type { ExtractedFacts, ExtractedProject, ExtractedProof } from '@/lib/domain/types'
import { profileAccess } from '@/lib/profile-intelligence/access'

const SPREADSHEET_MIMES = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

// One source per call; long multi-person PDFs need several parallel AI calls.
export const maxDuration = 300

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: batchId } = await params
  const authCtx = await getAuthContext()
  if (!authCtx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!profileAccess(authCtx).canManage) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const client = createServiceSupabase()
  const orgId = authCtx.orgId

  const { data: batch } = await client
    .from('profile_import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('organization_id', orgId)
    .single()

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  }

  const { data: nextSource } = await client
    .from('profile_sources')
    .select('*')
    .eq('import_batch_id', batchId)
    .in('extraction_status', ['pending', 'extracting'])
    .order('uploaded_at', { ascending: true })
    .limit(1)
    .single()

  if (!nextSource) {
    const { data: batchSources } = await client
      .from('profile_sources')
      .select('id, original_filename, parsing_status, extraction_status, error_message')
      .eq('import_batch_id', batchId)

    const allDone = batchSources?.every((s) => ['extracted', 'failed', 'unsupported', 'partial_failure'].includes(s.extraction_status))

    let finalStatus = batch.status
    if (allDone) {
      const failedCount = batchSources?.filter((s) => ['failed', 'partial_failure'].includes(s.extraction_status)).length ?? 0
      const hasExtracted = batchSources?.some((s) => s.extraction_status === 'extracted')
      finalStatus = hasExtracted
        ? (failedCount > 0 ? 'partial_failure' : 'review_required')
        : 'failed'

      await client
        .from('profile_import_batches')
        .update({ status: finalStatus, updated_at: new Date().toISOString() })
        .eq('id', batchId)
    }

    // Include per-source status + error details so the frontend can show why.
    const sourceDetails = (batchSources ?? []).map((s: Record<string, unknown>) => ({
      sourceId: s.id as string,
      filename: s.original_filename as string,
      parsingStatus: s.parsing_status as string,
      extractionStatus: s.extraction_status as string,
      error: s.error_message as string | null,
    }))

    return NextResponse.json({
      batch_id: batchId,
      done: true,
      status: finalStatus,
      sources: sourceDetails,
      errors: sourceDetails.filter((s) => s.error).length > 0 ? sourceDetails.filter((s) => s.error) : undefined,
    })
  }

  try {
    // Mark as extracting so concurrent polls skip this source.
    await client
      .from('profile_sources')
      .update({ parsing_status: 'parsing', extraction_status: 'extracting', updated_at: new Date().toISOString() })
      .eq('id', nextSource.id)

    const { data: fileData } = await client.storage
      .from('profile-sources')
      .download(nextSource.storage_path)

    if (!fileData) {
      await client
        .from('profile_sources')
        .update({ parsing_status: 'failed', extraction_status: 'failed', error_message: 'File not found in storage.' })
        .eq('id', nextSource.id)
      return NextResponse.json({ batch_id: batchId, done: false, status: 'parsing', error: 'File not found.' })
    }

    const buffer = await fileData.arrayBuffer()
    const isSpreadsheet = SPREADSHEET_MIMES.has(nextSource.mime_type)

    if (isSpreadsheet) {
      await processSpreadsheetSource(client, nextSource, buffer, orgId, authCtx.repId)
    } else {
      await processDocumentSource(client, nextSource, buffer, orgId, authCtx.repId)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Processing failed'
    await client
      .from('profile_sources')
      .update({ extraction_status: 'failed', error_message: msg })
      .eq('id', nextSource.id)
  }

  // Refresh batch counters so the frontend sees progress.
  const { data: reCounted } = await client
    .from('profile_sources')
    .select('extraction_status')
    .eq('import_batch_id', batchId)

  const extractedCount = reCounted?.filter((s) => s.extraction_status === 'extracted').length ?? 0
  const failedCount = reCounted?.filter((s) => ['failed', 'partial_failure'].includes(s.extraction_status)).length ?? 0

  await client
    .from('profile_import_batches')
    .update({
      processed_files: (reCounted?.length ?? 0) - (reCounted?.filter((s) => s.extraction_status === 'pending').length ?? 0),
      failed_files: failedCount,
      detected_people: extractedCount,
      created_profiles: extractedCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  const { data: updatedBatch } = await client
    .from('profile_import_batches')
    .select('*')
    .eq('id', batchId)
    .single()

  return NextResponse.json({
    batch_id: batchId,
    done: false,
    status: updatedBatch?.status ?? 'extracting',
    batch: updatedBatch,
  })
}

async function fetchExistingProfiles(client: any, orgId: string) {
  const { data } = await client
    .from('profiles')
    .select('id, full_name, display_name, label, headline, current_role, company, profile_url')
    .eq('organization_id', orgId)
    .is('archived_at', null)
  return data ?? []
}

async function createProfile(client: any, facts: ExtractedFacts, orgId: string, repId: string): Promise<string | null> {
  const readiness = computeReadiness(facts)
  const aiContext = await synthesizeAiContext(facts, [], [], orgId).catch(() => null)

  const { data, error } = await client
    .from('profiles')
    .insert({
      organization_id: orgId,
      rep_id: repId,
      full_name: facts.fullName ?? facts.displayName,
      display_name: facts.displayName ?? facts.fullName,
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

  if (error) {
    console.error('[profile-intelligence] createProfile failed:', error.message)
    return null
  }
  return data.id
}

async function mergeIntoProfile(client: any, profileId: string, facts: ExtractedFacts, projects: ExtractedProject[], proofs: ExtractedProof[], orgId: string) {
  const { data: existing } = await client
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single()

  if (!existing) return

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

  await client.from('profiles').update(updates).eq('id', profileId)
  await saveProjects(client, profileId, projects, orgId)
  await saveProofs(client, profileId, proofs, orgId)
}

async function saveProjects(client: any, profileId: string, projects: ExtractedProject[], orgId: string) {
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

async function saveProofs(client: any, profileId: string, proofs: ExtractedProof[], orgId: string) {
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
    (Array.isArray(existing?.primary_skills) && (existing.primary_skills as any[]).length > 0)
  const hasSource = true

  if (hasIdentity && hasRole && hasCapability && hasSource) return 'ready'
  if (hasIdentity && hasSource) return 'needs_review'
  if (hasSource) return 'incomplete'
  return 'needs_source'
}

async function processDocumentSource(
  client: any,
  source: { id: string; mime_type: string; original_filename: string },
  buffer: ArrayBuffer,
  orgId: string,
  repId: string,
) {
  let parsed
  try {
    parsed = await parseDocument(buffer, source.mime_type, source.original_filename)
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : 'Parse failed'
    await client.from('profile_sources').update({ parsing_status: 'failed', error_message: msg }).eq('id', source.id)
    throw Object.assign(new Error(msg), { sourceId: source.id })
  }

  await client
    .from('profile_sources')
    .update({
      parsing_status: 'parsed',
      parsed_content: parsed.content.slice(0, 50000),
      page_count: parsed.pageCount,
      parsed_at: new Date().toISOString(),
    })
    .eq('id', source.id)

  const extraction = await runExtractionPipeline(parsed, parsed.content, orgId)

  // Apply extraction to profiles BEFORE marking as extracted — if profile
  // creation fails, the source status reflects reality and the frontend
  // doesn't show a false "success".
  await applyExtractionToProfiles(client, extraction, orgId, repId, source.id)

  await client
    .from('profile_sources')
    .update({
      extraction_status: 'extracted',
      detected_people: extraction.people as any,
      extracted_at: new Date().toISOString(),
    })
    .eq('id', source.id)
}

async function processSpreadsheetSource(
  client: any,
  source: { id: string; mime_type: string; original_filename: string },
  buffer: ArrayBuffer,
  orgId: string,
  repId: string,
) {
  let spreadsheet
  try {
    spreadsheet = await parseSpreadsheet(buffer, source.mime_type, source.original_filename)
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : 'Spreadsheet parse failed'
    await client.from('profile_sources').update({ parsing_status: 'failed', error_message: msg }).eq('id', source.id)
    throw Object.assign(new Error(msg), { sourceId: source.id })
  }

  await client
    .from('profile_sources')
    .update({
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
    .eq('id', source.id)

  const { spreadsheetToText } = await import('@/lib/profile-intelligence/parse-spreadsheet')

  let totalDetected = 0
  for (const [personName, rows] of spreadsheet.personGroups.entries()) {
    if (personName.startsWith('__unassigned')) continue

    const personText = spreadsheetToText(personName, rows)

    const extraction = await runExtractionPipeline(
      { content: personText, pages: [personText], pageCount: 1, needsOcr: false, warnings: [] },
      personText,
      orgId,
    )

    totalDetected += extraction.people.length

    await client
      .from('profile_sources')
      .update({
        extraction_status: 'extracted',
        detected_people: [...(spreadsheet.detectedPeople as any), ...extraction.people] as any,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', source.id)

    await applyExtractionToProfiles(client, extraction, orgId, repId, source.id, rows)
  }

  if (totalDetected === 0) {
    await client
      .from('profile_sources')
      .update({ extraction_status: 'partial_failure', error_message: 'No people detected in spreadsheet.' })
      .eq('id', source.id)
  }
}

async function applyExtractionToProfiles(
  client: any,
  extraction: Awaited<ReturnType<typeof runExtractionPipeline>>,
  orgId: string,
  repId: string,
  sourceId: string,
  spreadsheetRows?: any[],
) {
  const existingProfiles = await fetchExistingProfiles(client, orgId)

  for (const [personName, facts] of extraction.factsByPerson.entries()) {
    const candidate = {
      normalizedName: personName,
      email: null,
      linkedinUrl: null,
      company: facts.company ?? null,
      role: facts.currentRole ?? null,
      aliases: [],
      sourceEvidence: [facts.professionalSummary ?? facts.bio ?? ''],
    }

    const resolution = resolveIdentity(candidate, existingProfiles)

    if (resolution.resolution === 'match_existing' && resolution.matchedProfileId) {
      await mergeIntoProfile(client, resolution.matchedProfileId, facts, extraction.projectsByPerson.get(personName) ?? [], extraction.proofsByPerson.get(personName) ?? [], orgId)
      await client.from('profile_sources').update({ profile_id: resolution.matchedProfileId }).eq('id', sourceId)
      existingProfiles.push({
        id: resolution.matchedProfileId,
        fullName: facts.fullName ?? null,
        displayName: facts.displayName ?? null,
        label: facts.fullName ?? null,
        headline: facts.headline ?? null,
        currentRole: facts.currentRole ?? null,
        company: facts.company ?? null,
        profileUrl: null,
      })
    } else {
      const newProfile = await createProfile(client, facts, orgId, repId)
      if (newProfile) {
        await client.from('profile_sources').update({ profile_id: newProfile }).eq('id', sourceId)
        await saveProjects(client, newProfile, extraction.projectsByPerson.get(personName) ?? [], orgId)
        await saveProofs(client, newProfile, extraction.proofsByPerson.get(personName) ?? [], orgId)
        existingProfiles.push({
          id: newProfile,
          fullName: facts.fullName ?? null,
          displayName: facts.displayName ?? null,
          label: facts.fullName ?? null,
          headline: facts.headline ?? null,
          currentRole: facts.currentRole ?? null,
          company: facts.company ?? null,
          profileUrl: null,
        })
      } else {
        // Profile creation failed — record why so the UI can show it.
        await client
          .from('profile_sources')
          .update({ extraction_status: 'failed', error_message: `Profile creation failed for "${personName}". Check DB constraints.` })
          .eq('id', sourceId)
        throw new Error(`Profile creation failed for "${personName}"`)
      }
    }
  }

  for (const review of extraction.reviews) {
    const targetName = review.assignedPersonName
    if (!targetName) continue
    const profileId = existingProfiles.find((p: { fullName: string | null }) => p.fullName === targetName)?.id
    if (profileId) {
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
  }
}
