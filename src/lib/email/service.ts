import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContactPoint,
  EmailMessageMeta,
  PreparedEmailDraft,
  RevenueIdentity,
} from '@/lib/domain/types'
import type { ScoutStore } from '@/lib/store/types'
import { mapContactPoint, mapEmailMessage, mapPreparedEmailDraft } from '@/lib/email/mappers'
import {
  normalizeEmail,
  isValidEmail,
  isBusinessEmail,
  isSendEligibleContact,
  toVerificationStatus,
} from '@/lib/email/contact-points'
import { buildRevenueStrategy, shouldWriteMessage, sourceFromLead } from '@/lib/relay/revenue-strategy'
import { buildResearchBrief } from '@/lib/email/research-brief'
import { buildEmailStrategy } from '@/lib/email/strategy'
import { generateEmailCopy } from '@/lib/email/writer'
import { validateEmailClaims } from '@/lib/email/claim-safety'
import { getEmailProvider } from '@/lib/email/providers/email-provider'
import { classifySendDisposition, inferFeedbackReasons } from '@/lib/relay/edit-learning'

type Row = Record<string, unknown>

async function listAssignedIdentityIds(
  client: SupabaseClient,
  orgId: string,
  repId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('identity_assignments')
    .select('revenue_identity_id')
    .eq('organization_id', orgId)
    .eq('rep_id', repId)
  if (error) throw error
  return (data ?? []).map((r) => r.revenue_identity_id as string)
}

function mapRevenueIdentity(r: Row): RevenueIdentity {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    slug: r.slug as string,
    identityName: r.identity_name as string,
    title: (r.title as string) ?? null,
    positioning: (r.positioning as string) ?? null,
    profileUrl: (r.profile_url as string) ?? null,
    skills: Array.isArray(r.skills) ? (r.skills as string[]) : [],
    expertise: Array.isArray(r.expertise) ? (r.expertise as string[]) : [],
    industries: Array.isArray(r.industries) ? (r.industries as string[]) : [],
    technologies: Array.isArray(r.technologies) ? (r.technologies as string[]) : [],
    allowedFirstPersonClaims: Array.isArray(r.allowed_first_person_claims) ? (r.allowed_first_person_claims as string[]) : [],
    forbiddenClaims: Array.isArray(r.forbidden_claims) ? (r.forbidden_claims as string[]) : [],
    channelRules: (r.channel_rules as Record<string, unknown>) ?? {},
    voiceTone: (r.voice_tone as Record<string, unknown>) ?? {},
    preferredOpportunityTypes: Array.isArray(r.preferred_opportunity_types) ? (r.preferred_opportunity_types as string[]) : [],
    proposalPositioning: (r.proposal_positioning as string) ?? null,
    profileId: (r.profile_id as string) ?? null,
    channel: r.channel as RevenueIdentity['channel'],
    status: r.status as RevenueIdentity['status'],
    sourceKind: (r.source_kind as string) ?? 'manual',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

export async function listLeadContactPoints(
  client: SupabaseClient,
  orgId: string,
  leadId: string,
): Promise<ContactPoint[]> {
  const { data, error } = await client
    .from('contact_points')
    .select('*')
    .eq('organization_id', orgId)
    .eq('lead_id', leadId)
    .order('is_primary', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => mapContactPoint(row as Row))
}

export async function addLeadContactPoint(input: {
  client: SupabaseClient
  orgId: string
  leadId: string
  type: ContactPoint['type']
  value: string
  source: ContactPoint['source']
  sourceUrl?: string | null
  sourceType?: string | null
  verificationStatus?: ContactPoint['verificationStatus']
  verificationMethod?: string | null
  confidence?: number | null
  isPrimary?: boolean
  isBusinessContact?: boolean
}): Promise<ContactPoint> {
  const normalizedValue = input.type === 'email' ? normalizeEmail(input.value) : input.value.trim()
  if (input.type === 'email' && !isValidEmail(normalizedValue)) {
    throw new Error('Invalid email address.')
  }

  const verificationStatus = toVerificationStatus({
    source: input.source,
    providerStatus: input.verificationStatus ?? 'UNKNOWN',
  })

  if (input.isPrimary) {
    await input.client
      .from('contact_points')
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq('organization_id', input.orgId)
      .eq('lead_id', input.leadId)
      .eq('type', input.type)
  }

  const { data, error } = await input.client
    .from('contact_points')
    .upsert({
      organization_id: input.orgId,
      lead_id: input.leadId,
      type: input.type,
      value: normalizedValue,
      source: input.source,
      source_url: input.sourceUrl ?? null,
      source_type: input.sourceType ?? null,
      verification_status: verificationStatus,
      verification_method: input.verificationMethod ?? null,
      confidence: input.confidence ?? null,
      is_primary: Boolean(input.isPrimary),
      is_business_contact: input.isBusinessContact ?? (input.type === 'email' ? isBusinessEmail(normalizedValue) : true),
      discovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,lead_id,type,value_key' })
    .select('*')
    .single()
  if (error) throw error
  return mapContactPoint(data as Row)
}

async function resolveRevenueIdentity(input: {
  client: SupabaseClient
  orgId: string
  repId: string
  preferredIdentityId: string | null
}): Promise<RevenueIdentity> {
  const assignedIds = await listAssignedIdentityIds(input.client, input.orgId, input.repId)
  if (assignedIds.length === 0) {
    throw new Error('No authorized Revenue Identity is assigned to this user.')
  }

  if (input.preferredIdentityId && !assignedIds.includes(input.preferredIdentityId)) {
    throw new Error('UNAUTHORIZED_REVENUE_IDENTITY')
  }

  const targetId = input.preferredIdentityId && assignedIds.includes(input.preferredIdentityId)
    ? input.preferredIdentityId
    : assignedIds[0]

  const { data, error } = await input.client
    .from('revenue_identities')
    .select('*')
    .eq('organization_id', input.orgId)
    .eq('id', targetId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Authorized Revenue Identity not found.')
  return mapRevenueIdentity(data as Row)
}

function fallbackContact(contacts: ContactPoint[]): ContactPoint | null {
  const primaryVerified = contacts.find((c) => c.type === 'email' && c.isPrimary && c.verificationStatus !== 'INVALID' && c.verificationStatus !== 'BOUNCED')
  if (primaryVerified) return primaryVerified
  return contacts.find((c) => c.type === 'email' && c.verificationStatus !== 'INVALID' && c.verificationStatus !== 'BOUNCED') ?? null
}

export async function prepareEmailDraft(input: {
  client: SupabaseClient
  store: ScoutStore
  orgId: string
  repId: string
  leadId: string
  preferredIdentityId?: string | null
  contactPointId?: string | null
  followup?: boolean
  generationMode?: 'standard' | 'premium'
}): Promise<PreparedEmailDraft> {
  const lead = await input.store.getLead(input.leadId)
  if (!lead) throw new Error('Lead not found.')
  if (lead.status === 'no' || lead.status === 'dead') {
    throw new Error('Lead is locked and cannot be contacted.')
  }

  const contacts = await listLeadContactPoints(input.client, input.orgId, input.leadId)
  const selectedContact = input.contactPointId
    ? contacts.find((c) => c.id === input.contactPointId) ?? null
    : fallbackContact(contacts)

  const senderIdentity = await resolveRevenueIdentity({
    client: input.client,
    orgId: input.orgId,
    repId: input.repId,
    preferredIdentityId: input.preferredIdentityId ?? lead.revenueIdentityId ?? null,
  })

  const channel = input.followup ? 'followup' : 'email'
  const relationshipStage = input.followup ? 'followup' : 'first_touch'
  const alreadyShared = lead.messages.filter((m) => m.sentText).map((m) => m.sentText as string)
  const revenue = buildRevenueStrategy(sourceFromLead(lead, null, {
    channel,
    relationshipStage,
    alreadyShared,
    priorFollowupCount: input.followup ? 1 : 0,
  }))

  const brief = buildResearchBrief({ lead, contactPoint: selectedContact, revenue })

  const { data: artifactsData } = await input.client
    .from('outreach_artifacts')
    .select('*')
    .eq('organization_id', input.orgId)
    .eq('revenue_identity_id', senderIdentity.id)
    .eq('active', true)

  const artifacts = ((artifactsData ?? []) as Row[]).map((r) => ({
    id: r.id as string,
    organizationId: r.organization_id as string,
    revenueIdentityId: r.revenue_identity_id as string,
    profileId: (r.profile_id as string) ?? null,
    artifactType: r.artifact_type as import('@/lib/domain/types').OutreachArtifactType,
    name: r.name as string,
    description: (r.description as string) ?? null,
    sourceUrl: (r.source_url as string) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    active: Boolean(r.active),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))

  const strategy = buildEmailStrategy({
    brief,
    revenue,
    senderIdentity,
    artifacts,
    followup: Boolean(input.followup),
  })

  let draftStatus: PreparedEmailDraft['draftStatus'] = 'DRAFT'
  let blockedReason: string | null = null
  let subject: string | null = null
  let body: string | null = null
  let subjectCandidates: string[] = []
  let claimSafety: PreparedEmailDraft['claimSafety'] = null

  // legitimate reason to reach out at all? This does NOT depend on whether
  // we have a verified recipient. Preparing is research/writing; only
  // sending needs a real, verified address.
  if (brief.rightToContact === 'NONE' || !shouldWriteMessage(revenue)) {
    draftStatus = 'RESEARCH_REQUIRED'
    blockedReason = revenue.contact.noMessageReason ?? 'No credible reason to send an email yet.'
  } else {
    const copy = await generateEmailCopy({
      lead,
      sender: senderIdentity,
      strategy,
      generationMode: input.generationMode === 'premium' ? 'premium' : 'standard',
    })
    subject = copy.subject
    body = copy.body
    subjectCandidates = copy.subjectCandidates

    claimSafety = validateEmailClaims({
      body,
      allowedEvidence: strategy.allowedEvidence,
      thingsNotToClaim: strategy.thingsNotToClaim,
    })

    if (!claimSafety.safe && claimSafety.repairedBody) {
      const repairedBody = claimSafety.repairedBody
      body = repairedBody
      claimSafety = validateEmailClaims({
        body: repairedBody,
        allowedEvidence: strategy.allowedEvidence,
        thingsNotToClaim: strategy.thingsNotToClaim,
      })
    }

    if (!claimSafety.safe) {
      draftStatus = 'FAILED'
      blockedReason = 'Claim safety failed. Edit evidence/claims before sending.'
    } else if (!isSendEligibleContact(selectedContact)) {
      // exists. A missing, unverified, or merely inferred contact still
      // yields a fully generated, reviewable draft — it just cannot be sent
      // until a verified/likely-valid recipient is on file. Never let an
      // inferred address become sendable just because a draft exists.
      draftStatus = 'NEEDS_VERIFIED_CONTACT'
      blockedReason = selectedContact
        ? `Recipient not verified (${selectedContact.source === 'INFERRED_PATTERN' ? 'inferred pattern guess' : selectedContact.verificationStatus.toLowerCase()}). Verify or discover a confirmed contact before sending.`
        : 'No business email is available yet. Add or discover a contact point to send this.'
    } else {
      draftStatus = 'READY'
    }
  }

  const { data, error } = await input.client
    .from('prepared_email_drafts')
    .insert({
      organization_id: input.orgId,
      lead_id: lead.id,
      revenue_identity_id: senderIdentity.id,
      contact_point_id: selectedContact?.id ?? null,
      contact_email: selectedContact?.value ?? null,
      draft_status: draftStatus,
      relationship_type: strategy.relationshipType,
      opportunity_type: strategy.opportunityType,
      email_goal: strategy.emailGoal,
      subject,
      subject_candidates: subjectCandidates,
      body,
      strategy,
      research_brief: brief,
      claim_safety: claimSafety,
      evidence_used: strategy.allowedEvidence,
      blocked_reason: blockedReason,
      is_followup: Boolean(input.followup),
      followup_sequence: input.followup ? 1 : 0,
      created_by: input.repId,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error

  return mapPreparedEmailDraft(data as Row)
}

async function loadDraftOrThrow(client: SupabaseClient, orgId: string, draftId: string): Promise<PreparedEmailDraft> {
  const { data, error } = await client
    .from('prepared_email_drafts')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', draftId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Prepared draft not found.')
  return mapPreparedEmailDraft(data as Row)
}

export async function sendPreparedEmail(input: {
  client: SupabaseClient
  store: ScoutStore
  orgId: string
  repId: string
  leadId: string
  draftId: string
  idempotencyKey: string
  subject?: string | null
  body?: string | null
}): Promise<{ emailMessage: EmailMessageMeta; todaySends: number; idempotent: boolean }> {
  const idem = input.idempotencyKey.trim()
  if (!idem) throw new Error('Idempotency key is required.')

  const lead = await input.store.getLead(input.leadId)
  if (!lead) throw new Error('Lead not found.')
  if (lead.status === 'no' || lead.status === 'dead') {
    throw new Error('Lead is locked and cannot be contacted.')
  }

  const { data: existingSend } = await input.client
    .from('email_messages')
    .select('*')
    .eq('organization_id', input.orgId)
    .eq('idempotency_key', idem)
    .maybeSingle()

  if (existingSend) {
    return { emailMessage: mapEmailMessage(existingSend as Row), todaySends: 0, idempotent: true }
  }

  const draft = await loadDraftOrThrow(input.client, input.orgId, input.draftId)
  if (draft.leadId !== input.leadId) throw new Error('Draft does not belong to this lead.')

  const assignedIdentityIds = await listAssignedIdentityIds(input.client, input.orgId, input.repId)
  if (!assignedIdentityIds.includes(draft.revenueIdentityId)) {
    throw new Error('UNAUTHORIZED_REVENUE_IDENTITY')
  }

  const body = (input.body ?? draft.body ?? '').trim()
  const subject = (input.subject ?? draft.subject ?? '').trim()
  if (!body || !subject) {
    throw new Error('Email subject and body are required.')
  }

  const claim = draft.claimSafety ?? validateEmailClaims({
    body,
    allowedEvidence: draft.strategy?.allowedEvidence ?? [],
    thingsNotToClaim: draft.strategy?.thingsNotToClaim ?? [],
  })
  if (!claim.safe) {
    throw new Error('Claim safety check failed. This draft cannot be sent yet.')
  }

  const contact = draft.contactPointId
    ? (await listLeadContactPoints(input.client, input.orgId, input.leadId)).find((c) => c.id === draft.contactPointId) ?? null
    : null

  if (contact && (contact.verificationStatus === 'INVALID' || contact.verificationStatus === 'BOUNCED')) {
    throw new Error('Recipient email is invalid or bounced and cannot be contacted.')
  }

  // prepareEmailDraft used to decide READY vs NEEDS_VERIFIED_CONTACT — this
  // unverified contact must NEVER be sendable merely because a draft with
  // subject/body exists for it (see BUG_LEDGER — Daria Redkina / Solsonic
  // hardening fixture).
  if (!isSendEligibleContact(contact)) {
    throw new Error(
      contact
        ? `Recipient is not verified (${contact.source === 'INFERRED_PATTERN' ? 'inferred pattern guess' : contact.verificationStatus.toLowerCase()}). Verify the contact before sending.`
        : 'No verified recipient on file. Verify or discover a confirmed contact before sending.',
    )
  }

  const email = draft.contactEmail ?? contact?.value ?? null
  if (!email || !isValidEmail(email)) {
    throw new Error('Valid recipient email is required.')
  }

  const recommendedArtifactId = draft.strategy?.attachmentRecommendation?.artifactId ?? null
  if (recommendedArtifactId) {
    const { data: artifactRow, error: artifactError } = await input.client
      .from('outreach_artifacts')
      .select('id')
      .eq('organization_id', input.orgId)
      .eq('revenue_identity_id', draft.revenueIdentityId)
      .eq('id', recommendedArtifactId)
      .eq('active', true)
      .maybeSingle()
    if (artifactError) throw artifactError
    if (!artifactRow) {
      throw new Error('Attachment artifact is not available for this Revenue Identity.')
    }
  }

  const { data: suppressed } = await input.client
    .from('email_suppressions')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('email_key', normalizeEmail(email))
    .eq('active', true)
    .limit(1)
  if ((suppressed ?? []).length > 0) {
    throw new Error('This contact is suppressed and cannot be emailed.')
  }

  const { data: mailboxRow, error: mailboxError } = await input.client
    .from('email_mailboxes')
    .select('*')
    .eq('organization_id', input.orgId)
    .eq('revenue_identity_id', draft.revenueIdentityId)
    .eq('status', 'CONNECTED')
    .maybeSingle()
  if (mailboxError) throw mailboxError
  if (!mailboxRow) {
    throw new Error('Email unavailable for this identity. Connect a mailbox first.')
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: policyRow } = await input.client
    .from('email_sending_policies')
    .select('*')
    .eq('organization_id', input.orgId)
    .or(`revenue_identity_id.eq.${draft.revenueIdentityId},revenue_identity_id.is.null`)
    .order('revenue_identity_id', { ascending: true })
    .limit(1)
  const dailyCap = ((policyRow?.[0] as Row | undefined)?.daily_send_cap as number | undefined) ?? 30

  const count = (await input.client
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.orgId)
    .eq('revenue_identity_id', draft.revenueIdentityId)
    .gte('sent_at', `${today}T00:00:00.000Z`)
    .lt('sent_at', `${today}T23:59:59.999Z`)).count ?? 0

  if (count >= dailyCap) {
    throw new Error('Daily send cap reached for this Revenue Identity.')
  }

  const provider = getEmailProvider((mailboxRow as Row).provider as string)

  await input.client
    .from('email_send_attempts')
    .insert({
      organization_id: input.orgId,
      lead_id: input.leadId,
      prepared_draft_id: draft.id,
      revenue_identity_id: draft.revenueIdentityId,
      idempotency_key: idem,
      status: 'PENDING',
      updated_at: new Date().toISOString(),
    })

  let sendResult: Awaited<ReturnType<typeof provider.send>>
  try {
    sendResult = await provider.send({
      fromEmail: (mailboxRow as Row).sender_email as string,
      fromName: (mailboxRow as Row).sender_name as string,
      toEmail: email,
      subject,
      body,
      metadata: {
        organizationId: input.orgId,
        leadId: input.leadId,
        draftId: draft.id,
        idempotencyKey: idem,
      },
    })
  } catch (sendError) {
    await input.client
      .from('email_send_attempts')
      .update({ status: 'FAILED', failure_reason: sendError instanceof Error ? sendError.message : 'network_error', updated_at: new Date().toISOString() })
      .eq('organization_id', input.orgId)
      .eq('idempotency_key', idem)
    throw sendError
  }

  if (!sendResult.accepted || sendResult.status === 'FAILED') {
    await input.client
      .from('email_send_attempts')
      .update({ status: 'FAILED', failure_reason: sendResult.failureReason, updated_at: new Date().toISOString() })
      .eq('organization_id', input.orgId)
      .eq('idempotency_key', idem)
    throw new Error(sendResult.failureReason ?? 'Provider rejected send.')
  }

  const originalBody = draft.body ?? body
  const disposition = classifySendDisposition(originalBody, body, false)
  const rejectReasons = inferFeedbackReasons(originalBody, body, disposition)

  const touchType: import('@/lib/domain/types').MessageType = draft.isFollowup ? 'followup' : 'email'
  const markResult = await input.store.markContacted(input.leadId, body, touchType, {
    originalDraft: originalBody,
    sendDisposition: disposition,
    rejectReasons,
    idempotencyKey: idem,
  })
  if (!markResult.allowed) {
    throw new Error(markResult.message ?? 'Unable to record send in Relay.')
  }

  const category = draft.isFollowup ? 'FOLLOW_UP' : 'FIRST_EMAIL'
  const nowIso = new Date().toISOString()
  const { data: emailMsgRow, error: emailMsgError } = await input.client
    .from('email_messages')
    .insert({
      organization_id: input.orgId,
      lead_id: input.leadId,
      message_id: markResult.messageId ?? null,
      prepared_draft_id: draft.id,
      revenue_identity_id: draft.revenueIdentityId,
      mailbox_id: (mailboxRow as Row).id as string,
      contact_point_id: draft.contactPointId,
      direction: 'OUTBOUND',
      category,
      idempotency_key: idem,
      subject,
      body,
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
      provider_thread_id: sendResult.providerThreadId,
      delivery_status: 'SENT',
      sent_at: nowIso,
      last_event_at: nowIso,
      updated_at: nowIso,
    })
    .select('*')
    .single()
  if (emailMsgError) throw emailMsgError

  await input.client
    .from('email_delivery_events')
    .insert({
      organization_id: input.orgId,
      email_message_id: (emailMsgRow as Row).id as string,
      provider_event_id: sendResult.providerMessageId,
      event_type: 'SENT',
      payload: {
        provider: sendResult.provider,
        providerMessageId: sendResult.providerMessageId,
      },
      occurred_at: nowIso,
    })

  await input.client
    .from('prepared_email_drafts')
    .update({ draft_status: 'SENT', edit_disposition: disposition, updated_at: nowIso })
    .eq('organization_id', input.orgId)
    .eq('id', draft.id)

  await input.client
    .from('email_send_attempts')
    .update({
      status: 'SENT',
      email_message_id: (emailMsgRow as Row).id as string,
      provider_message_id: sendResult.providerMessageId,
      updated_at: nowIso,
    })
    .eq('organization_id', input.orgId)
    .eq('idempotency_key', idem)

  if (draft.contactPointId) {
    await input.client
      .from('contact_points')
      .update({ last_used_at: nowIso, updated_at: nowIso })
      .eq('organization_id', input.orgId)
      .eq('id', draft.contactPointId)
  }

  return {
    emailMessage: mapEmailMessage(emailMsgRow as Row),
    todaySends: markResult.todaySends,
    idempotent: false,
  }
}
