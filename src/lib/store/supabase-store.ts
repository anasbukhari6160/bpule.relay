import type { SupabaseClient } from '@supabase/supabase-js'
import { opportunityKey } from '@/lib/scoring-v4/opportunity-key'
import { determineFollowup } from '@/lib/relay/followup-engine'
import type {
  ContentDraft,
  ContentDraftFeedback,
  ContentDraftStatus,
  ContentHistoryEntry,
  ContentPersona,
  ContentPillar,
  ContentPlatform,
  ContentPostStructure,
  ContentProfile,
  ContentProfileExpertise,
  ContentProfileTechnology,
  ContentProfileGoal,
  ContentProfileTopic,
  ContentProfileOpinion,
  ContentProfileProject,
  ContentProfileExperience,
  ContentProfileWritingCharacteristics,
  ContentProfileStorytellingTendency,
  ContentMemory,
  ContentMemoryType,
  ContentOpportunity,
  ContentOpportunityType,
  ContentOpportunityQualification,
  ContentIdeaGenome,
  IdeaGenomeSource,
  IdeaGenomeArchetype,
  ContentEvaluation,
  ContentInterviewSession,
  ContentInterviewAnswer,
  ConversationState,
  ConversationStage,
  CsvImport,
  Fact,
  OrganizationRulebook,
  Lead,
  Message,
  NotificationLogEntry,
  Organization,
  Outcome,
  Play,
  Profile,
  ProofCard,
  ProofItem,
  PushSubscription,
  Rep,
  SalesMemory,
  SalesMemoryType,
  SignalId,
  TailoredCV,
  TopicCluster,
  ContentResearchFinding,
  ContentJourneyEntry,
  ContentQuickCapture,
  QuickCaptureAngle,
  TrendingAngle,
  UpworkJob,
  UpworkMessage,
  Verdict,
  VoiceProfile,
  RevenueIdentity,
  RevenueIdentityChannel,
  RevenueIdentityStatus,
  IdentityAssignment,
  RevenueIdentityWithAssignment,
  ActivityType,
  DailyTarget,
  AccountabilityStatus,
  DailyAccountability,
  AppNotification,
  AuditLogEntry,
  TeamAccountabilityView,
  CommandCenterView,
  CapturedProspect,
  TrendSource,
  TrendItem,
  TrendSourceType,
  EvidenceQuality,
  DailyContentBrief,
  DailyContentIdea,
  DailyGrowthBrief,
  BriefStatus,
  IdeaType,
  SourceFreshness,
  VisualType,
  TrendInterestProfile,
  FieldConfidence,
  PersonaIntelligenceProfile,
  ContentSource,
  VoiceSample,
} from '@/lib/domain/types'
import type {
  CreateLeadResult,
  DosageResult,
  ExtractionMetrics,
  FollowupDue,
  HostCallInput,
  LeadDetail,
  ModelCallLogInput,
  MyRank,
  NewLeadInput,
  QueueData,
  SaveDraftInput,
  ScoutStore,
  SendBudget,
  TeamStats,
  TodayDashboard,
  UpworkSnapshot,
} from '@/lib/store/types'
import { companyFuzzyKey, companyKey, contactKey, normalizeLeadUrl } from '@/lib/leads/normalize'
import { calendarDaysBetween, followupDueInDays } from '@/lib/leads/followup'
import { emitAction } from '@/lib/action-ledger'
import { dailyConnectionSendLimit, dailySendLimit, messageTypeLimit } from '@/lib/ai/config'
import { defaultTargetsForChannel } from '@/lib/accountability/default-targets'
import { computeRates, type RateBucket } from '@/lib/store/rates'
import { matchProofItemsByTags } from '@/lib/ai/proof-match'
import { pickPlayForSignal } from '@/lib/score/plays'
import { loadRulebook } from '@/lib/score/rulebook'
import {
  rankArchiveResults,
  type ArchiveEntityFilter,
  type ArchiveSearchCandidate,
} from '@/lib/search/archive-search'

type Row = Record<string, unknown>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface TeamMemberRow {
  repId: string
  repName: string
  role: string
}

interface TeamTargetRow {
  repId: string
  repName: string
  revenueIdentityId: string
  identityName: string
  channel: string
  activityType: string
  targetCount: number
  completedCount: number
  remaining: number
  status: string
}

interface TeamSummaryRow {
  teamId: string
  teamName: string
  memberCount: number
  totalTarget: number
  totalCompleted: number
  totalRemaining: number
  needsAttention: number
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean)
  }
  return []
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function isOptionalSearchError(err: unknown): boolean {
  const code = (err as { code?: string }).code ?? ''
  const message = (err as { message?: string }).message ?? ''
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    /does not exist|not found in the schema cache|could not find the table|Could not find a relationship/i.test(message)
  )
}

/**
 * Column lists for `leads`. `select('*')` drags the generated `search_vector`
 * tsvector (and `raw_input`) on every row, which dominated list payloads.
 * LEAD_COLUMNS keeps raw_input for detail/draft callers; LEAD_LIST_COLUMNS
 * drops it for list, queue and rate queries that never read it.
 */
const LEAD_COLUMNS =
  'id, organization_id, owner_rep_id, company, company_key, contact_name, contact_title, title_raw, location_raw, url, raw_input, role_category, market_region, extraction_confidence, extraction_profile, signal_type, signal_evidence, verbatim_quote, score, verdict, status, play_id, tags, direction, source, inbound_message, inbound_raw, sender_profile_id, revenue_identity_id, canonical_score, score_version, scored_at, canonical_intelligence, raw_source_data, score_breakdown, remote_eligibility, evidence_ledger, extraction_completeness, intelligence_input_hash, connection_accepted_at, locked_until, locked_reason, archived, archived_at, created_at'

/**
 * Read-back used when a newer optional column (intelligence_input_hash,
 * connection lock, archival) is not on this database yet. Must stay free of
 * those columns. Extraction fields from migration 0015 stay here on purpose:
 * if THOSE are missing, lead creation should still fail loudly.
 */
const LEAD_COLUMNS_STABLE =
  'id, organization_id, owner_rep_id, company, company_key, contact_name, contact_title, title_raw, location_raw, url, raw_input, role_category, market_region, extraction_confidence, extraction_profile, signal_type, signal_evidence, verbatim_quote, score, verdict, status, play_id, tags, direction, source, inbound_message, inbound_raw, sender_profile_id, revenue_identity_id, canonical_score, score_version, scored_at, canonical_intelligence, raw_source_data, score_breakdown, remote_eligibility, evidence_ledger, extraction_completeness, created_at'

const OPTIONAL_MESSAGE_COLUMNS = ['direction', 'idempotency_key'] as const

/** Drop an optional messages column the live schema does not have yet, so a send can still be logged. */
function omitNamedMissingColumns(payload: Record<string, unknown>, err: unknown, columns: readonly string[]): boolean {
  if (!isOptionalSearchError(err)) return false
  const message = ((err as { message?: string }).message ?? '').toLowerCase()
  let omitted = false
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(payload, column) && message.includes(column)) {
      delete payload[column]
      omitted = true
    }
  }
  return omitted
}

async function insertMessageReturningId(
  client: { from: (table: string) => { insert: (payload: Record<string, unknown>) => { select: (columns: string) => { single: () => PromiseLike<{ data: { id: string } | null; error: { code?: string; message?: string } | null }> } } } },
  payload: Record<string, unknown>,
): Promise<{ data: { id: string } | null; error: { code?: string; message?: string } | null }> {
  let data: { id: string } | null = null
  let error: { code?: string; message?: string } | null = null
  for (let attempt = 0; attempt < OPTIONAL_MESSAGE_COLUMNS.length + 1; attempt += 1) {
    const result = await client.from('messages').insert(payload).select('id').single()
    data = result.data
    error = result.error
    if (!error) break
    if (!omitNamedMissingColumns(payload, error, OPTIONAL_MESSAGE_COLUMNS)) break
  }
  return { data, error }
}

function isMissingColumnError(err: unknown): boolean {
  const code = (err as { code?: string }).code ?? ''
  const message = (err as { message?: string }).message ?? ''
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column .+ does not exist|schema cache/i.test(message)
  )
}

const LEAD_LIST_COLUMNS =
  'id, organization_id, owner_rep_id, company, company_key, contact_name, contact_title, title_raw, location_raw, url, role_category, market_region, extraction_confidence, extraction_profile, signal_type, signal_evidence, verbatim_quote, score, verdict, status, play_id, tags, direction, source, inbound_message, inbound_raw, sender_profile_id, revenue_identity_id, canonical_score, score_version, scored_at, score_breakdown, buyer_intent:canonical_intelligence->buyerIntent, display_qualification:canonical_intelligence->>qualification, display_intelligence_version:canonical_intelligence->>intelligenceVersion, remote_eligibility, connection_accepted_at, locked_until, locked_reason, archived, archived_at, decision_provider, decision_model, decision_run_id, selected_episode_id, profile_match_score, profile_match_version, best_profile_id, best_profile_match_score, intelligence_input_hash, fallback_reason, created_at'

export function mapLead(r: Row): Lead {
  const canonical = (r.canonical_intelligence as Record<string, unknown> | null) ?? null
  const packet = canonical?.v3DecisionPacket as Record<string, unknown> | undefined
  const nestedBuyerIntent = canonical?.buyerIntent ?? packet?.buyerIntent
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    ownerRepId: (r.owner_rep_id as string) ?? null,
    company: r.company as string,
    companyKey: r.company_key as string,
    contactName: (r.contact_name as string) ?? null,
    contactTitle: (r.contact_title as string) ?? null,
    titleRaw: (r.title_raw as string) ?? null,
    locationRaw: (r.location_raw as string) ?? null,
    url: (r.url as string) ?? null,
    rawInput: (r.raw_input as string) ?? null,
    roleCategory: (r.role_category as Lead['roleCategory']) ?? null,
    marketRegion: (r.market_region as Lead['marketRegion']) ?? null,
    extractionConfidence: (r.extraction_confidence as number) ?? null,
    extractionProfile: (r.extraction_profile as Record<string, unknown>) ?? null,
    signalType: (r.signal_type as Lead['signalType']) ?? null,
    signalEvidence: (r.signal_evidence as string) ?? null,
    verbatimQuote: (r.verbatim_quote as string) ?? null,
    score: (r.score as number) ?? null,
    verdict: (r.verdict as Lead['verdict']) ?? null,
    status: (r.status as Lead['status']) ?? 'new',
    playId: (r.play_id as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    direction: (r.direction as Lead['direction']) ?? 'outbound',
    source: (r.source as Lead['source']) ?? null,
    inboundMessage: (r.inbound_message as string) ?? null,
    inboundRaw: (r.inbound_raw as Record<string, unknown>) ?? null,
    senderProfileId: (r.sender_profile_id as string) ?? null,
    revenueIdentityId: (r.revenue_identity_id as string) ?? null,
    canonicalScore: (r.canonical_score as number) ?? null,
    scoreVersion: (r.score_version as string) ?? null,
    scoredAt: (r.scored_at as string) ?? null,
    canonicalIntelligence: canonical,
    displayQualification: (r.display_qualification as string)
      ?? ((r.canonical_intelligence as Record<string, unknown> | null)?.qualification as string)
      ?? null,
    displayIntelligenceVersion: (r.display_intelligence_version as string)
      ?? (canonical?.intelligenceVersion as string)
      ?? null,
    buyerIntent: (r.buyer_intent as Record<string, unknown>)
      ?? (nestedBuyerIntent as Record<string, unknown>)
      ?? null,
    qualification: (r.qualification as string)
      ?? (canonical?.qualification as string)
      ?? (r.display_qualification as string)
      ?? null,
    rawSourceData: (r.raw_source_data as Record<string, unknown>) ?? null,
    scoreBreakdown: (r.score_breakdown as Record<string, unknown>) ?? null,
    remoteEligibility: (r.remote_eligibility as Record<string, unknown>) ?? null,
    evidenceLedger: (r.evidence_ledger as Record<string, unknown>) ?? null,
    extractionCompleteness: (r.extraction_completeness as Record<string, unknown>) ?? null,
    connectionAcceptedAt: (r.connection_accepted_at as string) ?? null,
    lockedUntil: (r.locked_until as string) ?? null,
    lockedReason: (r.locked_reason as string) ?? null,
    archived: (r.archived as boolean) ?? false,
    archivedAt: (r.archived_at as string) ?? null,
    // Score observability
    decisionProvider: (r.decision_provider as string) ?? null,
    decisionModel: (r.decision_model as string) ?? null,
    decisionRunId: (r.decision_run_id as string) ?? null,
    selectedEpisodeId: (r.selected_episode_id as string) ?? null,
    profileMatchScore: (r.profile_match_score as number) ?? null,
    profileMatchVersion: (r.profile_match_version as string) ?? null,
    bestProfileId: (r.best_profile_id as string) ?? null,
    bestProfileMatchScore: (r.best_profile_match_score as number) ?? null,
    intelligenceInputHash: (r.intelligence_input_hash as string) ?? null,
    fallbackReason: (r.fallback_reason as string) ?? null,
    createdAt: r.created_at as string,
  }
}

function mapMessage(r: Row): Message {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    leadId: r.lead_id as string,
    repId: (r.rep_id as string) ?? null,
    type: r.type as Message['type'],
    draftText: (r.draft_text as string) ?? null,
    sentText: (r.sent_text as string) ?? null,
    sentAt: (r.sent_at as string) ?? null,
    modelUsed: (r.model_used as string) ?? null,
    originalDraft: (r.original_draft as string) ?? null,
    sendDisposition: (r.send_disposition as Message['sendDisposition']) ?? null,
    rejectReasons: Array.isArray(r.reject_reasons) ? r.reject_reasons as Message['rejectReasons'] : [],
    idempotencyKey: (r.idempotency_key as string) ?? null,
    direction: (r.direction as Message['direction']) ?? 'outbound',
    createdAt: r.created_at as string,
  }
}

function mapOutcome(r: Row): Outcome {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    leadId: r.lead_id as string,
    stage: r.stage as Outcome['stage'],
    occurredAt: r.occurred_at as string,
  }
}

function mapFact(r: Row): Fact {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    label: r.label as string,
    value: r.value as string,
    factType: (r.fact_type as string) ?? null,
    addedBy: (r.added_by as string) ?? null,
    createdAt: r.created_at as string,
  }
}

function mapPlay(r: Row): Play {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    name: r.name as string,
    situation: r.situation as string,
    templateShape: r.template_shape as string,
  }
}

function mapProfile(r: Row): Profile {
  return {
    id: r.id as string,
    repId: r.rep_id as string,
    organizationId: r.organization_id as string,
    platform: r.platform as Profile['platform'],
    label: (r.label as string) ?? null,
    profileUrl: (r.profile_url as string) ?? null,
    headline: (r.headline as string) ?? null,
    cvPath: (r.cv_path as string) ?? null,
    createdAt: r.created_at as string,
  }
}

/**
 * Query-layer enforcement of the proof rule: a client name is only ever
 * exposed when permission is on file. Without permission the field is null
 * here, before any prompt or UI ever sees it.
 */
function mapProofItem(r: Row): ProofItem {
  const permissionOnFile = Boolean(r.permission_on_file)
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    profileId: r.profile_id as string,
    clientNamed: Boolean(r.client_named),
    clientName: permissionOnFile ? ((r.client_name as string) ?? null) : null,
    permissionOnFile,
    projectSummary: r.project_summary as string,
    reviewQuote: (r.review_quote as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    createdAt: r.created_at as string,
  }
}

/**
 * Admin-only mapping: the real client_name is exposed regardless of
 * permission_on_file, so the admin can see who the client actually is when
 * deciding whether to flip that flag. Never used on a path a non-admin can
 * reach.
 */
function mapProofItemUnredacted(r: Row): ProofItem {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    profileId: r.profile_id as string,
    clientNamed: Boolean(r.client_named),
    clientName: (r.client_name as string) ?? null,
    permissionOnFile: Boolean(r.permission_on_file),
    projectSummary: r.project_summary as string,
    reviewQuote: (r.review_quote as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    createdAt: r.created_at as string,
  }
}

/**
 * Supabase store. RLS is enforced by the per-request client that carries the
 * signed-in session, so a rep literally cannot read or mutate another rep's
 * queue from this code path.
 */
export class SupabaseStore implements ScoutStore {
  constructor(
    private readonly rep: Rep,
    private readonly client: SupabaseClient,
    private readonly organization: Organization,
  ) {}

  get organizationId(): string {
    return this.organization.id
  }

  getSupabaseClient(): SupabaseClient {
    return this.client
  }

  private get orgId(): string {
    return this.organization.id
  }

  private _rulebookCache: OrganizationRulebook | null | undefined = undefined
  private _orgSettingsCache: Record<string, unknown> | undefined = undefined

  async getRulebook(): Promise<OrganizationRulebook | null> {
    if (this._rulebookCache !== undefined) return this._rulebookCache
    this._rulebookCache = await loadRulebook(this.client, this.orgId)
    return this._rulebookCache
  }

  async getOrgSettings(): Promise<Record<string, unknown>> {
    if (this._orgSettingsCache !== undefined) return this._orgSettingsCache
    const { data } = await this.client
      .from('organizations')
      .select('settings')
      .eq('id', this.orgId)
      .maybeSingle()
    this._orgSettingsCache = (data?.settings as Record<string, unknown>) ?? {}
    return this._orgSettingsCache
  }

  private _ratesCache: RateBucket[] | undefined = undefined

  private async fetchRates(): Promise<RateBucket[]> {
    if (this._ratesCache) return this._ratesCache
    this._ratesCache = await this._fetchRatesUncached()
    return this._ratesCache
  }

  private async _fetchRatesUncached(): Promise<RateBucket[]> {
    const [leads, messages, outcomes] = await Promise.all([
      this.fetchLeadsAll(),
      this.client
        .from('messages')
        .select('id, lead_id, type, sent_at, sent_text')
        .then((r) => {
          if (r.error) throw r.error
          return (r.data ?? []).map(mapMessage)
        }),
      this.client
        .from('outcomes')
        .select('id, lead_id, stage, occurred_at')
        .then((r) => {
          if (r.error) throw r.error
          return (r.data ?? []).map(mapOutcome)
        }),
    ])
    return leads.map((lead) => ({
      lead,
      sentMessages: messages.filter((m) => m.leadId === lead.id),
      outcomes: outcomes.filter((o) => o.leadId === lead.id),
    }))
  }

  async fetchLeadsAll(scopeToUser = false, includeArchived = false): Promise<Lead[]> {
    let query = this.client
      .from('leads')
      .select(LEAD_LIST_COLUMNS)
      .order('created_at', { ascending: false })

    // Non-admin users can only see their own leads
    if (scopeToUser || this.rep.role !== 'admin') {
      query = query.eq('owner_rep_id', this.rep.id)
    }

    // Default excludes archived leads — the live board/dashboards/queues
    // should never show a lead that has been swept into archive. Callers
    // that genuinely need archived leads too (e.g. the /archive search
    // page) pass includeArchived: true explicitly.
    if (!includeArchived) {
      query = query.eq('archived', false)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapLead)
  }

  private async countTodaysSends(type?: string): Promise<number> {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + 86_400_000)
    let q = this.client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', this.rep.id)
      .gte('sent_at', start.toISOString())
      .lt('sent_at', end.toISOString())
    if (type) q = q.eq('type', type)
    const { count, error } = await q
    if (error) throw error
    return count ?? 0
  }

  private todayRange(): { start: string; end: string } {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + 86_400_000)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  /** Counts lead messages of any of the given types sent today — dm+followup and connection are two different ceilings (Part 7 rule) and must never be blended into one number. */
  private async countTodaysSendsByTypes(types: string[]): Promise<number> {
    const { start, end } = this.todayRange()
    const { count, error } = await this.client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', this.rep.id)
      .in('type', types)
      .gte('sent_at', start)
      .lt('sent_at', end)
    if (error) throw error
    return count ?? 0
  }

  /** Upwork applies today share the connection-type daily ceiling but live in a separate table; countTodaysSendsByTypes alone would silently miss them. */
  private async countTodaysUpworkApplies(): Promise<number> {
    const { start, end } = this.todayRange()
    const { count, error } = await this.client
      .from('upwork_messages')
      .select('id', { count: 'exact', head: true })
      .eq('rep_id', this.rep.id)
      .not('sent_at', 'is', null)
      .gte('sent_at', start)
      .lt('sent_at', end)
    if (error) throw error
    return count ?? 0
  }

  private async _insertLeadRow(insertRow: Record<string, unknown>): Promise<{ data: { id?: string } | null; error: unknown }> {
    // First attempt: insert with all columns (including observability).
    const first = await this.client
      .from('leads')
      .insert(insertRow)
      .select('id')
      .single()

    if (!first.error) return first

    // If the error is about a missing column, strip observability columns
    // and retry. This handles the case where the migration hasn't been applied yet.
    const msg = (first.error as { message?: string }).message ?? ''
    const code = (first.error as { code?: string }).code ?? ''
    const isMissingCol = code === '42703' || /does not exist|column .* does not exist/i.test(msg)

    if (!isMissingCol) return first

    // Fallback triggered — observability columns missing from schema.
    // Track this so we know when it's safe to remove the compatibility path.
    console.warn('[store] _insertLeadRow fallback: observability columns missing, retrying without them.')

    const { decision_provider, decision_model, decision_run_id, selected_episode_id,
      profile_match_score, profile_match_version, best_profile_id, best_profile_match_score,
      v3_reuse_key, fallback_reason, ...coreRow } = insertRow

    return await this.client
      .from('leads')
      .insert(coreRow)
      .select('id')
      .single()
  }

  async createLead(input: NewLeadInput): Promise<CreateLeadResult> {
    const key = companyKey(input.company)
    const fuzzy = companyFuzzyKey(input.company)
    const normalizedUrl = normalizeLeadUrl(input.url ?? null)
    const normalizedContact = contactKey(input.contactName ?? null)
    const all = await this.fetchLeadsAll()

    const priorNo = all.find(
      (l) => l.companyKey === key && (l.status === 'no' || l.status === 'dead'),
    )
    if (priorNo) {
      return {
        blocked: true,
        reason: 'This company was already flagged no by the team. It is locked for everyone.',
        existingOwnerName: await this.repName(priorNo.ownerRepId),
        lead: priorNo,
        duplicateKind: 'hard',
      }
    }

    // Skip dedup for unknown/empty company names — they collide trivially
    const isUnknownCompany = !input.company
      || input.company === 'Unknown company'
      || input.company === 'Unnamed company'
      || key === 'unknowncompany'
      || key === 'unnamedcompany'

    const exact = isUnknownCompany
      ? undefined
      : all.find((l) => l.companyKey === key && l.status !== 'dead' && !l.archived)
    const urlHit = normalizedUrl && !isUnknownCompany
      ? all.find((l) => normalizeLeadUrl(l.url ?? null) === normalizedUrl && l.companyKey === key && l.status !== 'dead' && !l.archived)
      : null
    const contactHit = isUnknownCompany || !normalizedContact
      ? undefined
      : all.find((l) => l.companyKey === key && contactKey(l.contactName) === normalizedContact && l.status !== 'dead' && !l.archived)
    const fuzzyHit = isUnknownCompany
      ? undefined
      : all.find(
        (l) => l.companyKey !== key && companyFuzzyKey(l.company) === fuzzy && l.status !== 'dead' && !l.archived,
      )
    const hit = urlHit ?? contactHit ?? exact ?? fuzzyHit
    if (hit) {
      const duplicateKind: 'hard' | 'potential' = fuzzyHit && !urlHit && !contactHit && !exact ? 'potential' : 'hard'
      if (duplicateKind !== 'potential' || input.allowPotentialDuplicate !== true) {
        const reason = urlHit
          ? 'This profile URL already exists as a lead.'
          : contactHit
            ? 'This contact already exists under this company.'
            : duplicateKind === 'potential'
              ? 'Potential duplicate: this company name is very similar to an existing lead.'
              : 'This company already exists on the board.'
        return {
          blocked: true,
          reason,
          existingOwnerName: await this.repName(hit.ownerRepId),
          lead: hit,
          duplicateKind,
        }
      }
    }

    const canonicalIntelligence = input.canonicalIntelligence
      || input.buyerIntent
      || input.qualification
      ? {
          ...(input.canonicalIntelligence ?? {}),
          buyerIntent: input.buyerIntent
            ?? input.canonicalIntelligence?.buyerIntent
            ?? null,
          qualification: input.qualification
            ?? input.canonicalIntelligence?.qualification
            ?? null,
        }
      : null

    const insertRow = {
      organization_id: this.orgId,
      owner_rep_id: this.rep.id,
      company: input.company.trim(),
      contact_name: input.contactName?.trim() || null,
      contact_title: input.contactTitle?.trim() || null,
      url: input.url?.trim() || null,
      raw_input: input.rawInput?.trim() || null,
      signal_type: input.signalType ?? null,
      signal_evidence: input.signalEvidence?.trim() || null,
      verbatim_quote: input.verbatimQuote?.trim() || null,
      score: input.score ?? null,
      verdict: input.verdict ?? null,
      tags: input.tags ?? [],
      play_id: input.signalType ? (await this.playForSignal(input.signalType))?.id ?? null : null,
      title_raw: input.titleRaw?.trim() || null,
      location_raw: input.locationRaw?.trim() || null,
      role_category: input.roleCategory ?? null,
      market_region: input.marketRegion ?? null,
      extraction_confidence: input.extractionConfidence ?? null,
      extraction_profile: input.extractionProfile ?? null,
      direction: input.direction ?? 'outbound',
      source: input.source ?? null,
      inbound_message: input.inboundMessage ?? null,
      inbound_raw: input.inboundRaw ?? null,
      sender_profile_id: input.senderProfileId ?? input.assignedProfileId ?? null,
      revenue_identity_id: input.revenueIdentityId ?? null,
      // Intelligence V2
      canonical_score: input.canonicalScore ?? null,
      score_version: input.scoreVersion ?? null,
      scored_at: input.scoredAt ?? null,
      canonical_intelligence: canonicalIntelligence,
      raw_source_data: input.rawSourceData ?? null,
      score_breakdown: input.scoreBreakdown ?? null,
      remote_eligibility: input.remoteEligibility ?? null,
      evidence_ledger: input.evidenceLedger ?? null,
      extraction_completeness: input.extractionCompleteness ?? null,
      // Score observability — these columns may not exist yet if the migration
      // hasn't been applied. They're stripped automatically by the insert
      // wrapper below to avoid 42703 errors.
      decision_provider: input.decisionProvider ?? null,
      decision_model: input.decisionModel ?? null,
      decision_run_id: input.decisionRunId ?? null,
      selected_episode_id: input.selectedEpisodeId ?? null,
      profile_match_score: input.profileMatchScore ?? null,
      profile_match_version: input.profileMatchVersion ?? null,
      best_profile_id: input.bestProfileId ?? null,
      best_profile_match_score: input.bestProfileMatchScore ?? null,
      intelligence_input_hash: input.intelligenceInputHash ?? null,
      v3_reuse_key: input.v3ReuseKey ?? null,
      fallback_reason: input.fallbackReason ?? null,
    }

    // Insert with graceful column handling. PostgREST runs insert().select(cols)
    // as one INSERT ... RETURNING statement: if any inserted column doesn't exist
    // yet (observability columns from the migration), Postgres rejects the whole
    // insert. We strip unknown columns and retry, so lead creation never fails
    // due to pending DDL.
    const inserted = await this._insertLeadRow(insertRow)
    if (inserted.error) {
      const code = (inserted.error as { code?: string }).code
      if (code === '23505') {
        const existing = (await this.fetchLeadsAll()).find(
          (lead) => lead.companyKey === key && lead.status !== 'dead' && !lead.archived,
        )
        return {
          blocked: true,
          reason: 'This company already exists on the board.',
          existingOwnerName: existing ? await this.repName(existing.ownerRepId) : undefined,
          lead: existing,
          duplicateKind: 'hard',
        }
      }
      throw inserted.error
    }

    const insertedId = (inserted.data as { id?: string } | null)?.id
    if (!insertedId) {
      throw new Error('Lead insert did not return an id.')
    }

    let row: { data: Row | null; error: unknown } = await this.client
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('id', insertedId)
      .single()
    if (row.error && isMissingColumnError(row.error)) {
      const fallback = await this.client
        .from('leads')
        .select(LEAD_COLUMNS_STABLE)
        .eq('id', insertedId)
        .single()
      if (fallback.error) {
        if (isMissingColumnError(fallback.error)) {
          throw new Error(
            'This environment is missing the extraction-fields migration (0015_extraction_schema_and_metrics.sql). ' +
              'Apply it before saving leads, so title, location, role, region, and confidence are never silently dropped.',
          )
        }
        const fbErr = fallback.error as { message?: string; code?: string }
        throw new Error(
          `Lead read-back failed after insert: ${fbErr.message ?? 'unknown error'} (code ${fbErr.code ?? 'n/a'})`,
        )
      }
      row = fallback as typeof row
    } else if (row.error) {
      throw row.error
    }
    const lead = mapLead(row.data as Row)

    // Create outbound relay run (non-fatal — must not break lead creation)
    let relayRunId: string | null = null
    try {
      relayRunId = await this.createRelayRun({
        runType: 'outbound',
        primaryEntityType: 'lead',
        primaryEntityId: lead.id,
        assignedRepId: this.rep.id,
        correlationId: lead.id,
        context: {
          leadId: lead.id,
          company: lead.company,
          direction: lead.direction ?? 'outbound',
          source: 'createLead',
        },
      })

      // Advance run through qualifying pipeline to awaiting_human
      // (lead is already analyzed/qualified by the time it reaches Save Lead)
      if (relayRunId) {
        await this.advanceOutboundRunToWaiting(relayRunId)
      }
    } catch {
      // Run creation must never break lead creation
    }

    // Emit LEAD_CREATED event (non-fatal — must not break lead creation)
    try {
      await this.emitRelayEvent({
        eventType: 'LEAD_CREATED',
        entityType: 'lead',
        entityId: lead.id,
        actorType: 'rep',
        actorId: this.rep.id,
        relayRunId,
        correlationId: relayRunId ?? lead.id,
        payload: {
          company: lead.company,
          signalType: lead.signalType,
          score: lead.score,
          verdict: lead.verdict,
          direction: lead.direction ?? 'outbound',
        },
        source: 'app',
        sourceEventId: `lead_created:${lead.id}`,
      })
    } catch {
      // Event emission must never break domain operations
    }

    try {
      await emitAction({
        orgId: this.orgId,
        actionType: 'LEAD_EXTRACTED',
        actorType: 'rep',
        actorId: this.rep.id,
        leadId: lead.id,
        senderProfileId: lead.senderProfileId ?? null,
        metadata: { company: lead.company, signalType: lead.signalType },
        idempotencyKey: `lead_extracted:${lead.id}`,
      })
    } catch {
      // Action ledger must never break domain operations
    }

    return { blocked: false, lead }
  }

  private async playForSignal(signalType: SignalId): Promise<Play | null> {
    return pickPlayForSignal(await this.listPlays(), signalType)
  }

  private async repName(repId: string | null): Promise<string | undefined> {
    if (!repId) return undefined
    const { data } = await this.client
      .from('reps')
      .select('name')
      .eq('id', repId)
      .maybeSingle()
    return data?.name ?? undefined
  }

  async updateLeadScore(
    id: string,
    score: { total: number; verdict: Verdict },
  ): Promise<void> {
    const { error } = await this.client
      .from('leads')
      .update({ score: score.total, verdict: score.verdict })
      .eq('id', id)
      .eq('owner_rep_id', this.rep.id)
    if (error) throw error
  }

  /**
   * Update canonical score with a rescore event.
   * Appends to the rescore_events array for provenance.
   */
  async updateCanonicalScore(
    id: string,
    update: {
      canonicalScore: number
      scoreVersion: string
      scoreBreakdown: Record<string, unknown>
      rescoreEvent: {
        fromScore: number
        toScore: number
        reason: string
        version: string
        timestamp: string
        trigger: string
      }
    },
  ): Promise<void> {
    const { error } = await this.client
      .rpc('append_rescore_event', {
        p_lead_id: id,
        p_canonical_score: update.canonicalScore,
        p_score_version: update.scoreVersion,
        p_score_breakdown: update.scoreBreakdown,
        p_rescore_event: update.rescoreEvent,
      })
    if (error) {
      // Fallback: read current events, append, update
      const { data: current } = await this.client
        .from('leads')
        .select('rescore_events')
        .eq('id', id)
        .eq('owner_rep_id', this.rep.id)
        .maybeSingle()
      const events = (current?.rescore_events as unknown[]) ?? []
      const { error: updateError } = await this.client
        .from('leads')
        .update({
          canonical_score: update.canonicalScore,
          score_version: update.scoreVersion,
          scored_at: new Date().toISOString(),
          score_breakdown: update.scoreBreakdown,
          rescore_events: [...events, update.rescoreEvent],
        })
        .eq('id', id)
        .eq('owner_rep_id', this.rep.id)
      if (updateError) throw updateError
    }
  }

  async updateLeadTags(id: string, tags: string[]): Promise<void> {
    const { error } = await this.client
      .from('leads')
      .update({ tags })
      .eq('id', id)
      .eq('owner_rep_id', this.rep.id)
    if (error) throw error
  }

  async getLead(id: string) {
    const { data, error } = await this.client
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    // Enforce ownership: non-admin can only access their own leads.
    // A lead with no owner (NULL owner_rep_id) is claimable — the acting
    // rep is treated as its owner so freshly-extracted leads that haven't
    // been assigned yet don't block the workflow.
    const leadOwner = (data as Record<string, unknown>).owner_rep_id as string | null
    if (this.rep.role !== 'admin' && leadOwner !== null && leadOwner !== this.rep.id) {
      throw new Error('You are not the owner of this lead.')
    }

    const [messages, outcomes, convState] = await Promise.all([
      this.client
        .from('messages')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .then((r) => {
          if (r.error) throw r.error
          return (r.data ?? []).map(mapMessage)
        }),
      this.client
        .from('outcomes')
        .select('*')
        .eq('lead_id', id)
        .then((r) => {
          if (r.error) throw r.error
          return (r.data ?? []).map(mapOutcome)
        }),
      this.client
        .from('conversation_states')
        .select('followup_count, won_at, lost_at')
        .eq('lead_id', id)
        .maybeSingle()
        .then((r) => {
          if (r.error) throw r.error
          return r.data as { followup_count?: number; won_at?: string | null; lost_at?: string | null } | null
        }),
    ])

    return {
      ...mapLead(data as Row),
      messages,
      outcomes,
      followupCount: convState?.followup_count ?? 0,
      wonAt: convState?.won_at ?? null,
      lostAt: convState?.lost_at ?? null,
    }
  }

  async findLeadByIntelligenceInputHash(hash: string): Promise<LeadDetail | null> {
    if (!hash) return null
    // Explicit organization_id scope, not RLS alone — this is a hash lookup
    // across many rows (not a single-row-by-id fetch like getLead), so it
    // must never be allowed to match a lead in a different organization.
    const { data, error } = await this.client
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('organization_id', this.orgId)
      .eq('intelligence_input_hash', hash)
      .not('canonical_intelligence', 'is', null)
      .order('scored_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      if (isOptionalSearchError(error)) return null // migration not yet applied — fail open to fresh extraction, never throw
      throw error
    }
    if (!data) return null
    return { ...mapLead(data as Row), messages: [], outcomes: [], followupCount: 0 }
  }

  async findLeadByV3ReuseKey(reuseKey: string): Promise<Lead | null> {
    if (!reuseKey) return null
    const { data, error } = await this.client
      .from('leads')
      .select(LEAD_LIST_COLUMNS)
      .eq('organization_id', this.orgId)
      .eq('v3_reuse_key', reuseKey)
      .not('canonical_intelligence', 'is', null)
      .order('scored_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      if (isOptionalSearchError(error)) return null
      throw error
    }
    if (!data) return null
    return mapLead(data as Row)
  }

  async getReferredLeads(repId: string): Promise<Lead[]> {
    const { data, error } = await this.client
      .from('leads')
      .select(LEAD_LIST_COLUMNS)
      .eq('organization_id', this.orgId)
      .eq('referred_to_rep_id', repId)
      .eq('status', 'new')
      .order('referral_at', { ascending: false })
      .limit(10)
    if (error) {
      if (isOptionalSearchError(error)) return []
      throw error
    }
    return (data as Row[]).map(mapLead)
  }

  async getRecentLeads(repId: string, limit: number): Promise<Lead[]> {
    const { data, error } = await this.client
      .from('leads')
      .select(LEAD_LIST_COLUMNS)
      .eq('organization_id', this.orgId)
      .eq('owner_rep_id', repId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      if (isOptionalSearchError(error)) return []
      throw error
    }
    return (data as Row[]).map(mapLead)
  }

  async listOwnedLeads(includeArchived = false): Promise<Lead[]> {
    let query = this.client
      .from('leads')
      .select(LEAD_LIST_COLUMNS)
      .eq('owner_rep_id', this.rep.id)
      .order('created_at', { ascending: false })
    if (!includeArchived) {
      query = query.eq('archived', false)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapLead)
  }

  async getQueue(): Promise<QueueData> {
    const [owned, todaySends] = await Promise.all([
      this.listOwnedLeads(),
      this.countTodaysSends(),
    ])
    const queue = owned.filter((l) => l.status === 'new' || l.status === 'contacted')
    const replies = owned.filter((l) => l.status === 'replied')
    return { todaySends, dailyLimit: dailySendLimit(), queue, replies }
  }

  async saveDraft(input: SaveDraftInput): Promise<Message> {
    const { data, error } = await this.client
      .from('messages')
      .insert({
        organization_id: this.orgId,
        lead_id: input.leadId,
        rep_id: this.rep.id,
        type: input.type,
        draft_text: input.draftText,
        model_used: input.modelUsed,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapMessage(data as Row)
  }

  async markContacted(
    leadId: string,
    sentText: string,
    messageType: Message['type'] = 'dm',
    feedback?: {
      originalDraft?: string | null
      sendDisposition?: import('@/lib/domain/types').SendDisposition | null
      rejectReasons?: import('@/lib/domain/types').SendFeedbackReason[]
      idempotencyKey?: string | null
    },
  ): Promise<DosageResult> {
    const type = messageType
    const idempotencyKey = feedback?.idempotencyKey?.trim() || null

    // Idempotency check FIRST — before the daily-limit count, so a retry
    // never consumes a second slot against the ceiling either. Mirrors
    // sendPreparedEmail's pattern for Email Outreach V1 (see service.ts).
    if (idempotencyKey) {
      const { data: existing, error: existingError } = await this.client
        .from('messages')
        .select('id')
        .eq('organization_id', this.orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      // A missing idempotency_key column (migration not yet applied) must
      // fail open to normal (non-idempotent) behavior, never throw and
      // block a real send.
      if (!existingError && existing) {
        const todaySendsNow = await this.countTodaysSends(type)
        return { allowed: true, todaySends: todaySendsNow, limit: messageTypeLimit(type), messageId: existing.id as string, idempotent: true }
      }
    }

    if (type === 'connection') {
      const { data: existingConn } = await this.client
        .from('messages')
        .select('id')
        .eq('organization_id', this.orgId)
        .eq('lead_id', leadId)
        .eq('type', 'connection')
        .order('sent_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (existingConn?.id) {
        const todaySendsNow = await this.countTodaysSends(type)
        return { allowed: true, todaySends: todaySendsNow, limit: messageTypeLimit(type), messageId: existingConn.id as string, idempotent: true }
      }
    }

    if (type === 'followup') {
      const [{ data: priorRows }, { data: leadExtra }] = await Promise.all([
        this.client
          .from('messages')
          .select('id, type, sent_text, sent_at, direction, organization_id, lead_id, rep_id, created_at')
          .eq('organization_id', this.orgId)
          .eq('lead_id', leadId),
        this.client
          .from('leads')
          .select('connection_accepted_at, status, company, contact_name')
          .eq('id', leadId)
          .maybeSingle(),
      ])
      const priorMessages = ((priorRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id ?? this.orgId),
        leadId,
        repId: row.rep_id ? String(row.rep_id) : null,
        type: row.type as Message['type'],
        draftText: null,
        sentText: (row.sent_text as string | null) ?? null,
        sentAt: (row.sent_at as string | null) ?? null,
        direction: (row.direction as Message['direction']) ?? 'outbound',
        modelUsed: null,
        createdAt: (row.created_at as string | null) ?? '',
      }))
      const lastOutbound = priorMessages
        .filter((m) => m.direction !== 'inbound' && m.sentAt)
        .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
        .at(-1)
      const lastInbound = priorMessages
        .filter((m) => m.direction === 'inbound' && m.sentAt)
        .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
        .at(-1)
      const strategy = determineFollowup({
        lead: {
          id: leadId,
          organizationId: this.orgId,
          company: (leadExtra?.company as string | null) ?? '',
          contactName: (leadExtra?.contact_name as string | null) ?? null,
          status: ((leadExtra?.status as string | null) ?? 'contacted') as Lead['status'],
          connectionAcceptedAt: (leadExtra?.connection_accepted_at as string | null) ?? null,
        } as Lead,
        priorMessages,
        conversationStage: (leadExtra?.status as string | null) ?? 'contacted',
        senderProfileId: null,
        followupCount: priorMessages.filter((m) => m.type === 'followup').length,
        lastSentAt: lastOutbound?.sentAt ?? null,
        lastReplyAt: lastInbound?.sentAt ?? null,
      })
      if (!strategy.shouldFollowUp) {
        throw new Error(`NOT_ELIGIBLE: ${strategy.waitReason ?? strategy.reason}`)
      }
    }

    const orgSettings = await this.getOrgSettings()
    const todaySends = await this.countTodaysSends(type)
    const limit = messageTypeLimit(type, orgSettings)
    if (todaySends >= limit) {
      return {
        allowed: false,
        todaySends,
        limit,
        message: `Daily ceiling of ${limit} reached for ${type} messages. Other message types still have budget.`,
      }
    }

    const { data: leadRow, error: leadError } = await this.client
      .from('leads')
      .select('id, status, verdict, locked_until, owner_rep_id, sender_profile_id')
      .eq('id', leadId)
      .maybeSingle()
    if (leadError) throw leadError
    if (!leadRow) {
      throw new Error('You are not the owner of this lead, so it could not be marked contacted.')
    }
    // Enforce ownership: a rep can act on their own leads and on leads
    // with no owner (NULL). An unowned lead is claimed by the acting rep
    // so a freshly-extracted lead never blocks the send/log workflow.
    const leadOwnerId = (leadRow as unknown as { owner_rep_id: string | null }).owner_rep_id
    if (this.rep.role !== 'admin' && leadOwnerId !== null && leadOwnerId !== this.rep.id) {
      throw new Error('NOT_OWNER: This lead is assigned to another rep.')
    }
    if (leadOwnerId === null) {
      // Claim the unowned lead for this rep.
      const { error: claimError } = await this.client
        .from('leads')
        .update({ owner_rep_id: this.rep.id })
        .eq('id', leadId)
      if (claimError) throw claimError
    }
    // BUG-15: Allow logging sends regardless of locked status. The message insert
    // succeeds; the status update below is a no-op for locked leads (0-row update).
    if (leadRow.locked_until && new Date(leadRow.locked_until as string).getTime() > Date.now()) {
      throw new Error('This lead is connection-locked. Wait for it to unlock before sending another outreach.')
    }

    const insertPayload: Record<string, unknown> = {
      organization_id: this.orgId,
      lead_id: leadId,
      rep_id: this.rep.id,
      type,
      sent_text: sentText,
      sent_at: new Date().toISOString(),
      original_draft: feedback?.originalDraft ?? null,
      send_disposition: feedback?.sendDisposition ?? null,
      reject_reasons: feedback?.rejectReasons ?? [],
      direction: 'outbound',
    }
    if (idempotencyKey) insertPayload.idempotency_key = idempotencyKey

    const { data: inserted, error: insertError } = await insertMessageReturningId(this.client, insertPayload)
    if (insertError && idempotencyKey && (insertError as { code?: string }).code === '23505') {
      // TRUE concurrent duplicate: the pre-check above (SELECT before
      // INSERT) cannot see an in-flight, not-yet-committed insert from a
      // simultaneous request — that's exactly what a real double-click or
      // network-level retry looks like, not a sequenced pair. The unique
      // index (messages_org_idempotency_key_idx) is what actually
      // guarantees exactly-once; losing this race is the CORRECT outcome,
      // not an error — fetch the row the other request just committed and
      // return it exactly like the pre-check path does, rather than
      // surfacing a raw constraint-violation failure to the caller.
      const { data: winner } = await this.client
        .from('messages')
        .select('id')
        .eq('organization_id', this.orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (winner) {
        const todaySendsNow = await this.countTodaysSends(type)
        return { allowed: true, todaySends: todaySendsNow, limit: messageTypeLimit(type), messageId: winner.id as string, idempotent: true }
      }
    }
    if (insertError && type === 'connection' && (insertError as { code?: string }).code === '23505') {
      const { data: winner } = await this.client
        .from('messages')
        .select('id')
        .eq('organization_id', this.orgId)
        .eq('lead_id', leadId)
        .eq('type', 'connection')
        .order('sent_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (winner) {
        const todaySendsNow = await this.countTodaysSends(type)
        return { allowed: true, todaySends: todaySendsNow, limit: messageTypeLimit(type), messageId: winner.id as string, idempotent: true }
      }
    }
    if (insertError) throw insertError
    if (!inserted) throw new Error('Failed to log the send.')

    // type 'reply' here is the REP answering the client (client replies go
    // through recordProspectReply). The lead stays 'replied' — it is a live
    // conversation — but no 'replied' outcome is created: that outcome means
    // the client responded, and logging our own answer must not inflate it.
    const leadStatus = type === 'reply' ? 'replied' : type === 'followup' ? 'followed_up' : 'contacted'
    // Auto-restore on reply: a reply means the lead is active again and must
    // return to the live dashboard automatically, even if it had been swept
    // into archive (all 3 follow-ups used + 3+ quiet days). Harmless no-op
    // for a lead that was never archived.
    const updatePayload: Record<string, unknown> = { status: leadStatus }
    if (type === 'reply') {
      updatePayload.archived = false
      updatePayload.archived_at = null
    }
    const isLocked = leadRow.status === 'no' || leadRow.status === 'dead'
    // BUG-15: For locked leads, skip the status update — the message insert above
    // already succeeded. Only update status for non-locked leads.
    if (!isLocked) {
      const { error: updateError } = await this.client
        .from('leads')
        .update(updatePayload)
        .eq('id', leadId)
        .eq('owner_rep_id', this.rep.id)
        .select('id')
      if (updateError && !isOptionalSearchError(updateError)) {
        console.warn(`[markContacted] Status update failed for ${leadId}:`, updateError.message)
      }
    }

    // Connection-pacing lock: when a connection note is sent on a good-profile
    // lead, lock the lead from further outreach for 6 working hours. The lead
    // resurfaces at unlock as a "Send connection message" priority task.
    if (type === 'connection' && leadRow.verdict === 'send') {
      try {
        const lockedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        await this.client
          .from('leads')
          .update({ locked_until: lockedUntil, locked_reason: 'connection_note_sent' })
          .eq('id', leadId)
          .eq('owner_rep_id', this.rep.id)
      } catch {
        // Non-fatal: lock must not block the send
      }
    }

    try {
      const convState = await this.getConversationState(leadId)
      await this.upsertConversationState({
        leadId,
        // Our reply keeps the conversation at whatever stage it reached.
        stage: type === 'reply' ? (convState?.stage ?? 'replied') : 'contacted',
        followupCount: type === 'followup' ? (convState?.followupCount ?? 0) + 1 : (convState?.followupCount ?? 0),
        lastSentAt: new Date().toISOString(),
        lastSentMessageId: inserted.id as string,
      })
    } catch {
      // Non-fatal: conversation state must not block the send
    }

    // Transition outbound run: awaiting_human -> action_recorded -> waiting
    // Only for outbound sends (not replies). Non-fatal.
    let runId: string | null = null
    if (type !== 'reply') {
      try {
        const runs = await this.listActiveRunsForEntity('lead', leadId)
        const run = runs.find((r) => r.status === 'awaiting_human' || r.status === 'action_recorded')
        if (run) {
          runId = run.id
          // Idempotency: only transition if actually at awaiting_human or action_recorded
          if (run.status === 'awaiting_human') {
            const toActionRecorded = await this.transitionRelayRun({
              runId: run.id,
              newStatus: 'action_recorded',
              metadata: { messageType: type, sentTextLength: sentText.length },
            })
            if (toActionRecorded) {
              await this.transitionRelayRun({
                runId: run.id,
                newStatus: 'waiting',
                metadata: { transitionedBy: 'markContacted' },
              })
            }
          } else if (run.status === 'action_recorded') {
            await this.transitionRelayRun({
              runId: run.id,
              newStatus: 'waiting',
              metadata: { transitionedBy: 'markContacted' },
            })
          }
        }
      } catch {
        // Run transition must never block the send
      }
    }

    // Emit OUTREACH_RECORDED event (non-fatal)
    try {
      await this.emitRelayEvent({
        eventType: 'OUTREACH_RECORDED',
        entityType: 'lead',
        entityId: leadId,
        actorType: 'rep',
        actorId: this.rep.id,
        relayRunId: runId,
        payload: {
          messageType: type,
          sentTextLength: sentText.length,
          sendDisposition: feedback?.sendDisposition ?? null,
          rejectReasons: feedback?.rejectReasons ?? [],
        },
        source: 'app',
        // Deliberately NOT Date.now()-suffixed: emit_relay_event's DB-level
        // dedup (relay_events unique on organization_id+source+source_event_id)
        // only works if the same logical send produces the same
        // sourceEventId on a retry. Prefer the caller-supplied idempotency
        // key (stable across retries); fall back to the inserted message's
        // own id (also stable — a retry that hit the messages-table
        // idempotency check above returns the SAME message id, not a new
        // row) rather than a timestamp, which would make every call unique
        // and defeat the dedup entirely.
        sourceEventId: `outreach_recorded:${leadId}:${idempotencyKey ?? inserted.id}`,
      })
    } catch {
      // Event emission must never break domain operations
    }

    // Emit Action Ledger event (non-fatal)
    try {
      const actionType = type === 'connection' ? 'CONNECTION_SENT'
        : type === 'dm' ? 'DM_SENT'
        : type === 'followup' ? 'FOLLOWUP_SENT'
        : type === 'reply' ? 'REPLY_SENT'
        : null
      if (actionType && inserted?.id) {
        await emitAction({
          orgId: this.orgId,
          actionType: actionType as 'CONNECTION_SENT' | 'DM_SENT' | 'FOLLOWUP_SENT' | 'REPLY_SENT',
          actorType: 'rep',
          actorId: this.rep.id,
          leadId,
          senderProfileId: leadRow.sender_profile_id ?? null,
          messageId: inserted.id as string,
          executionStatus: 'sent',
          metadata: { messageType: type },
          idempotencyKey: `${actionType}:${inserted.id}`,
        })
      }
    } catch {
      // Action ledger must never break domain operations
    }

    // Record accountability increment (non-fatal, only for outbound activity)
    // Finds all active targets for this rep+activity and increments each.
    if (type !== 'reply') {
      try {
        const activityType = type === 'connection' ? 'connection_request' : type
        const { data: targets } = await this.client
          .from('daily_targets')
          .select('revenue_identity_id')
          .eq('rep_id', this.rep.id)
          .eq('activity_type', activityType)
          .eq('active', true)
        if (targets && targets.length > 0) {
          for (const t of targets) {
            try {
              await this.client.rpc('record_activity_event', {
                p_rep_id: this.rep.id,
                p_identity_id: t.revenue_identity_id as string,
                p_activity_type: activityType,
                p_org_id: this.orgId,
                p_source_event_id: `activity:${leadId}:${idempotencyKey ?? 'none'}:${t.revenue_identity_id}`,
              })
            } catch {
              // Non-fatal per-target
            }
          }

          // Bridge: canonical progress for Accountability OS (day_closes)
          // Maps messageType → metric key. Exactly-once via source_event_id.
          try {
            const metricKeyMap: Record<string, string> = {
              connection: 'connections',
              dm: 'firstDms',
              followup: 'followups',
              email: 'emails',
            }
            const metricKey = metricKeyMap[type] ?? null
            if (metricKey) {
              const sourceEventId = `canonical:${leadId}:${idempotencyKey ?? 'none'}`
              for (const t of targets) {
                try {
                  await this.client.rpc('record_canonical_progress', {
                    p_org_id: this.orgId,
                    p_person_id: this.rep.id,
                    p_revenue_identity_id: t.revenue_identity_id as string,
                    p_event_type: 'OUTREACH_RECORDED',
                    p_metric_key: metricKey,
                    p_source_event_id: sourceEventId,
                    p_date: new Date().toISOString().slice(0, 10),
                  })
                } catch {
                  // Non-fatal per-target
                }
              }
            }
          } catch {
            // Progress bridge must never break the send
          }
        }
      } catch {
        // Accountability increment must never block the send
      }
    }

    return { allowed: true, todaySends: todaySends + 1, limit, messageId: inserted.id as string }
  }

  /**
   * Explicit rep confirmation that a LinkedIn connection request was
   * accepted — never inferred. Gates DM eligibility in the lead workspace
   * (a DM sent before a connection is accepted is generally not delivered
   * or is out of sequence). Org/owner-scoped like other lead mutations;
   * idempotent (setting it again just updates the timestamp).
   */
  async markConnectionAccepted(leadId: string): Promise<void> {
    // Claim unowned leads first (NULL owner_rep_id) so the update matches.
    const { data: leadRow } = await this.client
      .from('leads')
      .select('owner_rep_id, status')
      .eq('id', leadId)
      .maybeSingle()
    if (!leadRow) throw new Error('Lead not found.')
    if ((leadRow as { owner_rep_id: string | null }).owner_rep_id === null) {
      await this.client
        .from('leads')
        .update({ owner_rep_id: this.rep.id })
        .eq('id', leadId)
    }
    const { data: updatedRows, error } = await this.client
      .from('leads')
      .update({
        connection_accepted_at: new Date().toISOString(),
        // BUG-08: clear the connection pacing lock so the rep can send the
        // first DM immediately after acceptance — the 6h lock was designed to
        // prevent rapid re-sending of connection notes, not to block the DM
        // that the UI is explicitly asking for after acceptance.
        locked_until: null,
        locked_reason: null,
      })
      .eq('id', leadId)
      .eq('owner_rep_id', this.rep.id)
      .neq('status', 'no')
      .neq('status', 'dead')
      .select('id')
    if (error) {
      if (isOptionalSearchError(error)) return
      throw error
    }
    if (!updatedRows || updatedRows.length === 0) {
      throw new Error('This lead is locked (status: no/dead).')
    }
  }

  async recordProspectReply(leadId: string, replyText: string, options?: { receivedAt?: string | null }): Promise<Message> {
    const { data: leadRow, error: leadError } = await this.client
      .from('leads')
      .select('id, status, sender_profile_id')
      .eq('id', leadId)
      .eq('owner_rep_id', this.rep.id)
      .maybeSingle()
    if (leadError) throw leadError
    if (!leadRow) throw new Error('You are not the owner of this lead.')
    if (leadRow.status === 'no' || leadRow.status === 'dead') {
      throw new Error('This lead is locked.')
    }

    // When the rep knows when the client actually wrote (pasted later),
    // keep that time so the thread orders correctly. Never in the future.
    const nowMs = Date.now()
    const received = options?.receivedAt ? new Date(options.receivedAt).getTime() : NaN
    const now = new Date(Number.isFinite(received) && received <= nowMs ? received : nowMs).toISOString()
    const replyPayload: Record<string, unknown> = {
      organization_id: this.orgId,
      lead_id: leadId,
      rep_id: this.rep.id,
      type: 'reply',
      sent_text: replyText,
      sent_at: now,
      direction: 'inbound',
    }
    const { data: inserted, error: insertError } = await insertMessageReturningId(this.client, replyPayload)
    if (insertError) throw insertError
    if (!inserted) throw new Error('Failed to record the reply.')

    try {
      // Auto-restore on reply: see markContacted's identical handling for
      // why (a reply must bring an archived lead back to the live board).
      await this.client
        .from('leads')
        .update({ status: 'replied', archived: false, archived_at: null })
        .eq('id', leadId)
        .eq('owner_rep_id', this.rep.id)
    } catch {
    }

    try {
      await this.client
        .from('outcomes')
        .insert({ organization_id: this.orgId, lead_id: leadId, stage: 'replied', occurred_at: now })
    } catch {
    }

    try {
      await this.upsertConversationState({ leadId, stage: 'replied', lastReplyAt: now })
    } catch {
    }

    try {
      await this.emitRelayEvent({
        eventType: 'CLIENT_REPLIED',
        entityType: 'lead',
        entityId: leadId,
        actorType: 'rep',
        actorId: this.rep.id,
        payload: { direction: 'inbound', messageType: 'reply' },
        source: 'app',
        sourceEventId: `prospect_reply:${leadId}:${inserted.id}`,
      })
    } catch {
    }

    try {
      await emitAction({
        orgId: this.orgId,
        actionType: 'REPLY_RECEIVED',
        actorType: 'rep',
        actorId: this.rep.id,
        leadId,
        senderProfileId: leadRow.sender_profile_id ?? null,
        messageId: inserted.id as string,
        executionStatus: 'delivered',
        metadata: { direction: 'inbound', source: 'paste' },
        idempotencyKey: `reply_received:${inserted.id}`,
      })
    } catch {
      // Action ledger must never break domain operations
    }

    return { id: inserted.id as string, organizationId: this.orgId, leadId, repId: this.rep.id, type: 'reply', draftText: null, sentText: replyText, sentAt: now, modelUsed: null, direction: 'inbound', createdAt: now }
  }

  async unlockLead(leadId: string): Promise<void> {
    await this.client
      .from('leads')
      .update({ locked_until: null, locked_reason: null })
      .eq('id', leadId)
      .eq('organization_id', this.orgId)
  }

  async getVoiceProfile(profileId?: string): Promise<VoiceProfile | null> {
    // Profile-specific voice takes precedence; fall back to rep default
    if (profileId) {
      const { data: profileData, error: profileError } = await this.client
        .from('voice_profiles')
        .select('*')
        .eq('rep_id', this.rep.id)
        .eq('profile_id', profileId)
        .maybeSingle()
      if (profileError) throw profileError
      if (profileData) {
        const r = profileData as Row & { profile_id?: string | null }
        return {
          id: r.id as string,
          repId: r.rep_id as string,
          organizationId: r.organization_id as string,
          profileId: r.profile_id ?? null,
          styleCard: r.style_card as VoiceProfile['styleCard'],
          sampleSource: r.sample_source as VoiceProfile['sampleSource'],
          calibratedAt: r.calibrated_at as string,
        }
      }
    }

    const { data, error } = await this.client
      .from('voice_profiles')
      .select('*')
      .eq('rep_id', this.rep.id)
      .is('profile_id', null)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const r = data as Row
    return {
      id: r.id as string,
      repId: r.rep_id as string,
      organizationId: r.organization_id as string,
      styleCard: r.style_card as VoiceProfile['styleCard'],
      sampleSource: r.sample_source as VoiceProfile['sampleSource'],
      calibratedAt: r.calibrated_at as string,
    }
  }

  async setVoiceProfile(
    styleCard: VoiceProfile['styleCard'],
    sampleSource: VoiceProfile['sampleSource'],
    profileId?: string,
  ): Promise<VoiceProfile> {
    const { data, error } = await this.client
      .from('voice_profiles')
      .upsert(
        {
          rep_id: this.rep.id,
          organization_id: this.orgId,
          profile_id: profileId ?? null,
          style_card: JSON.parse(JSON.stringify(styleCard)),
          sample_source: sampleSource,
          calibrated_at: new Date().toISOString(),
        },
        { onConflict: profileId ? 'rep_id, profile_id' : 'rep_id', ignoreDuplicates: false },
      )
      .select('*')
      .single()
    if (error) throw error
    const r = data as Row & { profile_id?: string | null }
    return {
      id: r.id as string,
      repId: r.rep_id as string,
      organizationId: r.organization_id as string,
      profileId: r.profile_id ?? null,
      styleCard: r.style_card as VoiceProfile['styleCard'],
      sampleSource: r.sample_source as VoiceProfile['sampleSource'],
      calibratedAt: r.calibrated_at as string,
    }
  }

  async listFacts(): Promise<Fact[]> {
    const { data, error } = await this.client
      .from('facts')
      .select('*')
      .eq('organization_id', this.orgId)
      .order('label', { ascending: true })
    if (error) throw error
    return (data ?? []).map(mapFact)
  }

  async upsertFact(input: {
    id?: string
    label: string
    value: string
    factType?: string | null
  }): Promise<Fact> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const row = input.id
      ? await this.client
          .from('facts')
          .update({
            label: input.label,
            value: input.value,
            fact_type: input.factType ?? null,
          })
          .eq('id', input.id)
          .select('*')
          .single()
      : await this.client
          .from('facts')
          .insert({
            organization_id: this.orgId,
            label: input.label,
            value: input.value,
            fact_type: input.factType ?? null,
            added_by: this.rep.id,
          })
          .select('*')
          .single()
    if (row.error) throw row.error
    return mapFact(row.data as Row)
  }

  async deleteFact(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client.from('facts').delete().eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
  }

  async listPlays(): Promise<Play[]> {
    const { data, error } = await this.client.from('plays').select('*').eq('organization_id', this.orgId)
    if (error) throw error
    return (data ?? []).map(mapPlay)
  }

  async createPlay(input: {
    name: string
    situation: string
    templateShape: string
  }): Promise<Play> {
    const { data, error } = await this.client
      .from('plays')
      .insert({
        organization_id: this.orgId,
        name: input.name,
        situation: input.situation,
        template_shape: input.templateShape,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapPlay(data as Row)
  }

  async deletePlay(id: string): Promise<void> {
    const { error } = await this.client.from('plays').delete().eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
  }

  async listAllReps(): Promise<Rep[]> {
    const { data, error } = await this.client
      .from('reps')
      .select('id, name, role, organization_id, created_at, timezone')
      .eq('organization_id', this.orgId)
      .order('name', { ascending: true })
    if (error) throw error
    return (data ?? []).map((row: Row) => ({
      id: row.id as string,
      name: row.name as string,
      role: row.role as Rep['role'],
      organizationId: row.organization_id as string,
      createdAt: row.created_at as string,
      timezone: (row.timezone as string) ?? 'UTC',
    }))
  }

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('rep_id', this.rep.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(mapProfile)
  }

  async getProfile(id: string): Promise<Profile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data || (data as Row).rep_id !== this.rep.id) return null
    return mapProfile(data as Row)
  }

  async upsertProfile(input: {
    id?: string
    platform: 'linkedin' | 'upwork'
    label?: string | null
    profileUrl?: string | null
    headline?: string | null
    cvPath?: string | null
  }): Promise<Profile> {
    const row = input.id
      ? await this.client
          .from('profiles')
          .update({
            platform: input.platform,
            label: input.label ?? null,
            profile_url: input.profileUrl ?? null,
            headline: input.headline ?? null,
            cv_path: input.cvPath ?? null,
          })
          .eq('id', input.id)
          .eq('rep_id', this.rep.id)
          .select('*')
          .single()
      : await this.client
          .from('profiles')
          .insert({
            organization_id: this.orgId,
            rep_id: this.rep.id,
            platform: input.platform,
            label: input.label ?? null,
            profile_url: input.profileUrl ?? null,
            headline: input.headline ?? null,
            cv_path: input.cvPath ?? null,
          })
          .select('*')
          .single()
    if (row.error) throw row.error
    return mapProfile(row.data as Row)
  }

  async deleteProfile(id: string): Promise<void> {
    const profile = await this.getProfile(id)
    if (profile?.cvPath) {
      await this.client.storage.from('proof-cvs').remove([profile.cvPath])
    }
    const { error } = await this.client
      .from('profiles')
      .delete()
      .eq('id', id)
      .eq('rep_id', this.rep.id)
    if (error) throw error
  }

  async listAllProfiles(): Promise<Profile[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('organization_id', this.orgId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(mapProfile)
  }

  async upsertProfileAdmin(input: {
    id?: string
    repId: string
    platform: 'linkedin' | 'upwork'
    label?: string | null
    profileUrl?: string | null
    headline?: string | null
    cvPath?: string | null
  }): Promise<Profile> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const row = input.id
      ? await this.client
          .from('profiles')
          .update({
            platform: input.platform,
            label: input.label ?? null,
            profile_url: input.profileUrl ?? null,
            headline: input.headline ?? null,
            cv_path: input.cvPath ?? null,
          })
          .eq('id', input.id)
          .select('*')
          .single()
      : await this.client
          .from('profiles')
          .insert({
            organization_id: this.orgId,
            rep_id: input.repId,
            platform: input.platform,
            label: input.label ?? null,
            profile_url: input.profileUrl ?? null,
            headline: input.headline ?? null,
            cv_path: input.cvPath ?? null,
          })
          .select('*')
          .single()
    if (row.error) throw row.error
    return mapProfile(row.data as Row)
  }

  async deleteProfileAdmin(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    const cvPath = (data as Row | null)?.cv_path as string | undefined
    if (cvPath) {
      await this.client.storage.from('proof-cvs').remove([cvPath])
    }
    const { error } = await this.client.from('profiles').delete().eq('id', id)
    if (error) throw error
  }

  async listProofItems(profileId: string): Promise<ProofItem[]> {
    const { data, error } = await this.client
      .from('proof_items')
      .select('*')
      .eq('profile_id', profileId)
    if (error) throw error
    return (data ?? []).map(mapProofItem)
  }

  async listProofItemsAdmin(profileId: string): Promise<ProofItem[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('proof_items')
      .select('*')
      .eq('profile_id', profileId)
    if (error) throw error
    return (data ?? []).map(mapProofItemUnredacted)
  }

  async listAllProofItems(): Promise<ProofItem[]> {
    const { data, error } = await this.client
      .from('proof_items')
      .select('*')
      .eq('organization_id', this.orgId)
    if (error) throw error
    return (data ?? []).map(mapProofItem)
  }

  async listConversationSnapshots(leadIds: string[]): Promise<Map<string, { messages: Message[]; followupCount: number; memoryStage: string | null }>> {
    const out = new Map<string, { messages: Message[]; followupCount: number; memoryStage: string | null }>()
    if (leadIds.length === 0) return out
    for (const id of leadIds) out.set(id, { messages: [], followupCount: 0, memoryStage: null })
    const chunks: string[][] = []
    for (let i = 0; i < leadIds.length; i += 200) chunks.push(leadIds.slice(i, i + 200))
    for (const chunk of chunks) {
      const [msgs, states] = await Promise.all([
        this.client
          .from('messages')
          .select('*')
          .eq('organization_id', this.orgId)
          .in('lead_id', chunk)
          .not('sent_at', 'is', null)
          .order('sent_at', { ascending: true }),
        this.client
          .from('conversation_states')
          .select('*')
          .eq('organization_id', this.orgId)
          .in('lead_id', chunk),
      ])
      if (msgs.error) throw msgs.error
      for (const row of (msgs.data ?? []) as Row[]) {
        out.get(row.lead_id as string)?.messages.push(mapMessage(row))
      }
      for (const row of (states.data ?? []) as Row[]) {
        const entry = out.get(row.lead_id as string)
        if (!entry) continue
        entry.followupCount = (row.followup_count as number) ?? 0
        const memory = row.memory as { stage?: string } | null
        entry.memoryStage = memory?.stage ?? null
      }
    }
    return out
  }

  async listMessages(leadId: string): Promise<Message[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapMessage)
  }

  async upsertProofItem(input: {
    id?: string
    profileId: string
    clientNamed?: boolean
    clientName?: string | null
    permissionOnFile?: boolean
    projectSummary: string
    reviewQuote?: string | null
    tags?: string[]
    embedding?: number[] | null
  }): Promise<ProofItem> {
    const permission = Boolean(input.permissionOnFile)
    // The client name is only stored if permission is on file.
    const clientName = permission ? (input.clientName ?? null) : null
    const row = input.id
      ? await this.client
          .from('proof_items')
          .update({
            client_named: Boolean(input.clientNamed),
            permission_on_file: permission,
            client_name: clientName,
            project_summary: input.projectSummary,
            review_quote: input.reviewQuote ?? null,
            tags: input.tags ?? [],
            embedding: input.embedding ?? null,
          })
          .eq('id', input.id)
          .eq('profile_id', input.profileId)
          .select('*')
          .single()
       : await this.client
          .from('proof_items')
          .insert({
            organization_id: this.orgId,
            profile_id: input.profileId,
            client_named: Boolean(input.clientNamed),
            permission_on_file: permission,
            client_name: clientName,
            project_summary: input.projectSummary,
            review_quote: input.reviewQuote ?? null,
            tags: input.tags ?? [],
            embedding: input.embedding ?? null,
          })
          .select('*')
          .single()
    if (row.error) throw row.error
    return mapProofItem(row.data as Row)
  }

  async deleteProofItem(id: string): Promise<void> {
    const { error } = await this.client
      .from('proof_items')
      .delete()
      .eq('id', id)
      .eq('organization_id', this.orgId)
    if (error) throw error
  }

  async upsertProofItemAdmin(input: {
    id?: string
    profileId: string
    clientNamed?: boolean
    clientName?: string | null
    permissionOnFile?: boolean
    projectSummary: string
    reviewQuote?: string | null
    tags?: string[]
    embedding?: number[] | null
  }): Promise<ProofItem> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const permission = Boolean(input.permissionOnFile)
    const clientName = permission ? (input.clientName ?? null) : null
    const row = input.id
      ? await this.client
          .from('proof_items')
          .update({
            client_named: Boolean(input.clientNamed),
            permission_on_file: permission,
            client_name: clientName,
            project_summary: input.projectSummary,
            review_quote: input.reviewQuote ?? null,
            tags: input.tags ?? [],
            embedding: input.embedding ?? null,
          })
          .eq('id', input.id)
          .select('*')
          .single()
       : await this.client
          .from('proof_items')
          .insert({
            organization_id: this.orgId,
            profile_id: input.profileId,
            client_named: Boolean(input.clientNamed),
            permission_on_file: permission,
            client_name: clientName,
            project_summary: input.projectSummary,
            review_quote: input.reviewQuote ?? null,
            tags: input.tags ?? [],
            embedding: input.embedding ?? null,
          })
          .select('*')
          .single()
    if (row.error) throw row.error
    return mapProofItemUnredacted(row.data as Row)
  }

  async deleteProofItemAdmin(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client.from('proof_items').delete().eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
  }

  async matchProofItems(tags: string[], limit = 2, profileId: string | null = null): Promise<ProofItem[]> {
    if (!profileId) return []
    const profiles = (await this.listProfiles()).filter((p) => p.id === profileId)
    if (profiles.length === 0) return []
    const items = (
      await Promise.all(profiles.map((p) => this.listProofItems(p.id)))
    ).flat()
    return matchProofItemsByTags(items, tags, limit)
  }

  /**
   * Contacted leads five working days past their last send with no reply,
   * eligible for their next follow-up. UP TO THREE follow-ups ever (raised
   * from a 1-follow-up cap — approved product design change, see
   * src/lib/relay/followup-engine.ts): a lead is excluded here only once
   * followupCount reaches 3, not merely because status is 'followed_up'
   * (that status just means "at least one follow-up sent", it is no longer
   * a terminal state on its own).
   */
  private async fetchFollowupsDue(): Promise<FollowupDue[]> {
    const owned = await this.listOwnedLeads()
    // 'followed_up' must stay eligible here too, not just 'contacted' — with
    // the 3-follow-up cap, a lead sits at status 'followed_up' after its
    // 1st AND 2nd follow-up (markContacted sets this status on every
    // followup send, not just the first) while still being eligible for
    // more, up to followupCount >= 3 below. Excluding 'followed_up' here
    // would silently cap every lead at exactly one follow-up regardless of
    // the followupCount check.
    const contacted = owned.filter((l) => l.status === 'contacted' || l.status === 'followed_up')
    if (contacted.length === 0) return []

    const leadIds = contacted.map((l) => l.id)
    const [{ data: msgRows, error: msgErr }, { data: outcomeRows, error: outcomeErr }] = await Promise.all([
      this.client
        .from('messages')
        .select('lead_id, sent_at')
        .in('lead_id', leadIds)
        .not('sent_at', 'is', null),
      this.client.from('outcomes').select('lead_id').in('lead_id', leadIds).eq('stage', 'replied'),
    ])
    if (msgErr) throw msgErr
    if (outcomeErr) throw outcomeErr

    const repliedLeadIds = new Set((outcomeRows ?? []).map((r) => r.lead_id as string))
    const lastSentByLead = new Map<string, string>()
    for (const row of (msgRows ?? []) as Array<{ lead_id: string; sent_at: string }>) {
      const existing = lastSentByLead.get(row.lead_id)
      if (!existing || row.sent_at > existing) lastSentByLead.set(row.lead_id, row.sent_at)
    }

    // Bulk-fetch conversation states to avoid N+1
    const { data: convStates } = await this.client
      .from('conversation_states')
      .select('lead_id, followup_count')
      .in('lead_id', leadIds)
    const followupCountByLead = new Map<string, number>()
    for (const row of (convStates ?? []) as Array<{ lead_id: string; followup_count: number }>) {
      followupCountByLead.set(row.lead_id, row.followup_count)
    }

    const now = new Date()
    const due: FollowupDue[] = []
    for (const lead of contacted) {
      if (repliedLeadIds.has(lead.id)) continue
      const lastSent = lastSentByLead.get(lead.id)
      if (!lastSent) continue
      const followupCount = followupCountByLead.get(lead.id) ?? 0
      if (followupCount >= 3) continue
      const daysSinceContact = calendarDaysBetween(new Date(lastSent), now)
      if (daysSinceContact >= followupDueInDays(followupCount)) {
        due.push({ lead, daysSinceContact })
      }
    }
    return due.sort((a, b) => b.daysSinceContact - a.daysSinceContact)
  }

  private async fetchMyRank(): Promise<MyRank> {
    const stats = await this.getTeamStats()
    const mineRow = stats.perRep.find((r) => r.rep.id === this.rep.id)
    const withSends = stats.perRep.filter((r) => r.sent > 0 && r.replyRate !== null)
    const ranked = [...withSends].sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0))
    const position = mineRow && mineRow.sent > 0 ? ranked.findIndex((r) => r.rep.id === this.rep.id) + 1 : null
    return {
      mine: mineRow ?? null,
      teamAverage: stats.overall,
      position: position && position > 0 ? position : null,
      ofTotal: ranked.length,
    }
  }

  private async fetchUpworkSnapshot(): Promise<UpworkSnapshot> {
    const [jobs, todayApplies] = await Promise.all([
      this.listUpworkJobs(),
      this.countTodaysUpworkApplies(),
    ])
    const queue = jobs
      .filter((j) => j.status === 'new' || j.status === 'drafted')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    return { queue, todayApplies }
  }

  async getTodayDashboard(): Promise<TodayDashboard> {
    const [mine, buckets, dmFollowupSent, connectionSent, upworkApplies, notifications, followupsDue, myRank, upwork] =
      await Promise.all([
        this.getQueue(),
        this.fetchRates(),
        this.countTodaysSendsByTypes(['dm', 'followup']),
        this.countTodaysSendsByTypes(['connection']),
        this.countTodaysUpworkApplies(),
        this.listNotifications(),
        this.fetchFollowupsDue(),
        this.fetchMyRank(),
        this.fetchUpworkSnapshot(),
      ])
    const team = computeRates(buckets)
    const sendBudgets: SendBudget[] = [
      {
        label: 'DM & follow-up',
        types: ['dm', 'followup'],
        used: dmFollowupSent,
        limit: dailySendLimit(),
      },
      {
        label: 'Connection & Upwork',
        types: ['connection', 'upwork'],
        used: connectionSent + upworkApplies,
        limit: dailyConnectionSendLimit(),
      },
    ]
    return { mine, team, sendBudgets, notifications, followupsDue, myRank, upwork }
  }

  async getTeamStats(): Promise<TeamStats> {
    const [buckets, reps] = await Promise.all([
      this.fetchRates(),
      this.client
        .from('reps')
        .select('id, name, role, organization_id, created_at, timezone')
        .then((r) => {
          if (r.error) throw r.error
          return (r.data ?? []).map((row: Row) => ({
            id: row.id as string,
            name: row.name as string,
            role: row.role as Rep['role'],
            organizationId: row.organization_id as string,
            createdAt: row.created_at as string,
            timezone: (row.timezone as string) ?? 'UTC',
          }))
        }),
    ])

    const overall = computeRates(buckets)
    const perRep = reps
      .filter((r) => r.role !== 'sourcer')
      .map((rep) => ({
        rep,
        ...computeRates(
          buckets.filter((b) => b.lead.ownerRepId === rep.id),
        ),
      }))
      .filter((row) => row.sent > 0 || row.replyRate !== null)

    const plays = await this.listPlays()
    const playGroups = new Map<string, RateBucket[]>()
    for (const b of buckets) {
      const key = b.lead.playId ?? ''
      if (!playGroups.has(key)) playGroups.set(key, [])
      playGroups.get(key)!.push(b)
    }
    const perPlay = [...playGroups.entries()]
      .map(([key, group]) => ({
        play: key ? (plays.find((p) => p.id === key) ?? null) : null,
        ...computeRates(group),
      }))
      .filter((row) => row.sent > 0 || row.replyRate !== null)
      .sort((a, b) => {
        const an = a.play?.name ?? 'No play'
        const bn = b.play?.name ?? 'No play'
        return an.localeCompare(bn)
      })

    return { overall, perRep, perPlay }
  }

  async logExtractionRun(input: ModelCallLogInput): Promise<void> {
    const { error } = await this.client.from('extraction_runs').insert({
      organization_id: this.orgId,
      rep_id: this.rep.id,
      task: input.task,
      success: input.success,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      model: input.model,
      cost_tier: input.costTier ?? null,
      host: input.host ?? null,
      cost_usd: input.costUsd ?? null,
      error_message: input.error ?? null,
    })
    if (error) throw error
  }

  async logHostCall(input: HostCallInput): Promise<void> {
    const { error } = await this.client.from('host_calls').insert({
      organization_id: this.orgId,
      task: input.task,
      host: input.host,
      model: input.model ?? '',
      cost_tier: input.costTier ?? null,
      success: input.success,
      failure_reason: input.success ? null : (input.failureReason ?? 'other'),
      error_message: input.errorMessage ?? '',
      latency_ms: input.latencyMs ?? null,
    })
    if (error) throw error
  }

  async getExtractionMetrics(): Promise<ExtractionMetrics> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await this.client
      .from('extraction_runs')
      .select('success, latency_ms, created_at, cost_tier, cost_usd')
      .gte('created_at', since)

    const emptyCostByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }
    const emptyRequestsByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }
    const emptyMetrics: ExtractionMetrics = {
      total: 0,
      failures: 0,
      failureRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      costByTier: emptyCostByTier,
      totalCostUsd: 0,
      requestsByTier: emptyRequestsByTier,
    }
    if (error) {
      const code = (error as { code?: string }).code ?? ''
      const message = (error as { message?: string }).message ?? ''
      const schemaGap =
        code === '42P01' ||
        code === '42703' ||
        code === '42501' ||
        /could not find the table|column .* does not exist|permission denied|forbidden|not found in the schema cache/i.test(
          message,
        )
      if (schemaGap) {
        return emptyMetrics
      }
      throw error
    }
    const rows = (data ?? []) as Array<{
      success: boolean
      latency_ms: number | null
      cost_tier: string | null
      cost_usd: number | null
    }>
    const total = rows.length
    const failures = rows.filter((r) => !r.success).length
    const failureRate = total > 0 ? failures / total : 0
    const latencies = rows
      .map((r) => Number(r.latency_ms ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b)
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, n) => sum + n, 0) / latencies.length)
        : 0
    const p95LatencyMs =
      latencies.length > 0
        ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
        : 0
    const costByTier = { ...emptyCostByTier }
    const requestsByTier = { ...emptyRequestsByTier }
    for (const r of rows) {
      if (r.cost_tier && r.cost_tier in costByTier) {
        costByTier[r.cost_tier as keyof typeof costByTier] += Number(r.cost_usd ?? 0)
        requestsByTier[r.cost_tier as keyof typeof requestsByTier] += 1
      }
    }
    const totalCostUsd = Object.values(costByTier).reduce((sum, n) => sum + n, 0)
    return {
      total,
      failures,
      failureRate,
      costByTier,
      totalCostUsd,
      requestsByTier,
      avgLatencyMs,
      p95LatencyMs,
    }
  }

  async listAllLeadsAdmin(): Promise<Lead[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    return this.fetchLeadsAll()
  }

  // ==========================================================================
  // Semantic proof matching via pgvector
  // ==========================================================================

  async matchProofItemsByEmbedding(
    embedding: number[],
    limit = 2,
    profileId: string | null = null,
  ): Promise<Array<{ item: ProofItem; similarity: number }>> {
    if (!profileId) return []
    const { data, error } = await this.client.rpc('match_proofs_by_embedding', {
      query_embedding: embedding,
      match_threshold: 0.72,
      match_count: limit,
    })
    if (error) throw error
    const results: Array<{ item: ProofItem; similarity: number }> = (data ?? [])
      .filter((r: Row) => r.profile_id === profileId)
      .map((r: Row) => ({
        item: mapProofItem(r),
        similarity: (r.similarity as number) ?? 0,
      }))
    return results
  }

  // ==========================================================================
  // Eval harness
  // ==========================================================================

  async listGoldenSet(): Promise<import('@/lib/store/types').GoldenCaseRow[]> {
    const { data, error } = await this.client
      .from('golden_set')
      .select('*')
      .eq('organization_id', this.orgId)
      .eq('active', true)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      leadId: r.lead_id as string,
      knownReplied: Boolean(r.known_replied),
      sentText: (r.sent_text as string) ?? '',
      note: (r.note as string) ?? null,
      active: Boolean(r.active),
      createdAt: r.created_at as string,
    }))
  }

  async addGoldenCase(input: {
    leadId: string
    messageId?: string
    knownReplied: boolean
    sentText?: string
    note?: string
  }): Promise<import('@/lib/store/types').GoldenCaseRow> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('golden_set')
      .insert({
        organization_id: this.orgId,
        lead_id: input.leadId,
        message_id: input.messageId ?? null,
        known_replied: input.knownReplied,
        sent_text: input.sentText ?? null,
        note: input.note ?? null,
        active: true,
      })
      .select('*')
      .single()
    if (error) throw error
    const r = data as Row
    return {
      id: r.id as string,
      leadId: r.lead_id as string,
      knownReplied: Boolean(r.known_replied),
      sentText: (r.sent_text as string) ?? '',
      note: (r.note as string) ?? null,
      active: Boolean(r.active),
      createdAt: r.created_at as string,
    }
  }

  async removeGoldenCase(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client.from('golden_set').delete().eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
  }

  async listEvalRuns(): Promise<import('@/lib/store/types').EvalRunRow[]> {
    const { data, error } = await this.client
      .from('eval_runs')
      .select('*')
      .eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      promptVersion: r.prompt_version as string,
      goldenSetSize: r.golden_set_size as number,
      replyRateScore: r.reply_rate_score as number,
      selfCheckPassRate: r.self_check_pass_rate as number,
      companyMentionRate: r.company_mention_rate as number,
      evidenceMentionRate: r.evidence_mention_rate as number,
      overallScore: r.overall_score as number,
      details: r.details as unknown,
      createdAt: r.created_at as string,
    }))
  }

  async saveEvalRun(
    run: Omit<import('@/lib/store/types').EvalRunRow, 'id' | 'createdAt'>,
  ): Promise<import('@/lib/store/types').EvalRunRow> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('eval_runs')
      .insert({
        organization_id: this.orgId,
        prompt_version: run.promptVersion,
        golden_set_size: run.goldenSetSize,
        reply_rate_score: run.replyRateScore,
        self_check_pass_rate: run.selfCheckPassRate,
        company_mention_rate: run.companyMentionRate,
        evidence_mention_rate: run.evidenceMentionRate,
        overall_score: run.overallScore,
        details: run.details ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    const r = data as Row
    return {
      id: r.id as string,
      promptVersion: r.prompt_version as string,
      goldenSetSize: r.golden_set_size as number,
      replyRateScore: r.reply_rate_score as number,
      selfCheckPassRate: r.self_check_pass_rate as number,
      companyMentionRate: r.company_mention_rate as number,
      evidenceMentionRate: r.evidence_mention_rate as number,
      overallScore: r.overall_score as number,
      details: r.details as unknown,
      createdAt: r.created_at as string,
    }
  }

  // ==========================================================================
  // Few-shot wins
  // ==========================================================================

  async listFewShotWins(limit = 100): Promise<import('@/lib/store/types').FewShotWin[]> {
    const { data, error } = await this.client
      .from('few_shot_wins')
      .select('*')
      .eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      messageId: r.message_id as string,
      leadId: r.lead_id as string,
      playId: (r.play_id as string) ?? null,
      signalType: (r.signal_type as number) ?? null,
      sentText: r.sent_text as string,
      company: r.company as string,
      signalEvidence: (r.signal_evidence as string) ?? null,
      tags: (r.tags as string[]) ?? [],
      createdAt: r.created_at as string,
    }))
  }

  async refreshFewShotWins(): Promise<number> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client.rpc('refresh_few_shot_wins', {
      p_org_id: this.rep.organizationId,
    })
    if (error) throw error
    return (data as number) ?? 0
  }

  // ==========================================================================
  // Upwork jobs
  // ==========================================================================

  async createUpworkJob(input: {
    title: string
    description: string
    budgetMin?: number | null
    budgetMax?: number | null
    hourlyRateMin?: number | null
    hourlyRateMax?: number | null
    proposalCount?: number | null
    connectsCost?: number
    requiredSkills?: string[]
    urgencySignal?: string | null
    rawInput?: string | null
    tags?: string[]
    screeningQuestions?: string[]
    applicationRequirements?: string[]
    engagementType?: string | null
    weeklyHours?: string | null
    duration?: string | null
    experienceLevel?: string | null
  }): Promise<UpworkJob> {
    const { data, error } = await this.client
      .from('upwork_jobs')
      .insert({
        organization_id: this.orgId,
        owner_rep_id: this.rep.id,
        title: input.title.trim(),
        description: input.description.trim(),
        budget_min: input.budgetMin != null ? Math.round(Number(input.budgetMin)) : null,
        budget_max: input.budgetMax != null ? Math.round(Number(input.budgetMax)) : null,
        hourly_rate_min: input.hourlyRateMin != null ? Math.round(Number(input.hourlyRateMin)) : null,
        hourly_rate_max: input.hourlyRateMax != null ? Math.round(Number(input.hourlyRateMax)) : null,
        proposal_count: input.proposalCount != null ? Math.round(Number(input.proposalCount)) : null,
        connects_cost: input.connectsCost != null ? Math.round(Number(input.connectsCost)) : 0,
        required_skills: input.requiredSkills ?? [],
        urgency_signal: input.urgencySignal ?? null,
        raw_input: input.rawInput ?? null,
        tags: input.tags ?? [],
        screening_questions: input.screeningQuestions ?? [],
        application_requirements: input.applicationRequirements ?? [],
        engagement_type: input.engagementType ?? null,
        weekly_hours: input.weeklyHours ?? null,
        duration: input.duration ?? null,
        experience_level: input.experienceLevel ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    const job = mapUpworkJob(data as Row)
    try {
      await emitAction({
        orgId: this.orgId,
        actionType: 'UPWORK_JOB_EXTRACTED',
        actorType: 'rep',
        actorId: this.rep.id,
        jobId: job.id,
        metadata: { title: job.title },
        idempotencyKey: `upwork_extracted:${job.id}`,
      })
    } catch { }
    return job
  }

  async getUpworkJob(id: string) {
    const { data, error } = await this.client
      .from('upwork_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const messages = await this.client
      .from('upwork_messages')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .then((r) => {
        if (r.error) throw r.error
        return (r.data ?? []).map(mapUpworkMessage)
      })
    return { ...mapUpworkJob(data as Row), messages }
  }

  async listUpworkJobs(): Promise<UpworkJob[]> {
    const { data, error } = await this.client
      .from('upwork_jobs')
      .select('*')
      .eq('owner_rep_id', this.rep.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapUpworkJob)
  }

  async updateUpworkJobFields(id: string, f: Partial<Parameters<ScoutStore['createUpworkJob']>[0]>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (f.title !== undefined) row.title = f.title.trim()
    if (f.description !== undefined) row.description = f.description.trim()
    if (f.budgetMin !== undefined) row.budget_min = f.budgetMin != null ? Math.round(Number(f.budgetMin)) : null
    if (f.budgetMax !== undefined) row.budget_max = f.budgetMax != null ? Math.round(Number(f.budgetMax)) : null
    if (f.hourlyRateMin !== undefined) row.hourly_rate_min = f.hourlyRateMin != null ? Math.round(Number(f.hourlyRateMin)) : null
    if (f.hourlyRateMax !== undefined) row.hourly_rate_max = f.hourlyRateMax != null ? Math.round(Number(f.hourlyRateMax)) : null
    if (f.proposalCount !== undefined) row.proposal_count = f.proposalCount != null ? Math.round(Number(f.proposalCount)) : null
    if (f.connectsCost !== undefined) row.connects_cost = f.connectsCost != null ? Math.round(Number(f.connectsCost)) : 0
    if (f.requiredSkills !== undefined) row.required_skills = f.requiredSkills ?? []
    if (f.urgencySignal !== undefined) row.urgency_signal = f.urgencySignal ?? null
    if (f.rawInput !== undefined) row.raw_input = f.rawInput ?? null
    if (f.tags !== undefined) row.tags = f.tags ?? []
    if (f.screeningQuestions !== undefined) row.screening_questions = f.screeningQuestions ?? []
    if (f.applicationRequirements !== undefined) row.application_requirements = f.applicationRequirements ?? []
    if (f.engagementType !== undefined) row.engagement_type = f.engagementType ?? null
    if (f.weeklyHours !== undefined) row.weekly_hours = f.weeklyHours ?? null
    if (f.duration !== undefined) row.duration = f.duration ?? null
    if (f.experienceLevel !== undefined) row.experience_level = f.experienceLevel ?? null
    const { error } = await this.client.from('upwork_jobs').update(row).eq('id', id).eq('owner_rep_id', this.rep.id)
    if (error) throw error
  }

  async updateUpworkJobScore(
    id: string,
    score: { total: number; verdict: UpworkJob['verdict']; canonicalScore?: number | null; scoreVersion?: string | null; scoreBreakdown?: unknown; jobFacts?: unknown; profileMatch?: unknown },
  ): Promise<void> {
    const base = { score: score.total, verdict: score.verdict }
    const canonical = score.canonicalScore != null
      ? { canonical_score: score.canonicalScore, score_version: score.scoreVersion ?? null, score_breakdown: score.scoreBreakdown ?? null, job_facts: score.jobFacts ?? null, profile_match: score.profileMatch ?? null, scored_at: new Date().toISOString() }
      : {}
    const { error } = await this.client
      .from('upwork_jobs')
      .update({ ...base, ...canonical })
      .eq('id', id)
      .eq('owner_rep_id', this.rep.id)
    if (!error) return
    // Canonical columns may not exist yet (migration not applied): persist the legacy pair.
    if (Object.keys(canonical).length && /column|schema cache/i.test(error.message)) {
      const retry = await this.client.from('upwork_jobs').update(base).eq('id', id).eq('owner_rep_id', this.rep.id)
      if (retry.error) throw retry.error
      console.warn('[upwork] canonical score columns missing — apply 20261021000000_upwork_canonical_score.sql')
      return
    }
    throw error
  }

  async updateUpworkJob(
    id: string,
    updates: {
      status?: UpworkJob['status']
      notes?: string | null
      proposedRate?: number | null
    },
  ): Promise<void> {
    let query = this.client
      .from('upwork_jobs')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', this.orgId)
    if (this.rep.role !== 'admin') query = query.eq('owner_rep_id', this.rep.id)
    const { data, error } = await query.select('id')
    if (error) throw error
    if (!data?.length) throw new Error('Could not update this job.')
  }

  async saveUpworkDraft(input: {
    jobId: string
    type: UpworkMessage['type']
    draftText: string
    modelUsed: string
  }): Promise<UpworkMessage> {
    const { data, error } = await this.client
      .from('upwork_messages')
      .insert({
        organization_id: this.orgId,
        job_id: input.jobId,
        rep_id: this.rep.id,
        type: input.type,
        draft_text: input.draftText,
        model_used: input.modelUsed,
      })
      .select('*')
      .single()
    if (error) throw error
    const msg = mapUpworkMessage(data as Row)
    if (input.type === 'cover') {
      try {
        await emitAction({
          orgId: this.orgId,
          actionType: 'UPWORK_PROPOSAL_PREPARED',
          actorType: 'rep',
          actorId: this.rep.id,
          jobId: input.jobId,
          messageId: msg.id,
          executionStatus: 'generated',
          channel: 'upwork',
          idempotencyKey: `upwork_proposal:${msg.id}`,
        })
      } catch { }
      try {
        const { data: targets } = await this.client
          .from('daily_targets')
          .select('revenue_identity_id')
          .eq('rep_id', this.rep.id)
          .eq('activity_type', 'application')
          .eq('active', true)
        if (targets && targets.length > 0) {
          for (const t of targets) {
            try {
              await this.client.rpc('record_activity_event', {
                p_rep_id: this.rep.id,
                p_identity_id: t.revenue_identity_id as string,
                p_activity_type: 'application',
                p_org_id: this.orgId,
                p_source_event_id: `activity:upwork_draft:${input.jobId}:${t.revenue_identity_id}`,
              })
            } catch { }
          }
          try {
            const sourceEventId = `canonical:upwork_draft:${input.jobId}:${this.rep.id}`
            for (const t of targets) {
              try {
                await this.client.rpc('record_canonical_progress', {
                  p_org_id: this.orgId,
                  p_person_id: this.rep.id,
                  p_revenue_identity_id: t.revenue_identity_id as string,
                  p_event_type: 'OUTREACH_RECORDED',
                  p_metric_key: 'applications',
                  p_source_event_id: sourceEventId,
                  p_date: new Date().toISOString().slice(0, 10),
                })
              } catch { }
            }
          } catch { }
        }
      } catch { }
    }
    return msg
  }

  async markUpworkApplied(
    jobId: string,
    sentText: string,
    type: UpworkMessage['type'] = 'cover',
  ): Promise<void> {
    // Look up the job's connects cost before updating
    const { data: jobRow } = await this.client
      .from('upwork_jobs')
      .select('connects_cost')
      .eq('id', jobId)
      .maybeSingle()
    const connectsCost = (jobRow as unknown as { connects_cost: number })?.connects_cost ?? 0

    await Promise.all([
      this.client
        .from('upwork_jobs')
        .update({ status: 'applied', connects_used: connectsCost })
        .eq('id', jobId)
        .eq('owner_rep_id', this.rep.id),
      this.client.from('upwork_messages').insert({
        organization_id: this.orgId,
        job_id: jobId,
        rep_id: this.rep.id,
        type,
        sent_text: sentText,
        sent_at: new Date().toISOString(),
      }),
      // Record accountability increment — TEAM-001 (Today showed no
      // progress). This was the one real send-logging path in the app that
      // never called record_activity_event: DM/connection/followup/reply/
      // email all go through markContacted, which does; Upwork applications
      // went straight to raw table writes and silently never counted
      // toward the 'application' daily target (UPWORK_PACK in
      // default-targets.ts), so a rep logging Upwork applications all day
      // would see Today's progress stay at 0 no matter how much real work
      // was done. Only 'application' is incremented (not the separate
      // 'proposal' target also in UPWORK_PACK) — this route represents the
      // single act of applying; crediting a second, distinct target for
      // the same action would be its own accountability-integrity bug
      // (one real action counting as two), not a fix. Non-fatal, mirrors
      // markContacted's own error handling exactly.
      (async () => {
        try {
          const { data: targets } = await this.client
            .from('daily_targets')
            .select('revenue_identity_id')
            .eq('rep_id', this.rep.id)
            .eq('activity_type', 'application')
            .eq('active', true)
           if (targets && targets.length > 0) {
            for (const t of targets) {
              try {
                await this.client.rpc('record_activity_event', {
                  p_rep_id: this.rep.id,
                  p_identity_id: t.revenue_identity_id as string,
                  p_activity_type: 'application',
                  p_org_id: this.orgId,
                  p_source_event_id: `activity:upwork:${jobId}:${t.revenue_identity_id}`,
                })
              } catch {
                // Non-fatal per-target
              }
            }

            // Bridge: canonical progress for Upwork applications
            try {
              const sourceEventId = `canonical:upwork:${jobId}:${this.rep.id}`
              for (const t of targets) {
                try {
                  await this.client.rpc('record_canonical_progress', {
                    p_org_id: this.orgId,
                    p_person_id: this.rep.id,
                    p_revenue_identity_id: t.revenue_identity_id as string,
                    p_event_type: 'OUTREACH_RECORDED',
                    p_metric_key: 'applications',
                    p_source_event_id: sourceEventId,
                    p_date: new Date().toISOString().slice(0, 10),
                  })
                } catch {
                  // Non-fatal per-target
                }
              }
            } catch {
              // Progress bridge must never block the apply
            }
          }
        } catch {
          // Accountability increment must never block the apply
        }
      })(),
    ])

    try {
      await emitAction({
        orgId: this.orgId,
        actionType: 'UPWORK_APPLIED',
        actorType: 'rep',
        actorId: this.rep.id,
        jobId,
        executionStatus: 'sent',
        channel: 'upwork',
        idempotencyKey: `upwork_applied:${jobId}`,
      })
    } catch {
      // Action ledger must never break domain operations
    }
  }

  // ==========================================================================
  // Tailored CV persistence
  // ==========================================================================

  async saveTailoredCV(input: {
    jobId: string
    revenueIdentityId?: string | null
    profileId?: string | null
    baseCvPath?: string | null
    baseResumeSnapshot?: Record<string, unknown>
    tailoredResume: Record<string, unknown>
    atsScore: number
    atsDimensions?: Array<{ label: string; score: number; max: number; note: string }>
    atsMissingSkills?: string[]
    targetTitle?: string | null
    targetSkills?: string[]
    targetCompany?: string | null
    proposalText?: string | null
  }): Promise<TailoredCV> {
    const { data, error } = await this.client
      .from('tailored_cvs')
      .insert({
        organization_id: this.orgId,
        job_id: input.jobId,
        revenue_identity_id: input.revenueIdentityId ?? null,
        profile_id: input.profileId ?? null,
        base_cv_path: input.baseCvPath ?? null,
        base_resume_snapshot: input.baseResumeSnapshot ?? {},
        tailored_resume: input.tailoredResume,
        ats_score: input.atsScore,
        ats_dimensions: input.atsDimensions ?? [],
        ats_missing_skills: input.atsMissingSkills ?? [],
        target_title: input.targetTitle ?? null,
        target_skills: input.targetSkills ?? [],
        target_company: input.targetCompany ?? null,
        proposal_text: input.proposalText ?? null,
        status: 'generated',
      })
      .select('*')
      .single()
    if (error) throw error
    const r = data as Record<string, unknown>
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
      jobId: r.job_id as string,
      revenueIdentityId: r.revenue_identity_id as string | null,
      profileId: r.profile_id as string | null,
      baseCvPath: r.base_cv_path as string | null,
      baseResumeSnapshot: (r.base_resume_snapshot as Record<string, unknown>) ?? {},
      tailoredResume: (r.tailored_resume as Record<string, unknown>) ?? {},
      tailoredCvPath: r.tailored_cv_path as string | null,
      atsScore: r.ats_score as number,
      atsDimensions: ((r.ats_dimensions as unknown as Array<{ label: string; score: number; max: number; note: string }>) ?? []),
      atsMissingSkills: (r.ats_missing_skills as string[]) ?? [],
      targetTitle: r.target_title as string | null,
      targetSkills: (r.target_skills as string[]) ?? [],
      targetCompany: r.target_company as string | null,
      status: r.status as TailoredCV['status'],
      proposalText: r.proposal_text as string | null,
      generatedAt: r.generated_at as string,
      appliedAt: r.applied_at as string | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }
  }

  async getTailoredCV(id: string): Promise<TailoredCV | null> {
    const { data, error } = await this.client
      .from('tailored_cvs')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const r = data as Record<string, unknown>
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
      jobId: r.job_id as string,
      revenueIdentityId: r.revenue_identity_id as string | null,
      profileId: r.profile_id as string | null,
      baseCvPath: r.base_cv_path as string | null,
      baseResumeSnapshot: (r.base_resume_snapshot as Record<string, unknown>) ?? {},
      tailoredResume: (r.tailored_resume as Record<string, unknown>) ?? {},
      tailoredCvPath: r.tailored_cv_path as string | null,
      atsScore: r.ats_score as number,
      atsDimensions: ((r.ats_dimensions as unknown as Array<{ label: string; score: number; max: number; note: string }>) ?? []),
      atsMissingSkills: (r.ats_missing_skills as string[]) ?? [],
      targetTitle: r.target_title as string | null,
      targetSkills: (r.target_skills as string[]) ?? [],
      targetCompany: r.target_company as string | null,
      status: r.status as TailoredCV['status'],
      proposalText: r.proposal_text as string | null,
      generatedAt: r.generated_at as string,
      appliedAt: r.applied_at as string | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }
  }

  async listTailoredCVsForJob(jobId: string): Promise<TailoredCV[]> {
    const { data, error } = await this.client
      .from('tailored_cvs')
      .select('*')
      .eq('job_id', jobId)
      .order('generated_at', { ascending: false })
    if (error) throw error
    return (data as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      organizationId: r.organization_id as string,
      jobId: r.job_id as string,
      revenueIdentityId: r.revenue_identity_id as string | null,
      profileId: r.profile_id as string | null,
      baseCvPath: r.base_cv_path as string | null,
      baseResumeSnapshot: (r.base_resume_snapshot as Record<string, unknown>) ?? {},
      tailoredResume: (r.tailored_resume as Record<string, unknown>) ?? {},
      tailoredCvPath: r.tailored_cv_path as string | null,
      atsScore: r.ats_score as number,
      atsDimensions: ((r.ats_dimensions as unknown as Array<{ label: string; score: number; max: number; note: string }>) ?? []),
      atsMissingSkills: (r.ats_missing_skills as string[]) ?? [],
      targetTitle: r.target_title as string | null,
      targetSkills: (r.target_skills as string[]) ?? [],
      targetCompany: r.target_company as string | null,
      status: r.status as TailoredCV['status'],
      proposalText: r.proposal_text as string | null,
      generatedAt: r.generated_at as string,
      appliedAt: r.applied_at as string | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }))
  }

  async markTailoredCVApplied(id: string): Promise<void> {
    const { error } = await this.client
      .from('tailored_cvs')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  // ==========================================================================
  // CSV imports
  // ==========================================================================

  async logCsvImport(
    input: Omit<CsvImport, 'id' | 'createdAt' | 'repId'>,
  ): Promise<CsvImport> {
    const { data, error } = await this.client
      .from('csv_imports')
      .insert({
        organization_id: this.orgId,
        rep_id: this.rep.id,
        file_name: input.fileName ?? null,
        total_rows: input.totalRows,
        imported: input.imported,
        duplicates: input.duplicates,
        invalid: input.invalid,
        details: input.details ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    const r = data as Row
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
      repId: r.rep_id as string,
      fileName: (r.file_name as string) ?? null,
      totalRows: r.total_rows as number,
      imported: r.imported as number,
      duplicates: r.duplicates as number,
      invalid: r.invalid as number,
      details: r.details as unknown,
      createdAt: r.created_at as string,
    }
  }

  async listCsvImports(): Promise<CsvImport[]> {
    const { data, error } = await this.client
      .from('csv_imports')
      .select('*')
      .eq('rep_id', this.rep.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      organizationId: r.organization_id as string,
      repId: r.rep_id as string,
      fileName: (r.file_name as string) ?? null,
      totalRows: r.total_rows as number,
      imported: r.imported as number,
      duplicates: r.duplicates as number,
      invalid: r.invalid as number,
      details: r.details as unknown,
      createdAt: r.created_at as string,
    }))
  }

  // ==========================================================================
  // Archive search
  // ==========================================================================

  async archiveSearch(opts: {
    query: string
    entityFilter?: 'lead' | 'proof' | 'upwork' | 'conversation' | 'identity' | 'studio' | 'all'
    statusFilter?: string[]
    signalFilter?: number[]
    playFilter?: string[]
    repFilter?: string[]
    dateFrom?: string | null
    dateTo?: string | null
    limit?: number
  }): Promise<
    Array<{
      entityType: 'lead' | 'proof' | 'upwork' | 'conversation' | 'identity' | 'studio'
      id: string
      title: string
      subtitle: string
      status: string | null
      createdAt: string
      href?: string
      rank: number
    }>
  > {
    const query = opts.query.trim()
    if (!query) return []

    const entityFilter = (opts.entityFilter ?? 'all') as ArchiveEntityFilter
    const limit = Number.isFinite(opts.limit) && (opts.limit ?? 0) > 0 ? Number(opts.limit) : 20
    const candidateLimit = Math.max(limit * 5, 80)

    const repFilter = (opts.repFilter ?? []).map((v) => v.trim()).filter(Boolean)
    const playFilter = (opts.playFilter ?? []).map((v) => v.trim()).filter(Boolean)
    const signalFilter = (opts.signalFilter ?? []).filter((n) => Number.isFinite(n))
    const repUuidFilter = repFilter.filter(isUuid)
    const playUuidFilter = playFilter.filter(isUuid)

    if ((repFilter.length > 0 && repUuidFilter.length === 0) || (playFilter.length > 0 && playUuidFilter.length === 0)) {
      return []
    }

    const wantsLead = entityFilter === 'all' || entityFilter === 'lead'
    const wantsProof = entityFilter === 'all' || entityFilter === 'proof'
    const wantsUpwork = entityFilter === 'all' || entityFilter === 'upwork'
    const wantsConversation = entityFilter === 'all' || entityFilter === 'conversation'
    const wantsIdentity = (entityFilter === 'all' || entityFilter === 'identity') && this.rep.role === 'admin'
    const wantsStudio = entityFilter === 'all' || entityFilter === 'studio'

    const candidates: ArchiveSearchCandidate[] = []
    let leadRows: Row[] = []

    if (wantsLead || wantsConversation) {
      let leadQuery = this.client
        .from('leads')
        .select('id, company, contact_name, contact_title, status, created_at, signal_evidence, raw_input, url, tags, owner_rep_id, signal_type, play_id')
        .order('created_at', { ascending: false })
        .limit(candidateLimit)

      if (signalFilter.length > 0) leadQuery = leadQuery.in('signal_type', signalFilter)
      if (playUuidFilter.length > 0) leadQuery = leadQuery.in('play_id', playUuidFilter)
      if (repUuidFilter.length > 0) leadQuery = leadQuery.in('owner_rep_id', repUuidFilter)
      if (opts.dateFrom) leadQuery = leadQuery.gte('created_at', opts.dateFrom)
      if (opts.dateTo) leadQuery = leadQuery.lte('created_at', opts.dateTo)

      const { data, error } = await leadQuery
      if (error) throw error
      leadRows = (data ?? []) as Row[]
    }

    if (wantsLead) {
      for (const row of leadRows) {
        const id = row.id as string
        candidates.push({
          entityType: 'lead',
          id,
          title: (row.company as string) ?? 'Untitled lead',
          subtitle: [row.contact_name as string, row.contact_title as string].filter(Boolean).join(' · '),
          status: (row.status as string) ?? null,
          createdAt: (row.created_at as string) ?? new Date(0).toISOString(),
          href: `/leads/${id}`,
          body: [row.signal_evidence as string, row.raw_input as string].filter(Boolean).join(' '),
          searchText: [row.url as string, ...(Array.isArray(row.tags) ? (row.tags as string[]) : [])],
        })
      }
    }

    if (wantsConversation && leadRows.length > 0) {
      const leadMap = new Map(leadRows.map((row) => [row.id as string, row]))
      const leadIds = [...leadMap.keys()]
      if (leadIds.length > 0) {
        let stateQuery = this.client
          .from('conversation_states')
          .select('lead_id, stage, updated_at, last_strategy, last_angle, last_cta, last_reply_at, last_sent_at')
          .in('lead_id', leadIds)
          .order('updated_at', { ascending: false })
          .limit(candidateLimit)
        if (opts.dateFrom) stateQuery = stateQuery.gte('updated_at', opts.dateFrom)
        if (opts.dateTo) stateQuery = stateQuery.lte('updated_at', opts.dateTo)

        const { data: stateData, error: stateError } = await stateQuery
        if (stateError) {
          if (!isOptionalSearchError(stateError)) throw stateError
        } else {
          const stateRows = (stateData ?? []) as Row[]
          const stateLeadIds = [...new Set(stateRows.map((row) => row.lead_id as string).filter(Boolean))]

          const latestMessageByLead = new Map<string, string>()
          if (stateLeadIds.length > 0) {
            const { data: messageData, error: messageError } = await this.client
              .from('messages')
              .select('lead_id, sent_text, draft_text, created_at, type')
              .in('lead_id', stateLeadIds)
              .order('created_at', { ascending: false })
              .limit(candidateLimit * 3)
            if (messageError) throw messageError

            for (const row of (messageData ?? []) as Row[]) {
              const leadId = row.lead_id as string
              if (!leadId || latestMessageByLead.has(leadId)) continue
              const text = ((row.sent_text as string) ?? (row.draft_text as string) ?? '').trim()
              if (!text) continue
              latestMessageByLead.set(leadId, text)
            }
          }

          for (const row of stateRows) {
            const leadId = row.lead_id as string
            const lead = leadMap.get(leadId)
            if (!lead) continue
            const createdAt =
              (row.updated_at as string) ??
              (row.last_reply_at as string) ??
              (row.last_sent_at as string) ??
              (lead.created_at as string) ??
              new Date(0).toISOString()
            candidates.push({
              entityType: 'conversation',
              id: leadId,
              title: (lead.company as string) ?? 'Conversation',
              subtitle: [lead.contact_name as string, row.stage as string].filter(Boolean).join(' · '),
              status: (row.stage as string) ?? null,
              createdAt,
              href: `/leads/${leadId}`,
              body: [
                row.last_strategy as string,
                row.last_angle as string,
                row.last_cta as string,
                latestMessageByLead.get(leadId),
              ]
                .filter(Boolean)
                .join(' '),
            })
          }
        }
      }
    }

    if (wantsUpwork) {
      let upworkQuery = this.client
        .from('upwork_jobs')
        .select('id, title, description, urgency_signal, required_skills, tags, status, created_at, owner_rep_id, client_name')
        .order('created_at', { ascending: false })
        .limit(candidateLimit)

      if (repUuidFilter.length > 0) upworkQuery = upworkQuery.in('owner_rep_id', repUuidFilter)
      if (opts.dateFrom) upworkQuery = upworkQuery.gte('created_at', opts.dateFrom)
      if (opts.dateTo) upworkQuery = upworkQuery.lte('created_at', opts.dateTo)

      const { data, error } = await upworkQuery
      if (error) throw error
      for (const row of (data ?? []) as Row[]) {
        const id = row.id as string
        candidates.push({
          entityType: 'upwork',
          id,
          title: (row.title as string) ?? 'Untitled job',
          subtitle: ((row.client_name as string) ?? '').trim() || 'Upwork job',
          status: (row.status as string) ?? null,
          createdAt: (row.created_at as string) ?? new Date(0).toISOString(),
          href: `/upwork/${id}`,
          body: [row.description as string, row.urgency_signal as string].filter(Boolean).join(' '),
          searchText: [
            ...(Array.isArray(row.required_skills) ? (row.required_skills as string[]) : []),
            ...(Array.isArray(row.tags) ? (row.tags as string[]) : []),
          ],
        })
      }
    }

    if (wantsProof) {
      let proofQuery = this.client
        .from('proof_items')
        .select('id, profile_id, project_summary, review_quote, client_name, permission_on_file, tags, created_at')
        .order('created_at', { ascending: false })
        .limit(candidateLimit)
      if (opts.dateFrom) proofQuery = proofQuery.gte('created_at', opts.dateFrom)
      if (opts.dateTo) proofQuery = proofQuery.lte('created_at', opts.dateTo)

      const { data, error } = await proofQuery
      if (error) throw error
      const proofRows = (data ?? []) as Row[]

      const profileIds = [...new Set(proofRows.map((row) => row.profile_id as string).filter(Boolean))]
      const profileMap = new Map<string, { label: string; repId: string | null }>()
      if (profileIds.length > 0) {
        const { data: profileRows, error: profileError } = await this.client
          .from('profiles')
          .select('id, label, rep_id')
          .in('id', profileIds)
        if (profileError) throw profileError
        for (const row of (profileRows ?? []) as Row[]) {
          profileMap.set(row.id as string, {
            label: ((row.label as string) ?? '').trim(),
            repId: (row.rep_id as string) ?? null,
          })
        }
      }

      for (const row of proofRows) {
        const profileId = row.profile_id as string
        const profile = profileMap.get(profileId)
        if (repUuidFilter.length > 0 && (!profile?.repId || !repUuidFilter.includes(profile.repId))) {
          continue
        }
        const id = row.id as string
        const permissionOnFile = Boolean(row.permission_on_file)
        const clientName = permissionOnFile ? ((row.client_name as string) ?? '').trim() : ''
        candidates.push({
          entityType: 'proof',
          id,
          title: (row.project_summary as string) ?? 'Proof item',
          subtitle: clientName || profile?.label || 'Proof item',
          status: null,
          createdAt: (row.created_at as string) ?? new Date(0).toISOString(),
          href: `/profiles?profileId=${encodeURIComponent(profileId)}`,
          body: (row.review_quote as string) ?? null,
          searchText: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        })
      }
    }

    if (wantsIdentity) {
      const { data: identityData, error: identityError } = await this.client
        .from('revenue_identities')
        .select('id, identity_name, slug, title, positioning, status, skills, expertise, industries, technologies, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(candidateLimit)

      if (identityError) {
        if (!isOptionalSearchError(identityError)) throw identityError
      } else {
        let allowedIdentityIds: Set<string> | null = null
        if (repUuidFilter.length > 0) {
          const { data: assignmentData, error: assignmentError } = await this.client
            .from('identity_assignments')
            .select('revenue_identity_id')
            .in('rep_id', repUuidFilter)
          if (assignmentError) {
            if (!isOptionalSearchError(assignmentError)) throw assignmentError
          } else {
            allowedIdentityIds = new Set(
              ((assignmentData ?? []) as Row[])
                .map((row) => row.revenue_identity_id as string)
                .filter(Boolean),
            )
          }
        }

        for (const row of (identityData ?? []) as Row[]) {
          const id = row.id as string
          if (allowedIdentityIds && !allowedIdentityIds.has(id)) continue
          candidates.push({
            entityType: 'identity',
            id,
            title: (row.identity_name as string) ?? 'Revenue identity',
            subtitle: [row.title as string, row.slug as string].filter(Boolean).join(' · '),
            status: (row.status as string) ?? 'active',
            createdAt: ((row.updated_at as string) ?? (row.created_at as string)) ?? new Date(0).toISOString(),
            href: `/admin/revenue-identities#${id}`,
            body: (row.positioning as string) ?? null,
            searchText: [
              ...normalizeStringArray(row.skills),
              ...normalizeStringArray(row.expertise),
              ...normalizeStringArray(row.industries),
              ...normalizeStringArray(row.technologies),
            ],
          })
        }
      }
    }

    if (wantsStudio) {
      let draftRows: Row[] = []
      let historyRows: Row[] = []

      let draftQuery = this.client
        .from('content_drafts')
        .select('id, persona_id, platform, status, caption, source_material, created_at')
        .order('created_at', { ascending: false })
        .limit(candidateLimit)
      if (opts.dateFrom) draftQuery = draftQuery.gte('created_at', opts.dateFrom)
      if (opts.dateTo) draftQuery = draftQuery.lte('created_at', opts.dateTo)

      const { data: draftData, error: draftError } = await draftQuery
      if (draftError) {
        if (!isOptionalSearchError(draftError)) throw draftError
      } else {
        draftRows = (draftData ?? []) as Row[]
      }

      let historyQuery = this.client
        .from('content_history')
        .select('id, persona_id, platform, opening_line, posted_at')
        .order('posted_at', { ascending: false })
        .limit(candidateLimit)
      if (opts.dateFrom) historyQuery = historyQuery.gte('posted_at', opts.dateFrom)
      if (opts.dateTo) historyQuery = historyQuery.lte('posted_at', opts.dateTo)

      const { data: historyData, error: historyError } = await historyQuery
      if (historyError) {
        if (!isOptionalSearchError(historyError)) throw historyError
      } else {
        historyRows = (historyData ?? []) as Row[]
      }

      const personaIds = [
        ...new Set(
          [...draftRows, ...historyRows]
            .map((row) => row.persona_id as string)
            .filter(Boolean),
        ),
      ]
      const personaMap = new Map<string, { name: string; repId: string | null }>()
      if (personaIds.length > 0) {
        let personaQuery = this.client
          .from('content_personas')
          .select('id, display_name, rep_id')
          .in('id', personaIds)
        if (repUuidFilter.length > 0) personaQuery = personaQuery.in('rep_id', repUuidFilter)

        const { data: personaData, error: personaError } = await personaQuery
        if (personaError) {
          if (!isOptionalSearchError(personaError)) throw personaError
        } else {
          for (const row of (personaData ?? []) as Row[]) {
            personaMap.set(row.id as string, {
              name: ((row.display_name as string) ?? '').trim() || 'Studio',
              repId: (row.rep_id as string) ?? null,
            })
          }
        }
      }

      for (const row of draftRows) {
        const personaId = row.persona_id as string
        if (repUuidFilter.length > 0 && !personaMap.has(personaId)) continue
        const persona = personaMap.get(personaId)
        const id = row.id as string
        const caption = ((row.caption as string) ?? '').trim()
        candidates.push({
          entityType: 'studio',
          id,
          title: caption || '(No caption)',
          subtitle: `${persona?.name ?? 'Studio'} · ${(row.platform as string) ?? 'post'} draft`,
          status: (row.status as string) ?? 'draft',
          createdAt: (row.created_at as string) ?? new Date(0).toISOString(),
          href: `/studio/drafts/${id}`,
          body: (row.source_material as string) ?? null,
        })
      }

      for (const row of historyRows) {
        const personaId = row.persona_id as string
        if (repUuidFilter.length > 0 && !personaMap.has(personaId)) continue
        const persona = personaMap.get(personaId)
        const id = `history:${row.id as string}`
        candidates.push({
          entityType: 'studio',
          id,
          title: ((row.opening_line as string) ?? '').trim() || '(No opening line)',
          subtitle: `${persona?.name ?? 'Studio'} · ${(row.platform as string) ?? 'post'} posted`,
          status: 'posted',
          createdAt: (row.posted_at as string) ?? new Date(0).toISOString(),
          href: `/content/${personaId}/library`,
        })
      }
    }

    const needsRpc = entityFilter === 'all' || entityFilter === 'lead' || entityFilter === 'proof' || entityFilter === 'upwork'
    if (needsRpc) {
      const { data, error } = await this.client.rpc('archive_search', {
        query,
        entity_filter: entityFilter,
        status_filter: opts.statusFilter ?? [],
        signal_filter: signalFilter,
        play_filter: playUuidFilter,
        rep_filter: repUuidFilter,
        date_from: opts.dateFrom ?? null,
        date_to: opts.dateTo ?? null,
        result_limit: candidateLimit,
      })
      if (error) {
        if (!isOptionalSearchError(error)) throw error
      } else {
        for (const row of (data ?? []) as Row[]) {
          const type = row.entity_type as 'lead' | 'proof' | 'upwork'
          const id = row.id as string
          candidates.push({
            entityType: type,
            id,
            title: (row.title as string) ?? '',
            subtitle: (row.subtitle as string) ?? '',
            status: (row.status as string) ?? null,
            createdAt: (row.created_at as string) ?? new Date(0).toISOString(),
            href: type === 'lead' ? `/leads/${id}` : type === 'upwork' ? `/upwork/${id}` : '/profiles',
            rankHint: Math.max(0, Number(row.rank ?? 0)) * 220,
          })
        }
      }
    }

    return rankArchiveResults(candidates, {
      query,
      entityFilter,
      statusFilter: opts.statusFilter,
      limit,
    })
  }

  // ==========================================================================
  // Push subscriptions
  // ==========================================================================

  async savePushSubscription(
    sub: Omit<PushSubscription, 'id' | 'createdAt'>,
  ): Promise<PushSubscription> {
    const { data, error } = await this.client
      .from('push_subscriptions')
      .upsert(
        {
          rep_id: sub.repId,
          organization_id: this.orgId,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
        { onConflict: 'rep_id' },
      )
      .select('*')
      .single()
    if (error) throw error
    const r = data as Row
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
    repId: r.rep_id as string,
    endpoint: r.endpoint as string,
      p256dh: r.p256dh as string,
      auth: r.auth as string,
      createdAt: r.created_at as string,
    }
  }

  async getPushSubscription(repId: string): Promise<PushSubscription | null> {
    const { data, error } = await this.client
      .from('push_subscriptions')
      .select('*')
      .eq('rep_id', repId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const r = data as Row
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
    repId: r.rep_id as string,
    endpoint: r.endpoint as string,
      p256dh: r.p256dh as string,
      auth: r.auth as string,
      createdAt: r.created_at as string,
    }
  }

  async deletePushSubscription(repId: string): Promise<void> {
    const { error } = await this.client
      .from('push_subscriptions')
      .delete()
      .eq('rep_id', repId)
    if (error) throw error
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  async listNotifications(): Promise<NotificationLogEntry[]> {
    const { data, error } = await this.client
      .from('notification_log')
      .select('*')
      .eq('rep_id', this.rep.id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return (data ?? []).map((r: Row) => ({
      id: r.id as string,
      organizationId: r.organization_id as string,
    repId: r.rep_id as string,
    type: r.type as NotificationLogEntry['type'],
      payload: r.payload as Record<string, unknown>,
      read: Boolean(r.read),
      createdAt: r.created_at as string,
    }))
  }

  async markNotificationRead(id: string): Promise<void> {
    const { error } = await this.client
      .from('notification_log')
      .update({ read: true })
      .eq('id', id)
      .eq('rep_id', this.rep.id)
    if (error) throw error
  }


  async createContentPersona(input: {
    repId: string
    displayName: string
    platforms: ContentPlatform[]
    voiceProfileId?: string | null
    humorStyle?: string
    valuesAndOpinions?: string[]
    admiredExamples?: string[]
  }): Promise<ContentPersona> {
    const payload = {
      organization_id: this.orgId,
      rep_id: input.repId,
      display_name: input.displayName,
      platforms: input.platforms,
      voice_profile_id: input.voiceProfileId ?? null,
      humor_style: input.humorStyle ?? '',
      values_and_opinions: input.valuesAndOpinions ?? [],
      admired_examples: input.admiredExamples ?? [],
    }

    let { data, error } = await this.client
      .from('content_personas')
      .insert(payload)
      .select()
      .single()

    if (error && error.code === 'PGRST204') {
      const minimalPayload = {
        organization_id: this.orgId,
        rep_id: input.repId,
        display_name: input.displayName,
        platforms: input.platforms,
        voice_profile_id: input.voiceProfileId ?? null,
      }
      const retry = await this.client
        .from('content_personas')
        .insert(minimalPayload)
        .select()
        .single()
      data = retry.data
      error = retry.error
    }

    if (error) throw error
    return mapContentPersona(data)
  }

  async updateContentPersonaProfile(input: {
    personaId: string
    humorStyle?: string
    valuesAndOpinions?: string[]
    admiredExamples?: string[]
  }): Promise<ContentPersona> {
    const patch: Record<string, unknown> = {}
    if (typeof input.humorStyle === 'string') patch.humor_style = input.humorStyle
    if (Array.isArray(input.valuesAndOpinions)) patch.values_and_opinions = input.valuesAndOpinions
    if (Array.isArray(input.admiredExamples)) patch.admired_examples = input.admiredExamples

    const { data, error } = await this.client
      .from('content_personas')
      .update(patch)
      .eq('id', input.personaId)
      .select()
      .single()
    if (error && error.code === 'PGRST204') {
      const fallback = await this.getContentPersona(input.personaId)
      if (!fallback) throw error
      return fallback
    }
    if (error) throw error
    return mapContentPersona(data)
  }

  async updateContentPersona(input: {
    personaId: string
    personaRole?: string
    personaCompany?: string
    personaLocation?: string
    contentComfort?: string[]
    onboardingStep?: string
    onboardingCompleted?: boolean
  }): Promise<ContentPersona> {
    const patch: Record<string, unknown> = {}
    if (typeof input.personaRole === 'string') patch.persona_role = input.personaRole
    if (typeof input.personaCompany === 'string') patch.persona_company = input.personaCompany
    if (typeof input.personaLocation === 'string') patch.persona_location = input.personaLocation
    if (Array.isArray(input.contentComfort)) patch.content_comfort = input.contentComfort
    if (typeof input.onboardingStep === 'string') patch.onboarding_step = input.onboardingStep
    if (typeof input.onboardingCompleted === 'boolean') patch.onboarding_completed = input.onboardingCompleted

    const { data, error } = await this.client
      .from('content_personas')
      .update(patch)
      .eq('id', input.personaId)
      .select()
      .single()
    if (error && error.code === 'PGRST204') {
      const fallback = await this.getContentPersona(input.personaId)
      if (!fallback) throw error
      return fallback
    }
    if (error) throw error
    return mapContentPersona(data)
  }

  async listContentPersonas(repId: string): Promise<ContentPersona[]> {
    const { data, error } = await this.client
      .from('content_personas')
      .select('*')
      .eq('rep_id', repId)
      .order('display_name')
    if (error) throw error
    return data.map(mapContentPersona)
  }

  async getContentPersona(personaId: string): Promise<ContentPersona | null> {
     const { data, error } = await this.client
       .from('content_personas')
       .select('*')
       .eq('id', personaId)
       .eq('organization_id', this.orgId)
       .maybeSingle()
     if (error) return null
     return data ? mapContentPersona(data) : null
   }

  async deleteContentPersona(personaId: string): Promise<void> {
    const { error } = await this.client
      .from('content_personas')
      .delete()
      .eq('id', personaId)
    if (error) throw error
  }

  async createContentPillar(input: {
    personaId: string
    pillarName: string
    description?: string
  }): Promise<ContentPillar> {
    const { data, error } = await this.client
      .from('content_pillars')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        pillar_name: input.pillarName,
        description: input.description ?? '',
      })
      .select()
      .single()
    if (error) throw error
    return mapContentPillar(data)
  }

  async listContentPillars(personaId: string): Promise<ContentPillar[]> {
    const { data, error} = await this.client
      .from('content_pillars')
      .select('*')
      .eq('persona_id', personaId)
      .order('pillar_name')
    if (error) throw error
    return data.map(mapContentPillar)
  }

  async deleteContentPillar(pillarId: string): Promise<void> {
    const { error } = await this.client
      .from('content_pillars')
      .delete()
      .eq('id', pillarId)
    if (error) throw error
  }

  async createContentDraft(input: {
    personaId: string
    pillarId: string | null
    topicClusterId?: string | null
    researchFindingId?: string | null
    structureId?: string | null
    sourceKind?: 'answer' | 'conviction' | 'field_update' | 'idea'
    sourceMaterial: string
    platform: ContentPlatform
    caption: string
    hookScore?: number | null
    hookFeedback?: string
    selfCheckPassed?: boolean
    selfCheckNote?: string
    specificityHit?: boolean
    status?: ContentDraftStatus
  }): Promise<ContentDraft> {
    const payload = {
      organization_id: this.orgId,
      persona_id: input.personaId,
      pillar_id: input.pillarId,
      topic_cluster_id: input.topicClusterId ?? null,
      research_finding_id: input.researchFindingId ?? null,
      structure_id: input.structureId ?? null,
      source_kind: input.sourceKind ?? 'answer',
      source_material: input.sourceMaterial,
      platform: input.platform,
      caption: input.caption,
      hook_score: input.hookScore ?? null,
      hook_feedback: input.hookFeedback ?? '',
      self_check_passed: input.selfCheckPassed ?? false,
      self_check_note: input.selfCheckNote ?? '',
      specificity_hit: input.specificityHit ?? false,
      status: input.status ?? 'draft',
    }

    let { data, error } = await this.client
      .from('content_drafts')
      .insert(payload)
      .select()
      .single()

    if (error && error.code === 'PGRST204') {
      const { structure_id: _structureId, ...withoutStructure } = payload
      void _structureId
      const retry = await this.client
        .from('content_drafts')
        .insert(withoutStructure)
        .select()
        .single()
      data = retry.data
      error = retry.error
    }

    if (error) throw error
    return mapContentDraft(data)
  }

  async listContentDrafts(personaId: string): Promise<ContentDraft[]> {
    const { data, error } = await this.client
      .from('content_drafts')
      .select('*')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data.map(mapContentDraft)
  }

  async getContentDraft(draftId: string): Promise<ContentDraft | null> {
    const { data, error } = await this.client
      .from('content_drafts')
      .select('*')
      .eq('id', draftId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapContentDraft(data)
  }

  async updateContentDraftCaption(draftId: string, caption: string): Promise<ContentDraft> {
    const { data, error } = await this.client
      .from('content_drafts')
      .update({ caption })
      .eq('id', draftId)
      .select('*')
      .single()
    if (error) throw error
    return mapContentDraft(data)
  }

  async updateContentDraftStatus(draftId: string, status: ContentDraftStatus): Promise<ContentDraft> {
    const { data, error } = await this.client
      .from('content_drafts')
      .update({ status })
      .eq('id', draftId)
      .select()
      .single()
    if (error) throw error
    if (status === 'posted') {
      const draft = mapContentDraft(data)
      await this.logContentPosted({
        personaId: draft.personaId,
        pillarId: draft.pillarId,
        topicClusterId: draft.topicClusterId,
        platform: draft.platform,
        openingLine: draft.caption.split('\n')[0] ?? '',
      })
      return draft
    }
    return mapContentDraft(data)
  }

  async updateContentDraft(input: {
    draftId: string
    caption?: string
    status?: ContentDraftStatus
    hookScore?: number | null
    hookFeedback?: string
    selfCheckPassed?: boolean
    selfCheckNote?: string
    specificityHit?: boolean
  }): Promise<ContentDraft> {
    const patch: Record<string, unknown> = {}
    if (input.caption !== undefined) patch.caption = input.caption
    if (input.status !== undefined) patch.status = input.status
    if (input.hookScore !== undefined) patch.hook_score = input.hookScore
    if (input.hookFeedback !== undefined) patch.hook_feedback = input.hookFeedback
    if (input.selfCheckPassed !== undefined) patch.self_check_passed = input.selfCheckPassed
    if (input.selfCheckNote !== undefined) patch.self_check_note = input.selfCheckNote
    if (input.specificityHit !== undefined) patch.specificity_hit = input.specificityHit

    const { data, error } = await this.client
      .from('content_drafts')
      .update(patch)
      .eq('id', input.draftId)
      .select()
      .single()
    if (error) throw error
    return mapContentDraft(data)
  }

  async listContentHistory(personaId: string, limit = 20): Promise<ContentHistoryEntry[]> {
    const { data, error } = await this.client
      .from('content_history')
      .select('*')
      .eq('persona_id', personaId)
      .order('posted_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data.map(mapContentHistory)
  }

  async logContentPosted(input: {
    personaId: string
    pillarId: string | null
    topicClusterId?: string | null
    platform: ContentPlatform
    openingLine: string
  }): Promise<ContentHistoryEntry> {
    const { data, error } = await this.client
      .from('content_history')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        pillar_id: input.pillarId,
        topic_cluster_id: input.topicClusterId ?? null,
        platform: input.platform,
        opening_line: input.openingLine,
      })
      .select()
      .single()
    if (error) throw error
    return mapContentHistory(data)
  }

  async getContentHistoryEntry(historyId: string): Promise<ContentHistoryEntry | null> {
    const { data, error } = await this.client
      .from('content_history')
      .select('*')
      .eq('id', historyId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapContentHistory(data)
  }

  async markContentHistoryOutcome(historyId: string, ledToRealOutcome: boolean): Promise<ContentHistoryEntry> {
    const { data, error } = await this.client
      .from('content_history')
      .update({
        led_to_real_outcome: ledToRealOutcome,
        outcome_noted_at: ledToRealOutcome ? new Date().toISOString() : null,
      })
      .eq('id', historyId)
      .select()
      .single()
    if (error) throw error
    return mapContentHistory(data)
  }

  async logContentMetrics(historyId: string, metrics: {
    likes?: number | null
    reach?: number | null
    comments?: number | null
    reposts?: number | null
    saves?: number | null
    profileVisits?: number | null
    followerDelta?: number | null
  }): Promise<ContentHistoryEntry> {
    const patch: Record<string, unknown> = { metrics_logged_at: new Date().toISOString() }
    if ('likes' in metrics) patch.likes = metrics.likes ?? null
    if ('reach' in metrics) patch.reach = metrics.reach ?? null
    if ('comments' in metrics) patch.comments = metrics.comments ?? null
    if ('reposts' in metrics) patch.reposts = metrics.reposts ?? null
    if ('saves' in metrics) patch.saves = metrics.saves ?? null
    if ('profileVisits' in metrics) patch.profile_visits = metrics.profileVisits ?? null
    if ('followerDelta' in metrics) patch.follower_delta = metrics.followerDelta ?? null

    const { data, error } = await this.client
      .from('content_history')
      .update(patch)
      .eq('id', historyId)
      .select()
      .single()
    if (error) throw error
    return mapContentHistory(data)
  }

  async listPostStructures(): Promise<ContentPostStructure[]> {
    const { data, error } = await this.client
      .from('content_post_structures')
      .select('*')
      .order('category')
    if (error) throw error
    return data.map(mapPostStructure)
  }

  async createTrendingAngle(input: {
    pillarId: string
    angleDescription: string
    sourceNote?: string
    addedBy?: string | null
  }): Promise<TrendingAngle> {
    const { data, error } = await this.client
      .from('trending_angles')
      .insert({
        organization_id: this.orgId,
        pillar_id: input.pillarId,
        angle_description: input.angleDescription,
        source_note: input.sourceNote ?? '',
        added_by: input.addedBy ?? null,
      })
      .select()
      .single()
    if (error) throw error
    return mapTrendingAngle(data)
  }

  async getTrendingAngle(angleId: string): Promise<TrendingAngle | null> {
    const { data, error } = await this.client
      .from('trending_angles')
      .select('*')
      .eq('id', angleId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapTrendingAngle(data)
  }

  async listTrendingAnglesByPillarIds(
    pillarIds: string[],
    opts?: { unusedOnly?: boolean },
  ): Promise<TrendingAngle[]> {
    if (pillarIds.length === 0) return []
    let query = this.client
      .from('trending_angles')
      .select('*')
      .in('pillar_id', pillarIds)
      .order('added_at', { ascending: false })

    if (opts?.unusedOnly) {
      query = query.eq('used', false)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapTrendingAngle)
  }

  async markTrendingAngleUsed(angleId: string): Promise<TrendingAngle> {
    const { data, error } = await this.client
      .from('trending_angles')
      .update({ used: true })
      .eq('id', angleId)
      .select('*')
      .single()
    if (error) throw error
    return mapTrendingAngle(data)
  }

  async countContentDraftsToday(personaId: string): Promise<number> {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const { count, error } = await this.client
      .from('content_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('persona_id', personaId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
    if (error) throw error
    return count ?? 0
  }

  async createTopicCluster(input: {
    personaId: string
    clusterName: string
    description?: string
    sourceType?: 'profile' | 'answer' | 'research' | 'system'
    lastInputAt?: string | null
    lastResearchAt?: string | null
  }): Promise<TopicCluster> {
    const { data, error } = await this.client
      .from('topic_clusters')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        cluster_name: input.clusterName,
        description: input.description ?? '',
        source_type: input.sourceType ?? 'system',
        last_input_at: input.lastInputAt ?? null,
        last_research_at: input.lastResearchAt ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapTopicCluster(data)
  }

  async listTopicClusters(personaId: string): Promise<TopicCluster[]> {
    const { data, error } = await this.client
      .from('topic_clusters')
      .select('*')
      .eq('persona_id', personaId)
      .is('merged_into_id', null)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapTopicCluster)
  }

  async touchTopicCluster(input: {
    topicClusterId: string
    lastInputAt?: string | null
    lastResearchAt?: string | null
  }): Promise<TopicCluster> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (input.lastInputAt !== undefined) patch.last_input_at = input.lastInputAt
    if (input.lastResearchAt !== undefined) patch.last_research_at = input.lastResearchAt

    const { data, error } = await this.client
      .from('topic_clusters')
      .update(patch)
      .eq('id', input.topicClusterId)
      .select('*')
      .single()
    if (error) throw error
    return mapTopicCluster(data)
  }

  async createResearchFinding(input: {
    personaId: string
    topicClusterId: string
    finding: string
    sourceLabel: string
    sourceUrl: string
    sourcePublishedAt?: string | null
  }): Promise<ContentResearchFinding> {
    const { data, error } = await this.client
      .from('content_research_findings')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        topic_cluster_id: input.topicClusterId,
        finding: input.finding,
        source_label: input.sourceLabel,
        source_url: input.sourceUrl,
        source_published_at: input.sourcePublishedAt ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentResearchFinding(data)
  }

  async listResearchFindings(personaId: string, opts?: { unusedOnly?: boolean; limit?: number }): Promise<ContentResearchFinding[]> {
    let query = this.client
      .from('content_research_findings')
      .select('*')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })

    if (opts?.unusedOnly) query = query.eq('used', false)
    if (opts?.limit) query = query.limit(opts.limit)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapContentResearchFinding)
  }

  async markResearchFindingUsed(findingId: string): Promise<ContentResearchFinding> {
    const { data, error } = await this.client
      .from('content_research_findings')
      .update({ used: true })
      .eq('id', findingId)
      .select('*')
      .single()
    if (error) throw error
    return mapContentResearchFinding(data)
  }

  async createContentDraftFeedback(input: {
    personaId: string
    draftId: string
    topicClusterId: string | null
    sourceKind: 'answer' | 'conviction' | 'field_update'
    reaction: 'posting' | 'not_for_me' | 'posting_after_edit'
    edited: boolean
    editSignals: string[]
  }): Promise<ContentDraftFeedback> {
    const { data, error } = await this.client
      .from('content_draft_feedback')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        draft_id: input.draftId,
        topic_cluster_id: input.topicClusterId,
        source_kind: input.sourceKind,
        reaction: input.reaction,
        edited: input.edited,
        edit_signals: input.editSignals,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentDraftFeedback(data)
  }

  async listContentDraftFeedback(personaId: string, limit = 60): Promise<ContentDraftFeedback[]> {
    const { data, error } = await this.client
      .from('content_draft_feedback')
      .select('*')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map(mapContentDraftFeedback)
  }


  async createContentProfile(input: {
    personaId: string
    role?: string
    seniority?: string
    industries?: string[]
    audience?: string
  }): Promise<ContentProfile> {
    const { data, error } = await this.client
      .from('content_profiles')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        role: input.role ?? '',
        seniority: input.seniority ?? '',
        industries: input.industries ?? [],
        audience: input.audience ?? '',
      })
      .select('*')
      .single()
    if (error) throw error

    await this.client
      .from('content_personas')
      .update({ content_profile_id: data.id })
      .eq('id', input.personaId)

    return mapContentProfile(data)
  }

  async getContentProfile(profileId: string): Promise<ContentProfile | null> {
    const { data, error } = await this.client
      .from('content_profiles')
      .select('*')
      .eq('id', profileId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapContentProfile(data)
  }

  async getContentProfileByPersona(personaId: string): Promise<ContentProfile | null> {
    const { data, error } = await this.client
      .from('content_profiles')
      .select('*')
      .eq('persona_id', personaId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapContentProfile(data)
  }

  async updateContentProfile(profileId: string, patches: {
    role?: string
    seniority?: string
    industries?: string[]
    audience?: string
    expertise?: ContentProfileExpertise[]
    technologies?: ContentProfileTechnology[]
    goals?: ContentProfileGoal[]
    topicsCared?: ContentProfileTopic[]
    topicsAvoided?: ContentProfileTopic[]
    opinions?: ContentProfileOpinion[]
    projects?: ContentProfileProject[]
    experiences?: ContentProfileExperience[]
    writingCharacteristics?: ContentProfileWritingCharacteristics
    storytellingTendencies?: ContentProfileStorytellingTendency[]
    confidence?: number
    audiences?: string[]
    territories?: string[]
    voiceSelection?: string
  }): Promise<ContentProfile> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patches.role !== undefined) patch.role = patches.role
    if (patches.seniority !== undefined) patch.seniority = patches.seniority
    if (patches.industries !== undefined) patch.industries = patches.industries
    if (patches.audience !== undefined) patch.audience = patches.audience
    if (patches.expertise !== undefined) patch.expertise = JSON.stringify(patches.expertise)
    if (patches.technologies !== undefined) patch.technologies = JSON.stringify(patches.technologies)
    if (patches.goals !== undefined) patch.goals = JSON.stringify(patches.goals)
    if (patches.topicsCared !== undefined) patch.topics_cared = JSON.stringify(patches.topicsCared)
    if (patches.topicsAvoided !== undefined) patch.topics_avoided = JSON.stringify(patches.topicsAvoided)
    if (patches.opinions !== undefined) patch.opinions = JSON.stringify(patches.opinions)
    if (patches.projects !== undefined) patch.projects = JSON.stringify(patches.projects)
    if (patches.experiences !== undefined) patch.experiences = JSON.stringify(patches.experiences)
    if (patches.writingCharacteristics !== undefined) patch.writing_characteristics = JSON.stringify(patches.writingCharacteristics)
    if (patches.storytellingTendencies !== undefined) patch.storytelling_tendencies = JSON.stringify(patches.storytellingTendencies)
    if (patches.confidence !== undefined) patch.confidence = patches.confidence
    if (patches.audiences !== undefined) patch.audiences = patches.audiences
    if (patches.territories !== undefined) patch.territories = patches.territories
    if (patches.voiceSelection !== undefined) patch.voice_selection = patches.voiceSelection

    const { data, error } = await this.client
      .from('content_profiles')
      .update(patch)
      .eq('id', profileId)
      .select('*')
      .single()
    if (error) throw error

    const profile = mapContentProfile(data)
    if (patches.confidence === undefined) {
      await this.client
        .from('content_profiles')
        .update({ last_learned_at: new Date().toISOString() })
        .eq('id', profileId)
      profile.lastLearnedAt = new Date().toISOString()
    }
    return profile
  }

  async deleteContentProfile(profileId: string): Promise<void> {
    const { error } = await this.client
      .from('content_profiles')
      .delete()
      .eq('id', profileId)
    if (error) throw error
  }


  async getTasteProfile(personaId: string): Promise<{
    personaId: string
    preferences: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    territoryAffinity: Record<string, number>
    totalInteractions: number
    lastSignalType: string | null
    lastSignalAt: string | null
    lastSignalKey: string | null
    shortTerm: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    shortTermWeight: number
  } | null> {
    const { data, error } = await this.client
      .from('content_taste_profiles')
      .select('*')
      .eq('persona_id', personaId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const r = data as Record<string, unknown>
    const st = (r.short_term as Record<string, number>) ?? {}
    return {
      personaId: r.persona_id as string,
      preferences: {
        technicalVsHuman: (r.pref_technical_vs_human as number) ?? 0,
        opinionVsEducational: (r.pref_opinion_vs_educational as number) ?? 0,
        timelyVsEvergreen: (r.pref_timely_vs_evergreen as number) ?? 0,
        shortVsDeep: (r.pref_short_vs_deep as number) ?? 0,
        seriousVsPlayful: (r.pref_serious_vs_playful as number) ?? 0,
        personalVsUniversal: (r.pref_personal_vs_universal as number) ?? 0,
      },
      territoryAffinity: (r.territory_affinity as Record<string, number>) ?? {},
      totalInteractions: (r.total_interactions as number) ?? 0,
      lastSignalType: (r.last_signal_type as string) ?? null,
      lastSignalAt: (r.last_signal_at as string) ?? null,
      lastSignalKey: (r.last_signal_key as string) ?? null,
      shortTerm: {
        technicalVsHuman: (st.technicalVsHuman as number) ?? 0,
        opinionVsEducational: (st.opinionVsEducational as number) ?? 0,
        timelyVsEvergreen: (st.timelyVsEvergreen as number) ?? 0,
        shortVsDeep: (st.shortVsDeep as number) ?? 0,
        seriousVsPlayful: (st.seriousVsPlayful as number) ?? 0,
        personalVsUniversal: (st.personalVsUniversal as number) ?? 0,
      },
      shortTermWeight: (r.short_term_weight as number) ?? 0,
    }
  }

  async saveTasteProfile(personaId: string, profile: {
    preferences: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    territoryAffinity: Record<string, number>
    totalInteractions: number
    lastSignalType?: string | null
    lastSignalKey?: string | null
    shortTerm: { technicalVsHuman: number; opinionVsEducational: number; timelyVsEvergreen: number; shortVsDeep: number; seriousVsPlayful: number; personalVsUniversal: number }
    shortTermWeight: number
  }): Promise<void> {
    const { error } = await this.client
      .from('content_taste_profiles')
      .upsert({
        organization_id: this.orgId,
        persona_id: personaId,
        pref_technical_vs_human: profile.preferences.technicalVsHuman,
        pref_opinion_vs_educational: profile.preferences.opinionVsEducational,
        pref_timely_vs_evergreen: profile.preferences.timelyVsEvergreen,
        pref_short_vs_deep: profile.preferences.shortVsDeep,
        pref_serious_vs_playful: profile.preferences.seriousVsPlayful,
        pref_personal_vs_universal: profile.preferences.personalVsUniversal,
        territory_affinity: profile.territoryAffinity,
        total_interactions: profile.totalInteractions,
        last_signal_type: profile.lastSignalType ?? null,
        last_signal_key: profile.lastSignalKey ?? null,
        last_signal_at: new Date().toISOString(),
        short_term: profile.shortTerm,
        short_term_weight: profile.shortTermWeight,
      }, { onConflict: 'persona_id' })
    if (error) throw error
  }


  async createContentMemory(input: {
    personaId: string
    memoryType: ContentMemoryType
    content: string
    sourceDraftId?: string | null
    sourceHistoryId?: string | null
    embedding?: number[] | null
  }): Promise<ContentMemory> {
    const { data, error } = await this.client
      .from('content_memories')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        memory_type: input.memoryType,
        content: input.content,
        source_draft_id: input.sourceDraftId ?? null,
        source_history_id: input.sourceHistoryId ?? null,
        embedding: input.embedding ?? null,
        content_fingerprint: input.embedding ? null : null,
      })
      .select('*')
      .limit(1)
    if (error) throw error
    return mapContentMemory(data[0])
  }

  async listContentMemories(personaId: string, opts?: { memoryType?: ContentMemoryType; limit?: number }): Promise<ContentMemory[]> {
    let query = this.client.from('content_memories').select('*').eq('persona_id', personaId).order('created_at', { ascending: false })
    if (opts?.memoryType) query = query.eq('memory_type', opts.memoryType)
    if (opts?.limit) query = query.limit(opts.limit)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapContentMemory)
  }

  async deleteContentMemory(memoryId: string): Promise<void> {
    await this.client.from('content_memories').delete().eq('id', memoryId)
  }

  async findSimilarMemories(
    embedding: number[],
    personaId: string,
    threshold = 0.75,
    limit = 5,
  ): Promise<Array<{ id: string; content: string; memoryType: string; similarity: number; createdAt: string }>> {
    const { data, error } = await this.client.rpc('match_memories_by_embedding', {
      query_embedding: embedding,
      match_persona_id: personaId,
      match_threshold: threshold,
      match_count: limit,
    })
    if (error) {
      // pgvector not enabled or function missing — return empty (graceful degradation)
      console.warn('[store] Semantic memory search unavailable:', error.message)
      return []
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      memoryType: row.memory_type as string,
      similarity: row.similarity as number,
      createdAt: row.created_at as string,
    }))
  }


  async createContentOpportunity(input: {
    personaId: string
    opportunityType: ContentOpportunityType
    title: string
    description: string
    trigger: string
    sourceKind?: 'user_input' | 'interview' | 'research' | 'system_inferred' | 'history_pattern' | null
    sourceReference?: string | null
  }): Promise<ContentOpportunity> {
    const { data, error } = await this.client
      .from('content_opportunities')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        opportunity_type: input.opportunityType,
        title: input.title,
        description: input.description,
        trigger: input.trigger,
        source_kind: input.sourceKind ?? null,
        source_reference: input.sourceReference ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentOpportunity(data)
  }

  async listContentOpportunities(personaId: string, opts?: { status?: string; limit?: number }): Promise<ContentOpportunity[]> {
    let query = this.client.from('content_opportunities').select('*').eq('persona_id', personaId).order('created_at', { ascending: false })
    if (opts?.status) query = query.eq('status', opts.status)
    if (opts?.limit) query = query.limit(opts.limit)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapContentOpportunity)
  }

  async getContentOpportunity(opportunityId: string): Promise<ContentOpportunity | null> {
    const { data, error } = await this.client.from('content_opportunities').select('*').eq('id', opportunityId).maybeSingle()
    if (error) throw error
    return data ? mapContentOpportunity(data) : null
  }

  async updateContentOpportunity(opportunityId: string, patches: {
    qualification?: ContentOpportunityQualification
    qualified?: boolean
    status?: string
    dismissedAt?: string | null
    completedAt?: string | null
  }): Promise<ContentOpportunity> {
    const patch: Record<string, unknown> = {}
    if (patches.qualification !== undefined) patch.qualification = JSON.stringify(patches.qualification)
    if (patches.qualified !== undefined) patch.qualified = patches.qualified
    if (patches.status !== undefined) patch.status = patches.status
    if (patches.dismissedAt !== undefined) patch.dismissed_at = patches.dismissedAt
    if (patches.completedAt !== undefined) patch.completed_at = patches.completedAt
    const { data, error } = await this.client.from('content_opportunities').update(patch).eq('id', opportunityId).select('*').single()
    if (error) throw error
    return mapContentOpportunity(data)
  }

  async deleteContentOpportunity(opportunityId: string): Promise<void> {
    await this.client.from('content_opportunities').delete().eq('id', opportunityId)
  }


  async createIdeaGenome(input: {
    personaId: string
    source: IdeaGenomeSource
    topic: string
    angle: string
    archetype: IdeaGenomeArchetype
    audience: string
    emotion?: string | null
    valueType?: 'practical' | 'emotional' | 'intellectual' | 'social' | null
    opportunityId?: string | null
  }): Promise<ContentIdeaGenome> {
    const { data, error } = await this.client
      .from('content_idea_genomes')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        source: input.source,
        topic: input.topic,
        angle: input.angle,
        archetype: input.archetype,
        audience: input.audience,
        emotion: input.emotion ?? null,
        value_type: input.valueType ?? null,
        opportunity_id: input.opportunityId ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentIdeaGenome(data)
  }

  async getIdeaGenome(genomeId: string): Promise<ContentIdeaGenome | null> {
    const { data, error } = await this.client.from('content_idea_genomes').select('*').eq('id', genomeId).maybeSingle()
    if (error) throw error
    return data ? mapContentIdeaGenome(data) : null
  }

  async updateIdeaGenome(genomeId: string, patches: {
    novelty?: number
    evidenceStrength?: number
    personalSpecificity?: number
    relevance?: number
    conversationPotential?: number
    contentMemoryOverlap?: string[]
    differentiationNote?: string
    status?: string
    rejectionReason?: string | null
    draftId?: string | null
  }): Promise<ContentIdeaGenome> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patches.novelty !== undefined) patch.novelty = patches.novelty
    if (patches.evidenceStrength !== undefined) patch.evidence_strength = patches.evidenceStrength
    if (patches.personalSpecificity !== undefined) patch.personal_specificity = patches.personalSpecificity
    if (patches.relevance !== undefined) patch.relevance = patches.relevance
    if (patches.conversationPotential !== undefined) patch.conversation_potential = patches.conversationPotential
    if (patches.contentMemoryOverlap !== undefined) patch.content_memory_overlap = JSON.stringify(patches.contentMemoryOverlap)
    if (patches.differentiationNote !== undefined) patch.differentiation_note = patches.differentiationNote
    if (patches.status !== undefined) patch.status = patches.status
    if (patches.rejectionReason !== undefined) patch.rejection_reason = patches.rejectionReason
    if (patches.draftId !== undefined) patch.draft_id = patches.draftId
    const { data, error } = await this.client.from('content_idea_genomes').update(patch).eq('id', genomeId).select('*').single()
    if (error) throw error
    return mapContentIdeaGenome(data)
  }


  async createEvaluation(input: {
    draftId: string
    originality?: number
    personalSpecificity?: number
    usefulness?: number
    credibility?: number
    evidence?: number
    clarity?: number
    storytelling?: number
    voiceMatch?: number
    stopPotential?: number
    dwellPotential?: number
    commentPotential?: number
    savePotential?: number
    sharePotential?: number
    audienceRelevance?: number
    slopScore?: number
    genericProbability?: number
    qualityNotes?: Record<string, string>
    distributionNotes?: Record<string, string>
  }): Promise<ContentEvaluation> {
    const { data, error } = await this.client
      .from('content_evaluations')
      .insert({
        draft_id: input.draftId,
        originality: input.originality ?? 0,
        personal_specificity: input.personalSpecificity ?? 0,
        usefulness: input.usefulness ?? 0,
        credibility: input.credibility ?? 0,
        evidence: input.evidence ?? 0,
        clarity: input.clarity ?? 0,
        storytelling: input.storytelling ?? 0,
        voice_match: input.voiceMatch ?? 0,
        stop_potential: input.stopPotential ?? 0,
        dwell_potential: input.dwellPotential ?? 0,
        comment_potential: input.commentPotential ?? 0,
        save_potential: input.savePotential ?? 0,
        share_potential: input.sharePotential ?? 0,
        audience_relevance: input.audienceRelevance ?? 0,
        slop_score: input.slopScore ?? 0,
        generic_probability: input.genericProbability ?? 0,
        quality_notes: JSON.stringify(input.qualityNotes ?? {}),
        distribution_notes: JSON.stringify(input.distributionNotes ?? {}),
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentEvaluation(data)
  }

  async getEvaluation(evaluationId: string): Promise<ContentEvaluation | null> {
    const { data, error } = await this.client.from('content_evaluations').select('*').eq('id', evaluationId).maybeSingle()
    if (error) throw error
    return data ? mapContentEvaluation(data) : null
  }


  async createInterviewSession(input: {
    personaId: string
    opportunityId?: string | null
    sessionType: 'onboarding' | 'opportunity_exploration' | 'post_qualification'
  }): Promise<ContentInterviewSession> {
    const { data, error } = await this.client
      .from('content_interview_sessions')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        opportunity_id: input.opportunityId ?? null,
        session_type: input.sessionType,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentInterviewSession(data)
  }

  async getInterviewSession(sessionId: string): Promise<ContentInterviewSession | null> {
    const { data, error } = await this.client.from('content_interview_sessions').select('*').eq('id', sessionId).maybeSingle()
    if (error) throw error
    return data ? mapContentInterviewSession(data) : null
  }

  async listInterviewSessions(personaId: string, opts?: { status?: string; limit?: number }): Promise<ContentInterviewSession[]> {
    let query = this.client.from('content_interview_sessions').select('*').eq('persona_id', personaId).order('created_at', { ascending: false })
    if (opts?.status) query = query.eq('status', opts.status)
    if (opts?.limit) query = query.limit(opts.limit)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapContentInterviewSession)
  }

  async updateInterviewSession(sessionId: string, patches: {
    status?: string
    questionsAsked?: number
    informationGain?: number
    completedAt?: string | null
  }): Promise<ContentInterviewSession> {
    const patch: Record<string, unknown> = {}
    if (patches.status !== undefined) patch.status = patches.status
    if (patches.questionsAsked !== undefined) patch.questions_asked = patches.questionsAsked
    if (patches.informationGain !== undefined) patch.information_gain = patches.informationGain
    if (patches.completedAt !== undefined) patch.completed_at = patches.completedAt
    const { data, error } = await this.client.from('content_interview_sessions').update(patch).eq('id', sessionId).select('*').single()
    if (error) throw error
    return mapContentInterviewSession(data)
  }

  async createInterviewAnswer(input: {
    sessionId: string
    question: string
    answer: string
    informationGain?: number
  }): Promise<ContentInterviewAnswer> {
    const { data, error } = await this.client
      .from('content_interview_answers')
      .insert({
        session_id: input.sessionId,
        question: input.question,
        answer: input.answer,
        information_gain: input.informationGain ?? 0,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapContentInterviewAnswer(data)
  }

  async listInterviewAnswers(sessionId: string): Promise<ContentInterviewAnswer[]> {
    const { data, error } = await this.client.from('content_interview_answers').select('*').eq('session_id', sessionId).order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(mapContentInterviewAnswer)
  }


  async getAssignedProfiles(): Promise<Profile[]> {
    const { data, error } = await this.client
      .from('profile_assignments')
      .select('profile_id')
      .eq('rep_id', this.rep.id)
    if (error) throw error
    const profileIds = (data ?? []).map((r: { profile_id: string }) => r.profile_id)
    if (profileIds.length === 0) return this.listProfiles()
    const { data: profiles, error: pError } = await this.client
      .from('profiles')
      .select('*')
      .in('id', profileIds)
    if (pError) throw pError
    return (profiles ?? []).map(mapProfile)
  }

  async assignProfile(profileId: string): Promise<void> {
    const { error } = await this.client
      .from('profile_assignments')
      .upsert({ rep_id: this.rep.id, profile_id: profileId })
    if (error) throw error
  }

  async unassignProfile(profileId: string): Promise<void> {
    const { error } = await this.client
      .from('profile_assignments')
      .delete()
      .eq('rep_id', this.rep.id)
      .eq('profile_id', profileId)
    if (error) throw error
  }

  async listProofCards(profileId: string): Promise<ProofCard[]> {
    const { data, error } = await this.client
      .from('proof_cards')
      .select('*')
      .eq('profile_id', profileId)
    if (error) throw error
    return (data ?? []).map(mapProofCard)
  }

  async upsertProofCard(input: {
    id?: string
    profileId: string
    capability: string
    strength: 'strong' | 'moderate' | 'weak'
    safeClaim: string
    sourceType: ProofCard['sourceType']
    sourceReference?: string | null
    tags?: string[]
    verified?: boolean
    forbiddenClaims?: string[]
  }): Promise<ProofCard> {
    const row = {
      id: input.id,
      organization_id: this.orgId,
      profile_id: input.profileId,
      capability: input.capability,
      strength: input.strength,
      safe_claim: input.safeClaim,
      source_type: input.sourceType,
      source_reference: input.sourceReference ?? null,
      tags: input.tags ?? [],
      verified: input.verified ?? false,
      forbidden_claims: input.forbiddenClaims ?? [],
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await this.client
      .from('proof_cards')
      .upsert(row)
      .select('*')
      .single()
    if (error) throw error
    return mapProofCard(data as Row)
  }

  async deleteProofCard(id: string): Promise<void> {
    const { error } = await this.client.from('proof_cards').delete().eq('id', id)
    if (error) throw error
  }

  async getConversationState(leadId: string): Promise<ConversationState | null> {
    const { data, error } = await this.client
      .from('conversation_states')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapConversationState(data as Row)
  }

  async upsertConversationState(input: {
    leadId: string
    stage?: ConversationStage
    senderProfileId?: string | null
    lastReplyAt?: string | null
    lastStrategy?: string | null
    lastAngle?: string | null
    lastCta?: string | null
    followupCount?: number
    nextFollowupAt?: string | null
    wonAt?: string | null
    lostAt?: string | null
    lostReason?: string | null
    commercialState?: Record<string, unknown> | null
    lastSentAt?: string | null
    lastSentMessageId?: string | null
    memory?: import('@/lib/conversation/types').ConversationMemory | null
    composerDraft?: import('@/lib/conversation/types').ComposerDraft | null
  }): Promise<ConversationState> {
    const existing = await this.getConversationState(input.leadId)
    const previousStage = existing?.stage ?? 'new'
    const row = {
      id: existing?.id,
      organization_id: this.orgId,
      lead_id: input.leadId,
      stage: input.stage ?? existing?.stage ?? 'new',
      sender_profile_id: input.senderProfileId ?? existing?.senderProfileId ?? null,
      last_reply_at: input.lastReplyAt ?? existing?.lastReplyAt ?? null,
      last_strategy: input.lastStrategy ?? existing?.lastStrategy ?? null,
      last_angle: input.lastAngle ?? existing?.lastAngle ?? null,
      last_cta: input.lastCta ?? existing?.lastCta ?? null,
      followup_count: input.followupCount ?? existing?.followupCount ?? 0,
      next_followup_at: input.nextFollowupAt ?? existing?.nextFollowupAt ?? null,
      won_at: input.wonAt ?? existing?.wonAt ?? null,
      lost_at: input.lostAt ?? existing?.lostAt ?? null,
      lost_reason: input.lostReason ?? existing?.lostReason ?? null,
      // Merge: several writers (draft strategy, memory) share this object.
      commercial_state: input.commercialState
        ? { ...(existing?.commercialState ?? {}), ...input.commercialState }
        : existing?.commercialState ?? {},
      last_sent_at: input.lastSentAt ?? existing?.lastSentAt ?? null,
      last_sent_message_id: input.lastSentMessageId ?? existing?.lastSentMessageId ?? null,
      memory: input.memory ?? existing?.memory ?? null,
      composer_draft: input.composerDraft !== undefined ? input.composerDraft : existing?.composerDraft ?? null,
      updated_at: new Date().toISOString(),
    }
    let { data, error } = await this.client
      .from('conversation_states')
      .upsert(row, { onConflict: 'lead_id' })
      .select('*')
      .single()
    // Columns from newer migrations may not exist yet: drop them and retry,
    // so an unapplied migration degrades features instead of breaking sends.
    if (error && /memory|composer_draft|42703|PGRST204/i.test(error.message ?? '')) {
      // Pre-migration: keep memory and the draft inside commercial_state so
      // the conversation view still remembers them.
      const { memory: _m, composer_draft: _d, ...rest } = row
      const withoutConversationColumns = {
        ...rest,
        commercial_state: {
          ...(rest.commercial_state as Record<string, unknown>),
          [MEMORY_FALLBACK_KEY]: row.memory,
          [DRAFT_FALLBACK_KEY]: row.composer_draft,
        },
      }
      const retry = await this.client.from('conversation_states').upsert(withoutConversationColumns, { onConflict: 'lead_id' }).select('*').single()
      data = retry.data
      error = retry.error
      if (error && /commercial_state|42703|PGRST204/i.test(error.message ?? '')) {
        const { commercial_state: _c, ...legacyRow } = withoutConversationColumns
        const legacy = await this.client.from('conversation_states').upsert(legacyRow, { onConflict: 'lead_id' }).select('*').single()
        data = legacy.data
        error = legacy.error
      }
    }
    if (error) throw error

    const newState = mapConversationState(data as Row)

    // Emit CLIENT_REPLIED when stage transitions to 'replied' for the first time
    if (input.stage === 'replied' && previousStage !== 'replied') {
      try {
        await this.emitRelayEvent({
          eventType: 'CLIENT_REPLIED',
          entityType: 'lead',
          entityId: input.leadId,
          actorType: 'system',
          payload: {
            previousStage,
            newStage: 'replied',
          },
          source: 'app',
          sourceEventId: `client_replied:${input.leadId}`,
        })
      } catch {
        // Event emission must never break domain operations
      }
    }

    return newState
  }

  async addSalesMemory(input: {
    memoryType: SalesMemoryType
    content: string
    leadId?: string | null
    profileId?: string | null
    industry?: string | null
    leadType?: string | null
    channel?: string | null
    stage?: string | null
    outcome?: 'positive' | 'negative' | 'neutral' | null
  }): Promise<SalesMemory> {
    const { data, error } = await this.client
      .from('sales_memory')
      .insert({
        organization_id: this.orgId,
        memory_type: input.memoryType,
        content: input.content,
        lead_id: input.leadId ?? null,
        profile_id: input.profileId ?? null,
        industry: input.industry ?? null,
        lead_type: input.leadType ?? null,
        channel: input.channel ?? null,
        stage: input.stage ?? null,
        outcome: input.outcome ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return mapSalesMemory(data as Row)
  }

  async listSalesMemory(opts?: {
    memoryType?: SalesMemoryType
    profileId?: string | null
    industry?: string | null
    limit?: number
  }): Promise<SalesMemory[]> {
    let q = this.client
      .from('sales_memory')
      .select('*')
      .eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 50)
    if (opts?.memoryType) q = q.eq('memory_type', opts.memoryType)
    if (opts?.profileId) q = q.eq('profile_id', opts.profileId)
    if (opts?.industry) q = q.eq('industry', opts.industry)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []).map(mapSalesMemory)
  }

  async listRecentEdits(limit: number): Promise<Array<{ originalText: string; editedText: string; createdAt: string }>> {
    const { data, error } = await this.client
      .from('edit_learning')
      .select('original_text, edited_text, created_at')
      .eq('organization_id', this.orgId)
      .eq('rep_id', this.rep.id)
      .order('created_at', { ascending: false })
      .limit(Math.max(limit * 3, limit))
    if (error) return []
    return ((data ?? []) as Row[])
      .map((r) => ({
        originalText: String(r.original_text ?? ''),
        editedText: String(r.edited_text ?? ''),
        createdAt: String(r.created_at ?? ''),
      }))
      .filter((r) => r.originalText.trim() && r.originalText.trim() !== r.editedText.trim())
      .slice(0, limit)
  }

  async logEditLearning(input: {
    messageId: string | null
    originalText: string
    editedText: string
    editDistance: number
    lengthDelta: number
    greetingChanged: boolean
    ctaChanged: boolean
    proofRemoved: boolean
    madeShorter: boolean
    madeLonger: boolean
    formalityShift: 'more_formal' | 'less_formal' | 'same' | null
    sendDisposition?: import('@/lib/domain/types').SendDisposition | null
    rejectReasons?: import('@/lib/domain/types').SendFeedbackReason[]
  }): Promise<void> {
    const { error } = await this.client.from('edit_learning').insert({
      organization_id: this.orgId,
      rep_id: this.rep.id,
      message_id: input.messageId,
      original_text: input.originalText,
      edited_text: input.editedText,
      edit_distance: input.editDistance,
      length_delta: input.lengthDelta,
      greeting_changed: input.greetingChanged,
      cta_changed: input.ctaChanged,
      proof_removed: input.proofRemoved,
      made_shorter: input.madeShorter,
      made_longer: input.madeLonger,
      formality_shift: input.formalityShift,
      send_disposition: input.sendDisposition ?? null,
      reject_reasons: input.rejectReasons ?? [],
    })
    if (error && /send_disposition|reject_reasons|42703|PGRST204/i.test(error.message ?? '')) {
      const retry = await this.client.from('edit_learning').insert({
        organization_id: this.orgId,
        rep_id: this.rep.id,
        message_id: input.messageId,
        original_text: input.originalText,
        edited_text: input.editedText,
        edit_distance: input.editDistance,
        length_delta: input.lengthDelta,
        greeting_changed: input.greetingChanged,
        cta_changed: input.ctaChanged,
        proof_removed: input.proofRemoved,
        made_shorter: input.madeShorter,
        made_longer: input.madeLonger,
        formality_shift: input.formalityShift,
      })
      if (retry.error) throw retry.error
      return
    }
  }

  async updateLeadSenderProfile(leadId: string, senderProfileId: string | null): Promise<void> {
    const { error } = await this.client
      .from('leads')
      .update({ sender_profile_id: senderProfileId })
      .eq('id', leadId)
      .eq('owner_rep_id', this.rep.id)
    if (error) throw error
  }

  async captureProspect(input: {
    rawInput: string
    extractedName: string | null
    extractedCompany: string | null
    extractedTitle: string | null
    extractedLocation: string | null
    linkedinUrl: string | null
    companyUrl: string | null
    canonicalScore: number | null
    canonicalIntelligence: Record<string, unknown> | null
    scoreBreakdown: Record<string, unknown> | null
    revenueIdentityId: string | null
    senderProfileId: string | null
    /** Test/E2E/DEMO data is excluded from analytics by default (P0-2). */
    isTest?: boolean
  }): Promise<CapturedProspect> {
    const existing = await this.client
      .from('captured_prospects')
      .select('*')
      .eq('organization_id', this.orgId)
      .eq('owner_rep_id', this.rep.id)
      .eq('raw_input', input.rawInput)
      .eq('status', 'captured')
      .maybeSingle()

    if (existing.data) {
      return { ...this.mapCapturedProspect(existing.data as Row), isNewCapture: false }
    }

    const oppKey = opportunityKey(input.rawInput)
    const { data, error } = await this.client
      .from('captured_prospects')
      .insert({
        organization_id: this.orgId,
        owner_rep_id: this.rep.id,
        raw_input: input.rawInput,
        extracted_name: input.extractedName,
        extracted_company: input.extractedCompany,
        extracted_title: input.extractedTitle,
        extracted_location: input.extractedLocation,
        linkedin_url: input.linkedinUrl,
        company_url: input.companyUrl,
        canonical_score: input.canonicalScore,
        canonical_intelligence: input.canonicalIntelligence,
        score_breakdown: input.scoreBreakdown,
        revenue_identity_id: input.revenueIdentityId,
        sender_profile_id: input.senderProfileId,
        opportunity_key: oppKey,
        is_test: input.isTest === true,
        source_kind: input.isTest === true ? 'E2E' : 'PRODUCTION',
        status: 'captured',
      })
      .select('*')
      .single()
    if (error) throw error
    return { ...this.mapCapturedProspect(data as Row), isNewCapture: true }
  }

  /**
   * Award accountability credit for a genuine new prospect extraction/
   * capture — activity_type 'prospect_extracted'. Mirrors markContacted's
   * and markUpworkApplied's lookup-then-increment pattern exactly: find
   * every ACTIVE daily_targets row for this rep+activity, and call
   * record_activity_event for each. Non-fatal per-target and overall — this
   * must never block prospect analysis.
   *
   * Callers MUST only invoke this for a genuine new capture (see
   * CapturedProspect.isNewCapture), never for a reuse/cache hit — otherwise
   * re-analyzing (or "Try Another Angle" on) the same paste would
   * double-credit the same underlying action.
   */
  async recordProspectExtracted(revenueIdentityId?: string | null): Promise<void> {
    try {
      const { data: targets } = await this.client
        .from('daily_targets')
        .select('revenue_identity_id')
        .eq('rep_id', this.rep.id)
        .eq('activity_type', 'prospect_extracted')
        .eq('active', true)
      if (!targets || targets.length === 0) return

      for (const t of targets) {
        try {
          await this.client.rpc('record_activity_event', {
            p_rep_id: this.rep.id,
            p_identity_id: t.revenue_identity_id as string,
            p_activity_type: 'prospect_extracted',
            p_org_id: this.orgId,
          })
        } catch {
          // Non-fatal per-target
        }
      }

      // Bridge: canonical progress for Accountability OS (day_closes) is
      // deliberately NOT touched here — per the approved design, only
      // System A (daily_targets/daily_accountability) is being fixed for
      // extraction credit; System B (day_closes/record_canonical_progress)
      // is untouched.
    } catch {
      // Accountability increment must never block prospect capture/analysis
    }
  }

  async listCapturedProspects(): Promise<CapturedProspect[]> {
    const { data, error } = await this.client
      .from('captured_prospects')
      .select('*')
      .eq('organization_id', this.orgId)
      .eq('status', 'captured')
      .order('last_activity_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => this.mapCapturedProspect(r as Row))
  }

  async getCapturedProspect(id: string): Promise<CapturedProspect | null> {
    const { data, error } = await this.client
      .from('captured_prospects')
      .select('*')
      .eq('id', id)
      .eq('organization_id', this.orgId)
      .maybeSingle()
    if (error) throw error
    return data ? this.mapCapturedProspect(data as Row) : null
  }

  async updateCapturedProspectStatus(id: string, status: 'captured' | 'converted' | 'discarded', convertedLeadId?: string | null): Promise<void> {
    const { error } = await this.client
      .from('captured_prospects')
      .update({
        status,
        converted_lead_id: convertedLeadId ?? null,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organization_id', this.orgId)
    if (error) throw error
  }

  async updateLeadStatus(leadId: string, status: 'won' | 'lost'): Promise<void> {
    const { error } = await this.client
      .from('leads')
      .update({ status })
      .eq('id', leadId)
      .eq('owner_rep_id', this.rep.id)
    if (error) throw error
  }

  async updateLeadRevenueIdentity(leadId: string, revenueIdentityId: string): Promise<void> {
    const { error } = await this.client
      .from('leads')
      .update({ revenue_identity_id: revenueIdentityId })
      .eq('id', leadId)
      .eq('owner_rep_id', this.rep.id)
    if (error) throw error
  }

  getCurrentRepId(): string {
    return this.rep.id
  }


  async createContentJourneyEntry(input: {
    personaId: string
    eventType: string
    title: string
    description?: string
    eventDate?: string | null
    source?: string
  }): Promise<ContentJourneyEntry> {
    const { data, error } = await this.client
      .from('content_journey')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        event_type: input.eventType,
        title: input.title,
        description: input.description ?? '',
        event_date: input.eventDate ?? null,
        source: input.source ?? 'user_entry',
      })
      .select('*')
      .single()
    if (error) throw error
    return {
      id: data.id,
      organizationId: data.organization_id,
      personaId: data.persona_id,
      eventType: data.event_type,
      title: data.title,
      description: data.description,
      eventDate: data.event_date,
      source: data.source,
      createdAt: data.created_at,
    }
  }

  async listContentJourney(personaId: string, limit = 30): Promise<ContentJourneyEntry[]> {
    const { data, error } = await this.client
      .from('content_journey')
      .select('*')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      personaId: r.persona_id,
      eventType: r.event_type,
      title: r.title,
      description: r.description,
      eventDate: r.event_date,
      source: r.source,
      createdAt: r.created_at,
    }))
  }

  async deleteContentJourneyEntry(entryId: string): Promise<void> {
    const { error } = await this.client
      .from('content_journey')
      .delete()
      .eq('id', entryId)
      .eq('organization_id', this.orgId)
    if (error) throw error
  }


  async createContentQuickCapture(input: {
    personaId: string
    rawInput: string
    suggestedAngles: unknown[]
    status?: string
  }): Promise<ContentQuickCapture> {
    const { data, error } = await this.client
      .from('content_quick_captures')
      .insert({
        organization_id: this.orgId,
        persona_id: input.personaId,
        raw_input: input.rawInput,
        suggested_angles: input.suggestedAngles,
        status: input.status ?? 'pending',
      })
      .select('*')
      .single()
    if (error) throw error
    return {
      id: data.id,
      organizationId: data.organization_id,
      personaId: data.persona_id,
      rawInput: data.raw_input,
      suggestedAngles: (data.suggested_angles as QuickCaptureAngle[]) ?? [],
      status: data.status as 'pending' | 'used' | 'dismissed',
      createdAt: data.created_at,
    }
  }

  async listContentQuickCaptures(personaId: string, limit = 20): Promise<ContentQuickCapture[]> {
    const { data, error } = await this.client
      .from('content_quick_captures')
      .select('*')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      personaId: r.persona_id,
      rawInput: r.raw_input,
      suggestedAngles: (r.suggested_angles as QuickCaptureAngle[]) ?? [],
      status: r.status as 'pending' | 'used' | 'dismissed',
      createdAt: r.created_at,
    }))
  }

  async updateQuickCaptureStatus(captureId: string, status: string): Promise<void> {
    const { error } = await this.client
      .from('content_quick_captures')
      .update({ status })
      .eq('id', captureId)
      .eq('organization_id', this.orgId)
    if (error) throw error
  }

  // ==========================================================================
  // Relay Queue
  // ==========================================================================

  async getRelayQueueData() {
    const [owned, jobMessages, profiles] = await Promise.all([
      this.fetchLeadsWithMessages(),
      this.fetchUpworkMessagesForRep(),
      this.getAssignedProfiles(),
    ])

    const conversations = new Map<string, ConversationState>()
    const messagesByLead = new Map<string, Message[]>()

    for (const lead of owned) {
      const msgs = lead._messages ?? []
      messagesByLead.set(lead.id, msgs)
      if (lead._conversation) {
        conversations.set(lead.id, lead._conversation)
      }
    }

    const messagesByJob = new Map<string, UpworkMessage[]>()
    for (const msg of jobMessages) {
      const arr = messagesByJob.get(msg.jobId) ?? []
      arr.push(msg)
      messagesByJob.set(msg.jobId, arr)
    }

    return { conversations, messagesByLead, messagesByJob, assignedProfiles: profiles }
  }

  private async fetchLeadsWithMessages(): Promise<Array<Lead & { _messages: Message[]; _conversation: ConversationState | null }>> {
    const { data, error } = await this.client
      .from('leads')
      .select(`${LEAD_LIST_COLUMNS}, messages(*), conversation_states(*)`)
      .eq('owner_rep_id', this.rep.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r: Row) => ({
      ...mapLead(r),
      _messages: ((r.messages as Row[]) ?? []).map(mapMessage),
      _conversation: (r.conversation_states as Row[])?.[0]
        ? mapConversationState((r.conversation_states as Row[])[0])
        : null,
    }))
  }

  private async fetchUpworkMessagesForRep(): Promise<UpworkMessage[]> {
    const { data, error } = await this.client
      .from('upwork_messages')
      .select('*')
      .eq('rep_id', this.rep.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapUpworkMessage)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Revenue Identity OS
  // ═══════════════════════════════════════════════════════════════════════════

  private mapRevenueIdentity(r: Record<string, unknown>): RevenueIdentity {
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
      channel: (r.channel as RevenueIdentityChannel) ?? this.inferChannel(r.slug as string),
      status: (r.status as RevenueIdentityStatus) ?? 'active',
      sourceKind: (r.source_kind as string) ?? 'manual',
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }
  }

  private inferChannel(slug: string): RevenueIdentityChannel {
    const s = slug.toLowerCase()
    if (s.includes('upwork')) return 'upwork'
    if (s.includes('linkedin')) return 'linkedin'
    return 'other'
  }

  async listRevenueIdentitiesAdmin(): Promise<RevenueIdentity[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('revenue_identities').select('*').eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => this.mapRevenueIdentity(r as Record<string, unknown>))
  }

  async getRevenueIdentityAdmin(id: string): Promise<RevenueIdentity | null> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('revenue_identities').select('*').eq('id', id).eq('organization_id', this.orgId).maybeSingle()
    if (error) throw error
    return data ? this.mapRevenueIdentity(data as Record<string, unknown>) : null
  }

  async createRevenueIdentityAdmin(input: {
    slug: string; identityName: string; title?: string | null; positioning?: string | null;
    profileUrl?: string | null; skills?: string[]; expertise?: string[]; industries?: string[];
    technologies?: string[]; allowedFirstPersonClaims?: string[]; forbiddenClaims?: string[];
    channelRules?: Record<string, unknown>; voiceTone?: Record<string, unknown>;
    preferredOpportunityTypes?: string[]; proposalPositioning?: string | null;
    channel: RevenueIdentityChannel; profileId?: string | null;
  }): Promise<RevenueIdentity> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('revenue_identities')
      .insert({
        organization_id: this.orgId, slug: input.slug, identity_name: input.identityName,
        title: input.title ?? null, positioning: input.positioning ?? null, profile_url: input.profileUrl ?? null,
        skills: input.skills ?? [], expertise: input.expertise ?? [], industries: input.industries ?? [],
        technologies: input.technologies ?? [], allowed_first_person_claims: input.allowedFirstPersonClaims ?? [],
        forbidden_claims: input.forbiddenClaims ?? [], channel_rules: input.channelRules ?? {},
        voice_tone: input.voiceTone ?? {}, preferred_opportunity_types: input.preferredOpportunityTypes ?? [],
        proposal_positioning: input.proposalPositioning ?? null, profile_id: input.profileId ?? null,
        status: 'active', source_kind: 'manual',
      })
      .select('*').single()
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, revenue_identity_id: data.id,
      event_type: 'identity_created', detail: { identity_name: input.identityName, slug: input.slug },
    })
    return this.mapRevenueIdentity(data as Record<string, unknown>)
  }

  async updateRevenueIdentityAdmin(id: string, patches: Record<string, unknown>): Promise<RevenueIdentity> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const fMap: Record<string, string> = {
      slug: 'slug', identityName: 'identity_name', title: 'title', positioning: 'positioning',
      profileUrl: 'profile_url', skills: 'skills', expertise: 'expertise', industries: 'industries',
      technologies: 'technologies', allowedFirstPersonClaims: 'allowed_first_person_claims',
      forbiddenClaims: 'forbidden_claims', channelRules: 'channel_rules', voiceTone: 'voice_tone',
      preferredOpportunityTypes: 'preferred_opportunity_types', proposalPositioning: 'proposal_positioning', status: 'status',
    }
    for (const [key, dbField] of Object.entries(fMap)) {
      if (patches[key] !== undefined) update[dbField] = patches[key]
    }
    const { data, error } = await this.client
      .from('revenue_identities').update(update).eq('id', id).eq('organization_id', this.orgId).select('*').single()
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, revenue_identity_id: id,
      event_type: 'identity_edited', detail: { fields: Object.keys(patches) },
    })
    return this.mapRevenueIdentity(data as Record<string, unknown>)
  }

  async archiveRevenueIdentityAdmin(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client
      .from('revenue_identities').update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, revenue_identity_id: id,
      event_type: 'identity_archived', detail: {},
    })
  }

  async listIdentityAssignmentsAdmin(): Promise<IdentityAssignment[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('identity_assignments').select('*').eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string,
      revenueIdentityId: r.revenue_identity_id as string, repId: r.rep_id as string,
      assignedBy: (r.assigned_by as string) ?? null, createdAt: r.created_at as string,
    }))
  }

  async assignIdentityAdmin(identityId: string, repId: string): Promise<IdentityAssignment> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('identity_assignments')
      .upsert({ organization_id: this.orgId, revenue_identity_id: identityId, rep_id: repId, assigned_by: this.rep.id }, { onConflict: 'revenue_identity_id,rep_id' })
      .select('*').single()
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, revenue_identity_id: identityId,
      event_type: 'identity_assigned', detail: { rep_id: repId },
    })
    const assignment = { id: data.id as string, organizationId: data.organization_id as string, revenueIdentityId: data.revenue_identity_id as string, repId: data.rep_id as string, assignedBy: (data.assigned_by as string) ?? null, createdAt: data.created_at as string }
    await this.ensureDefaultDailyTargetsAdmin({ repId, revenueIdentityId: identityId })
    return assignment
  }

  async unassignIdentityAdmin(identityId: string, repId: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client
      .from('identity_assignments').delete()
      .eq('revenue_identity_id', identityId).eq('rep_id', repId).eq('organization_id', this.orgId)
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, revenue_identity_id: identityId,
      event_type: 'identity_unassigned', detail: { rep_id: repId },
    })
  }

  async listDailyTargetsAdmin(): Promise<DailyTarget[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('daily_targets').select('*').eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string, repId: r.rep_id as string,
      revenueIdentityId: r.revenue_identity_id as string, activityType: r.activity_type as ActivityType,
      targetCount: r.target_count as number, active: r.active as boolean,
      createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async createDailyTargetAdmin(input: { repId: string; revenueIdentityId: string; activityType: ActivityType; targetCount: number }): Promise<DailyTarget> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data: assigned } = await this.client
      .from('identity_assignments')
      .select('id')
      .eq('organization_id', this.orgId)
      .eq('rep_id', input.repId)
      .eq('revenue_identity_id', input.revenueIdentityId)
      .maybeSingle()
    if (!assigned) {
      throw new Error('REVENUE_IDENTITY_NOT_ASSIGNED_TO_REP: The selected Revenue Identity is not assigned to this Rep.')
    }
    const { data, error } = await this.client
      .from('daily_targets')
      .upsert({ organization_id: this.orgId, rep_id: input.repId, revenue_identity_id: input.revenueIdentityId, activity_type: input.activityType, target_count: input.targetCount, active: true, created_by: this.rep.id }, { onConflict: 'rep_id,revenue_identity_id,activity_type' })
      .select('*').single()
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, revenue_identity_id: input.revenueIdentityId,
      event_type: 'target_created', detail: { rep_id: input.repId, activity_type: input.activityType, target_count: input.targetCount },
    })
    return { id: data.id as string, organizationId: data.organization_id as string, repId: data.rep_id as string, revenueIdentityId: data.revenue_identity_id as string, activityType: data.activity_type as ActivityType, targetCount: data.target_count as number, active: data.active as boolean, createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string }
  }

  async ensureDefaultDailyTargetsAdmin(input: { repId: string; revenueIdentityId: string }): Promise<DailyTarget[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const identity = await this.getRevenueIdentityAdmin(input.revenueIdentityId)
    if (!identity) throw new Error('Identity not found')

    const { data: existing, error } = await this.client
      .from('daily_targets')
      .select('activity_type')
      .eq('organization_id', this.orgId)
      .eq('rep_id', input.repId)
      .eq('revenue_identity_id', input.revenueIdentityId)
    if (error) throw error

    const have = new Set((existing ?? []).map((row) => row.activity_type as ActivityType))
    const created: DailyTarget[] = []
    for (const row of defaultTargetsForChannel(identity.channel)) {
      if (have.has(row.activityType)) continue
      created.push(await this.createDailyTargetAdmin({
        repId: input.repId,
        revenueIdentityId: input.revenueIdentityId,
        activityType: row.activityType,
        targetCount: row.targetCount,
      }))
    }
    return created
  }

  async backfillDefaultDailyTargetsAdmin(): Promise<{ created: number; assignments: number }> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const assignments = await this.listIdentityAssignmentsAdmin()
    let created = 0
    for (const assignment of assignments) {
      const rows = await this.ensureDefaultDailyTargetsAdmin({
        repId: assignment.repId,
        revenueIdentityId: assignment.revenueIdentityId,
      })
      created += rows.length
    }
    return { created, assignments: assignments.length }
  }

  async updateDailyTargetAdmin(id: string, patches: { targetCount?: number; active?: boolean }): Promise<DailyTarget> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patches.targetCount !== undefined) update.target_count = patches.targetCount
    if (patches.active !== undefined) update.active = patches.active
    const { data, error } = await this.client
      .from('daily_targets').update(update).eq('id', id).eq('organization_id', this.orgId)
      .select('*').single()
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, event_type: 'target_changed',
      detail: { target_id: id, changes: update },
    })
    return { id: data.id as string, organizationId: data.organization_id as string, repId: data.rep_id as string, revenueIdentityId: data.revenue_identity_id as string, activityType: data.activity_type as ActivityType, targetCount: data.target_count as number, active: data.active as boolean, createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string }
  }

  async deleteDailyTargetAdmin(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client.from('daily_targets').delete().eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
    await this.client.from('accountability_audit_log').insert({
      organization_id: this.orgId, rep_id: this.rep.id, event_type: 'target_deleted', detail: { target_id: id },
    })
  }

  async getTeamAccountabilityAdmin(date?: string): Promise<TeamAccountabilityView> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const targetDate = date ?? new Date().toISOString().slice(0, 10)
    const { data: accountability } = await this.client
      .from('daily_accountability').select('*').eq('organization_id', this.orgId).eq('target_date', targetDate)
    const items = (accountability ?? []) as Record<string, unknown>[]
    const { data: repRows } = await this.client.from('reps').select('id, name').eq('organization_id', this.orgId)
    const repMap = new Map((repRows ?? []).map((r) => [r.id as string, r.name as string]))
    const byRep = new Map<string, DailyAccountability[]>()
    for (const a of items) {
      const list = byRep.get(a.rep_id as string) ?? []
      list.push({
        id: a.id as string, organizationId: a.organization_id as string, repId: a.rep_id as string,
        revenueIdentityId: a.revenue_identity_id as string, activityType: a.activity_type as ActivityType,
        targetDate: a.target_date as string, targetCount: a.target_count as number,
        completedCount: a.completed_count as number, status: a.status as AccountabilityStatus,
        closed: a.closed as boolean, createdAt: a.created_at as string, updatedAt: a.updated_at as string,
      })
      byRep.set(a.rep_id as string, list)
    }
    const summaries = []
    for (const [repId, accs] of byRep.entries()) {
      const totalTarget = accs.reduce((s, a) => s + a.targetCount, 0)
      const totalCompleted = accs.reduce((s, a) => s + a.completedCount, 0)
      summaries.push({
        repId, repName: repMap.get(repId) ?? 'Unknown', totalTarget, totalCompleted,
        remaining: Math.max(0, totalTarget - totalCompleted),
        status: (totalCompleted >= totalTarget ? 'completed' : (accs.some((a) => a.status === 'at_risk') ? 'at_risk' : 'on_track')) as AccountabilityStatus,
        byIdentity: accs.map((a) => ({
          identityId: a.revenueIdentityId, identityName: '', channel: 'other' as RevenueIdentityChannel,
           activityType: a.activityType, target: a.targetCount, completed: a.completedCount,
           remaining: Math.max(0, a.targetCount - a.completedCount), status: a.status as AccountabilityStatus,
        })),
      })
    }
    return { date: targetDate, isWorkingDay: true, summaries, consecutiveMisses: [], requiresAttention: [] }
  }

  async getCommandCenterAdmin(): Promise<CommandCenterView> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const today = new Date().toISOString().slice(0, 10)
    const { data: targets } = await this.client.from('daily_targets').select('*').eq('organization_id', this.orgId).eq('active', true)
    const { data: accountability } = await this.client.from('daily_accountability').select('*').eq('organization_id', this.orgId).eq('target_date', today)
    const { data: identities } = await this.client.from('revenue_identities').select('id, identity_name, status').eq('organization_id', this.orgId).eq('status', 'active')
    const { data: reps } = await this.client.from('reps').select('id, name').eq('organization_id', this.orgId)
    const targetList = (targets ?? []) as Record<string, unknown>[]
    const accList = (accountability ?? []) as Record<string, unknown>[]
    const accMap = new Map(accList.map((a) => [`${a.rep_id}:${a.revenue_identity_id}:${a.activity_type}`, a]))
    let totalTargets = 0, totalCompleted = 0, onTrack = 0, behind = 0, completed = 0
    for (const rep of reps ?? []) {
      const repTargets = targetList.filter((t) => t.rep_id === rep.id)
      if (repTargets.length === 0) continue
      let repTotal = 0, repDone = 0
      for (const t of repTargets) {
        const key = `${rep.id}:${t.revenue_identity_id}:${t.activity_type}`
        const acc = accMap.get(key)
        repTotal += t.target_count as number
        repDone += (acc?.completed_count as number) ?? 0
      }
      totalTargets += repTotal
      totalCompleted += repDone
      if (repDone >= repTotal) completed++
      else if (repDone > 0) behind++
      else onTrack++
    }
    return {
      date: today, isWorkingDay: true, totalReps: (reps ?? []).length,
      onTrackReps: onTrack, behindReps: behind, completedReps: completed, missedReps: 0,
      activeIdentities: (identities ?? []).length, totalTargetsToday: totalTargets, totalCompletedToday: totalCompleted,
      consecutiveMisses: [], attentionItems: [],
      identityPerformance: (identities ?? []).map((i) => ({
        identityId: i.id as string, identityName: i.identity_name as string,
        channel: 'other' as RevenueIdentityChannel, status: 'active' as const,
        assignedReps: [], totalTarget: 0, totalCompleted: accList.filter((a) => a.revenue_identity_id === i.id).reduce((s, a) => s + (a.completed_count as number), 0),
      })),
    }
  }

  async listMyAssignedIdentities(): Promise<RevenueIdentityWithAssignment[]> {
    const { data, error } = await this.client
      .from('identity_assignments').select('id, assigned_by, created_at, identity:revenue_identities(*)')
      .eq('rep_id', this.rep.id).eq('organization_id', this.orgId).order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((a) => {
      const identity = a.identity as unknown as Record<string, unknown>
      return { ...this.mapRevenueIdentity(identity), assignmentId: a.id as string, assignedBy: (a.assigned_by as string) ?? null, assignedAt: a.created_at as string }
    })
  }

  async getMyTodayAccountability(): Promise<import('@/lib/domain/types').RepTodayView> {
    return this.getRepTodayAccountability(this.rep.id)
  }

  async getRepTodayAccountability(repId: string): Promise<import('@/lib/domain/types').RepTodayView> {
    const today = new Date().toISOString().slice(0, 10)
    const isSelf = repId === this.rep.id
    const repName = isSelf ? this.rep.name : (await this.getRepInfo(repId))?.name ?? this.rep.name
    const { data: repRow } = isSelf
      ? { data: null }
      : await this.client.from('reps').select('timezone').eq('id', repId).eq('organization_id', this.orgId).maybeSingle()
    const timezone = isSelf ? (this.rep.timezone ?? 'UTC') : ((repRow?.timezone as string) ?? 'UTC')
    const { data: assignments } = await this.client
      .from('identity_assignments').select('id, revenue_identity_id, assigned_by, created_at')
      .eq('rep_id', repId).eq('organization_id', this.orgId)
    if (!assignments || assignments.length === 0) {
      return { repId, repName, timezone, isWorkingDay: true, totalTarget: 0, totalCompleted: 0, totalRemaining: 0, overallStatus: 'on_track', assignedIdentities: [], notifications: [] }
    }
    const identityIds = assignments.map((a) => a.revenue_identity_id as string)
    const { data: targets } = await this.client.from('daily_targets').select('*').eq('rep_id', repId).in('revenue_identity_id', identityIds).eq('active', true)
    const { data: accountability } = await this.client.from('daily_accountability').select('*').eq('rep_id', repId).eq('target_date', today).eq('organization_id', this.orgId)
    const targetList = (targets ?? []) as Record<string, unknown>[]
    const accMap = new Map(((accountability ?? []) as Record<string, unknown>[]).map((a) => [`${a.revenue_identity_id}:${a.activity_type}`, a]))
    let totalTarget = 0, totalCompleted = 0
    const identityViews = await Promise.all(assignments.map(async (a) => {
      const idTargets = targetList.filter((t) => t.revenue_identity_id === a.revenue_identity_id)
      const { data: identityRows } = await this.client.from('revenue_identities').select('*').eq('id', a.revenue_identity_id).maybeSingle()
      const identity = identityRows ? this.mapRevenueIdentity(identityRows as Record<string, unknown>) : null
      const targetViews = idTargets.map((t) => {
        const key = `${t.revenue_identity_id}:${t.activity_type}`
        const acc = accMap.get(key)
        const completed = (acc?.completed_count as number) ?? 0
        totalTarget += t.target_count as number
        totalCompleted += completed
        return { targetId: t.id as string, activityType: t.activity_type as ActivityType, targetCount: t.target_count as number, completedCount: completed, remaining: Math.max(0, (t.target_count as number) - completed), status: ((acc?.status as AccountabilityStatus) ?? 'on_track'), accountabilityId: (acc?.id as string) ?? null }
      })
      return { assignmentId: a.id as string, identity: identity!, targets: targetViews }
    }))
    return {
      repId, repName, timezone, isWorkingDay: true,
      totalTarget, totalCompleted, totalRemaining: Math.max(0, totalTarget - totalCompleted),
      overallStatus: totalCompleted >= totalTarget ? 'completed' : 'on_track',
      assignedIdentities: identityViews, notifications: [],
    }
  }

  async listAccountabilityNotifications(): Promise<AppNotification[]> {
    const { data, error } = await this.client
      .from('notifications').select('*').eq('recipient_id', this.rep.id).eq('organization_id', this.orgId)
      .order('created_at', { ascending: false }).limit(50)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string, recipientId: r.recipient_id as string,
      notificationType: r.notification_type as AppNotification['notificationType'], title: r.title as string,
      body: r.body as string, link: (r.link as string) ?? null, dedupeKey: r.dedupe_key as string,
      read: r.read as boolean, createdAt: r.created_at as string,
    }))
  }

  async markAccountabilityNotificationRead(id: string): Promise<void> {
    const { error } = await this.client.from('notifications').update({ read: true }).eq('id', id).eq('recipient_id', this.rep.id)
    if (error) throw error
  }

  async listAuditLogAdmin(limit = 100): Promise<AuditLogEntry[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('accountability_audit_log').select('*').eq('organization_id', this.orgId)
      .order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string, repId: (r.rep_id as string) ?? null,
      revenueIdentityId: (r.revenue_identity_id as string) ?? null, eventType: r.event_type as string,
      detail: (r.detail as Record<string, unknown>) ?? {}, createdAt: r.created_at as string,
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Accountability OS
  // ═══════════════════════════════════════════════════════════════════════════

  async listAccountabilityTemplates(): Promise<import('@/lib/domain/types').AccountabilityTemplate[]> {
    const { data, error } = await this.client
      .from('accountability_templates').select('*').eq('organization_id', this.orgId).order('name')
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string, name: r.name as string,
      qualifiedProspects: r.qualified_prospects as number, connections: r.connections as number,
      firstDms: r.first_dms as number, emails: r.emails as number, followups: r.followups as number,
      dueRepliesPct: r.due_replies_pct as number, meaningfulTouches: r.meaningful_touches as number,
      loggingCompletenessPct: r.logging_completeness_pct as number, isDefault: r.is_default as boolean,
      createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async getAccountabilityTemplate(id: string): Promise<import('@/lib/domain/types').AccountabilityTemplate | null> {
    const { data, error } = await this.client
      .from('accountability_templates').select('*').eq('id', id).eq('organization_id', this.orgId).maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, organizationId: data.organization_id as string, name: data.name as string,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number, isDefault: data.is_default as boolean,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async createAccountabilityTemplate(input: {
    name: string; qualifiedProspects: number; connections: number; firstDms: number;
    emails: number; followups: number; dueRepliesPct: number; meaningfulTouches: number;
    loggingCompletenessPct: number; isDefault?: boolean
  }): Promise<import('@/lib/domain/types').AccountabilityTemplate> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('accountability_templates')
      .insert({
        organization_id: this.orgId, name: input.name,
        qualified_prospects: input.qualifiedProspects, connections: input.connections,
        first_dms: input.firstDms, emails: input.emails, followups: input.followups,
        due_replies_pct: input.dueRepliesPct, meaningful_touches: input.meaningfulTouches,
        logging_completeness_pct: input.loggingCompletenessPct, is_default: input.isDefault ?? false,
        created_by: this.rep.id,
      })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string, name: data.name as string,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number, isDefault: data.is_default as boolean,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async updateAccountabilityTemplate(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').AccountabilityTemplate> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('accountability_templates').update(patches).eq('id', id).eq('organization_id', this.orgId)
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string, name: data.name as string,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number, isDefault: data.is_default as boolean,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async deleteAccountabilityTemplate(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client
      .from('accountability_templates').delete().eq('id', id).eq('organization_id', this.orgId)
    if (error) throw error
  }

  async getActiveContract(identityId: string): Promise<import('@/lib/domain/types').RevenueIdentityContract | null> {
    const { data, error } = await this.client
      .from('revenue_identity_contracts')
      .select('*')
      .eq('revenue_identity_id', identityId)
      .eq('status', 'active')
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, revenueIdentityId: data.revenue_identity_id as string,
      templateId: (data.template_id as string) ?? null, annualRevenueTarget: data.annual_revenue_target as number,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number,
      effectiveFrom: data.effective_from as string, effectiveTo: (data.effective_to as string) ?? null,
      status: data.status as import('@/lib/domain/types').ContractStatus, version: data.version as number,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async getDailyProgress(personId: string, identityId: string): Promise<import('@/lib/domain/types').DailyProgress | null> {
    const contract = await this.getActiveContract(identityId)
    if (!contract) return null

    const today = new Date().toISOString().slice(0, 10)
    const { data: dayClose } = await this.client
      .from('day_closes')
      .select('*')
      .eq('person_id', personId)
      .eq('revenue_identity_id', identityId)
      .eq('date', today)
      .maybeSingle()

    const snapshot = (dayClose?.completion_snapshot ?? {}) as Record<string, number>
    const allocations = await this.listContractAllocations(contract.id)
    const myAlloc = allocations.find((a) => a.personId === personId)
    const pct = (myAlloc?.allocationPct ?? (allocations.length === 0 ? 100 : 0)) / 100

    const qp = Math.round(contract.qualifiedProspects * pct)
    const conn = Math.round(contract.connections * pct)
    const fd = Math.round(contract.firstDms * pct)
    const em = Math.round(contract.emails * pct)
    const fu = Math.round(contract.followups * pct)
    const mt = Math.round(contract.meaningfulTouches * pct)

    return {
      qualifiedProspects: { completed: snapshot.qualifiedProspects ?? 0, target: qp, remaining: Math.max(0, qp - (snapshot.qualifiedProspects ?? 0)) },
      connections: { completed: snapshot.connections ?? 0, target: conn, remaining: Math.max(0, conn - (snapshot.connections ?? 0)) },
      firstDms: { completed: snapshot.firstDms ?? 0, target: fd, remaining: Math.max(0, fd - (snapshot.firstDms ?? 0)) },
      emails: { completed: snapshot.emails ?? 0, target: em, remaining: Math.max(0, em - (snapshot.emails ?? 0)) },
      followups: { completed: snapshot.followups ?? 0, target: fu, remaining: Math.max(0, fu - (snapshot.followups ?? 0)) },
      dueReplies: { completed: snapshot.dueReplies ?? 0, target: contract.dueRepliesPct, remaining: Math.max(0, contract.dueRepliesPct - (snapshot.dueReplies ?? 0)) },
      meaningfulTouches: { completed: snapshot.meaningfulTouches ?? 0, target: mt, remaining: Math.max(0, mt - (snapshot.meaningfulTouches ?? 0)) },
      logging: { completed: snapshot.logging ?? 0, target: contract.loggingCompletenessPct, remaining: Math.max(0, contract.loggingCompletenessPct - (snapshot.logging ?? 0)) },
    }
  }

  async getContractById(contractId: string): Promise<import('@/lib/domain/types').RevenueIdentityContract | null> {
    const { data, error } = await this.client
      .from('revenue_identity_contracts').select('*').eq('id', contractId).maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, revenueIdentityId: data.revenue_identity_id as string,
      templateId: (data.template_id as string) ?? null, annualRevenueTarget: data.annual_revenue_target as number,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number,
      effectiveFrom: data.effective_from as string, effectiveTo: (data.effective_to as string) ?? null,
      status: data.status as import('@/lib/domain/types').ContractStatus, version: data.version as number,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async createContract(input: {
    revenueIdentityId: string; templateId?: string | null; annualRevenueTarget?: number;
    qualifiedProspects?: number; connections?: number; firstDms?: number; emails?: number;
    followups?: number; dueRepliesPct?: number; meaningfulTouches?: number;
    loggingCompletenessPct?: number; effectiveFrom?: string
  }): Promise<import('@/lib/domain/types').RevenueIdentityContract> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('revenue_identity_contracts')
      .insert({
        revenue_identity_id: input.revenueIdentityId,
        template_id: input.templateId ?? null,
        annual_revenue_target: input.annualRevenueTarget ?? 100000,
        qualified_prospects: input.qualifiedProspects ?? 50,
        connections: input.connections ?? 25,
        first_dms: input.firstDms ?? 30,
        emails: input.emails ?? 30,
        followups: input.followups ?? 25,
        due_replies_pct: input.dueRepliesPct ?? 100,
        meaningful_touches: input.meaningfulTouches ?? 90,
        logging_completeness_pct: input.loggingCompletenessPct ?? 100,
        effective_from: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        status: 'active', version: 1, created_by: this.rep.id,
      })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, revenueIdentityId: data.revenue_identity_id as string,
      templateId: (data.template_id as string) ?? null, annualRevenueTarget: data.annual_revenue_target as number,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number,
      effectiveFrom: data.effective_from as string, effectiveTo: (data.effective_to as string) ?? null,
      status: data.status as import('@/lib/domain/types').ContractStatus, version: data.version as number,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async updateContract(contractId: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RevenueIdentityContract> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('revenue_identity_contracts').update(patches).eq('id', contractId)
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, revenueIdentityId: data.revenue_identity_id as string,
      templateId: (data.template_id as string) ?? null, annualRevenueTarget: data.annual_revenue_target as number,
      qualifiedProspects: data.qualified_prospects as number, connections: data.connections as number,
      firstDms: data.first_dms as number, emails: data.emails as number, followups: data.followups as number,
      dueRepliesPct: data.due_replies_pct as number, meaningfulTouches: data.meaningful_touches as number,
      loggingCompletenessPct: data.logging_completeness_pct as number,
      effectiveFrom: data.effective_from as string, effectiveTo: (data.effective_to as string) ?? null,
      status: data.status as import('@/lib/domain/types').ContractStatus, version: data.version as number,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async supersedeContract(contractId: string, effectiveTo: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client
      .from('revenue_identity_contracts')
      .update({ status: 'superseded', effective_to: effectiveTo })
      .eq('id', contractId)
    if (error) throw error
  }

  async listContractAllocations(contractId: string): Promise<import('@/lib/domain/types').ContractAllocation[]> {
    const { data, error } = await this.client
      .from('contract_allocations').select('*').eq('contract_id', contractId)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, contractId: r.contract_id as string, personId: r.person_id as string,
      allocationPct: r.allocation_pct as number, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async setContractAllocations(contractId: string, allocations: { personId: string; allocationPct: number }[]): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    await this.client.from('contract_allocations').delete().eq('contract_id', contractId)
    if (allocations.length === 0) return
    const rows = allocations.map((a) => ({
      contract_id: contractId, person_id: a.personId, allocation_pct: a.allocationPct,
    }))
    const { error } = await this.client.from('contract_allocations').insert(rows)
    if (error) throw error
  }

  async getPersonAllocations(personId: string): Promise<import('@/lib/domain/types').ContractAllocation[]> {
    const { data, error } = await this.client
      .from('contract_allocations').select('*').eq('person_id', personId)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, contractId: r.contract_id as string, personId: r.person_id as string,
      allocationPct: r.allocation_pct as number, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async getDayClose(personId: string, identityId: string, date: string): Promise<import('@/lib/domain/types').DayClose | null> {
    const { data, error } = await this.client
      .from('day_closes').select('*')
      .eq('person_id', personId).eq('revenue_identity_id', identityId).eq('date', date)
      .maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, date: data.date as string,
      status: data.status as import('@/lib/domain/types').DayCloseStatus,
      completionSnapshot: (data.completion_snapshot as Record<string, unknown>) ?? {},
      exceptionReason: (data.exception_reason as import('@/lib/domain/types').ExceptionReason) ?? null,
      exceptionNote: (data.exception_note as string) ?? null,
      reviewedBy: (data.reviewed_by as string) ?? null, reviewedAt: (data.reviewed_at as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async getDayCloseById(id: string): Promise<import('@/lib/domain/types').DayClose | null> {
    const { data, error } = await this.client
      .from('day_closes').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, date: data.date as string,
      status: data.status as import('@/lib/domain/types').DayCloseStatus,
      completionSnapshot: (data.completion_snapshot as Record<string, unknown>) ?? {},
      exceptionReason: (data.exception_reason as import('@/lib/domain/types').ExceptionReason) ?? null,
      exceptionNote: (data.exception_note as string) ?? null,
      reviewedBy: (data.reviewed_by as string) ?? null, reviewedAt: (data.reviewed_at as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async createDayClose(input: {
    personId: string; revenueIdentityId: string; contractId?: string | null; date: string;
    status?: import('@/lib/domain/types').DayCloseStatus; completionSnapshot?: Record<string, unknown>
  }): Promise<import('@/lib/domain/types').DayClose> {
    const { data, error } = await this.client
      .from('day_closes')
      .insert({
        organization_id: this.orgId, person_id: input.personId,
        revenue_identity_id: input.revenueIdentityId, contract_id: input.contractId ?? null,
        date: input.date, status: input.status ?? 'not_started',
        completion_snapshot: input.completionSnapshot ?? {},
      })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, date: data.date as string,
      status: data.status as import('@/lib/domain/types').DayCloseStatus,
      completionSnapshot: (data.completion_snapshot as Record<string, unknown>) ?? {},
      exceptionReason: (data.exception_reason as import('@/lib/domain/types').ExceptionReason) ?? null,
      exceptionNote: (data.exception_note as string) ?? null,
      reviewedBy: (data.reviewed_by as string) ?? null, reviewedAt: (data.reviewed_at as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async updateDayClose(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').DayClose> {
    const { data, error } = await this.client
      .from('day_closes').update(patches).eq('id', id).select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, date: data.date as string,
      status: data.status as import('@/lib/domain/types').DayCloseStatus,
      completionSnapshot: (data.completion_snapshot as Record<string, unknown>) ?? {},
      exceptionReason: (data.exception_reason as import('@/lib/domain/types').ExceptionReason) ?? null,
      exceptionNote: (data.exception_note as string) ?? null,
      reviewedBy: (data.reviewed_by as string) ?? null, reviewedAt: (data.reviewed_at as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async listDayCloses(personId: string, identityId?: string, startDate?: string, endDate?: string): Promise<import('@/lib/domain/types').DayClose[]> {
    let query = this.client.from('day_closes').select('*').eq('person_id', personId)
    if (identityId) query = query.eq('revenue_identity_id', identityId)
    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)
    const { data, error } = await query.order('date', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string,
      personId: r.person_id as string, revenueIdentityId: r.revenue_identity_id as string,
      contractId: (r.contract_id as string) ?? null, date: r.date as string,
      status: r.status as import('@/lib/domain/types').DayCloseStatus,
      completionSnapshot: (r.completion_snapshot as Record<string, unknown>) ?? {},
      exceptionReason: (r.exception_reason as import('@/lib/domain/types').ExceptionReason) ?? null,
      exceptionNote: (r.exception_note as string) ?? null,
      reviewedBy: (r.reviewed_by as string) ?? null, reviewedAt: (r.reviewed_at as string) ?? null,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async listTeamDayCloses(date: string): Promise<import('@/lib/domain/types').DayClose[]> {
    const { data, error } = await this.client
      .from('day_closes').select('*').eq('organization_id', this.orgId).eq('date', date)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string,
      personId: r.person_id as string, revenueIdentityId: r.revenue_identity_id as string,
      contractId: (r.contract_id as string) ?? null, date: r.date as string,
      status: r.status as import('@/lib/domain/types').DayCloseStatus,
      completionSnapshot: (r.completion_snapshot as Record<string, unknown>) ?? {},
      exceptionReason: (r.exception_reason as import('@/lib/domain/types').ExceptionReason) ?? null,
      exceptionNote: (r.exception_note as string) ?? null,
      reviewedBy: (r.reviewed_by as string) ?? null, reviewedAt: (r.reviewed_at as string) ?? null,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async getMonthlyReview(personId: string, identityId: string, month: string): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview | null> {
    const { data, error } = await this.client
      .from('monthly_accountability_reviews').select('*')
      .eq('person_id', personId).eq('revenue_identity_id', identityId).eq('month', month)
      .maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, month: data.month as string,
      executionSnapshot: (data.execution_snapshot as Record<string, unknown>) ?? {},
      qualitySnapshot: (data.quality_snapshot as Record<string, unknown>) ?? {},
      outcomeSnapshot: (data.outcome_snapshot as Record<string, unknown>) ?? {},
      consistencySnapshot: (data.consistency_snapshot as Record<string, unknown>) ?? {},
      reviewStatus: data.review_status as import('@/lib/domain/types').ReviewStatus,
      managerNote: (data.manager_note as string) ?? null, adminNote: (data.admin_note as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async createMonthlyReview(input: {
    personId: string; revenueIdentityId: string; contractId?: string | null; month: string;
    executionSnapshot?: Record<string, unknown>; qualitySnapshot?: Record<string, unknown>;
    outcomeSnapshot?: Record<string, unknown>; consistencySnapshot?: Record<string, unknown>
  }): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('monthly_accountability_reviews')
      .insert({
        organization_id: this.orgId, person_id: input.personId,
        revenue_identity_id: input.revenueIdentityId, contract_id: input.contractId ?? null,
        month: input.month,
        execution_snapshot: input.executionSnapshot ?? {},
        quality_snapshot: input.qualitySnapshot ?? {},
        outcome_snapshot: input.outcomeSnapshot ?? {},
        consistency_snapshot: input.consistencySnapshot ?? {},
        review_status: 'pending',
      })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, month: data.month as string,
      executionSnapshot: (data.execution_snapshot as Record<string, unknown>) ?? {},
      qualitySnapshot: (data.quality_snapshot as Record<string, unknown>) ?? {},
      outcomeSnapshot: (data.outcome_snapshot as Record<string, unknown>) ?? {},
      consistencySnapshot: (data.consistency_snapshot as Record<string, unknown>) ?? {},
      reviewStatus: data.review_status as import('@/lib/domain/types').ReviewStatus,
      managerNote: (data.manager_note as string) ?? null, adminNote: (data.admin_note as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async updateMonthlyReview(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('monthly_accountability_reviews').update(patches).eq('id', id).select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, revenueIdentityId: data.revenue_identity_id as string,
      contractId: (data.contract_id as string) ?? null, month: data.month as string,
      executionSnapshot: (data.execution_snapshot as Record<string, unknown>) ?? {},
      qualitySnapshot: (data.quality_snapshot as Record<string, unknown>) ?? {},
      outcomeSnapshot: (data.outcome_snapshot as Record<string, unknown>) ?? {},
      consistencySnapshot: (data.consistency_snapshot as Record<string, unknown>) ?? {},
      reviewStatus: data.review_status as import('@/lib/domain/types').ReviewStatus,
      managerNote: (data.manager_note as string) ?? null, adminNote: (data.admin_note as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async listMonthlyReviews(month: string): Promise<import('@/lib/domain/types').MonthlyAccountabilityReview[]> {
    const { data, error } = await this.client
      .from('monthly_accountability_reviews').select('*')
      .eq('organization_id', this.orgId).eq('month', month)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string,
      personId: r.person_id as string, revenueIdentityId: r.revenue_identity_id as string,
      contractId: (r.contract_id as string) ?? null, month: r.month as string,
      executionSnapshot: (r.execution_snapshot as Record<string, unknown>) ?? {},
      qualitySnapshot: (r.quality_snapshot as Record<string, unknown>) ?? {},
      outcomeSnapshot: (r.outcome_snapshot as Record<string, unknown>) ?? {},
      consistencySnapshot: (r.consistency_snapshot as Record<string, unknown>) ?? {},
      reviewStatus: r.review_status as import('@/lib/domain/types').ReviewStatus,
      managerNote: (r.manager_note as string) ?? null, adminNote: (r.admin_note as string) ?? null,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async listRewardPolicies(): Promise<import('@/lib/domain/types').RewardPolicy[]> {
    const { data, error } = await this.client
      .from('reward_policies').select('*').eq('organization_id', this.orgId).order('name')
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string, name: r.name as string,
      tier: r.tier as import('@/lib/domain/types').RewardTier,
      criteria: (r.criteria as Record<string, unknown>) ?? {},
      rewardType: r.reward_type as import('@/lib/domain/types').RewardType,
      description: (r.description as string) ?? null, enabled: r.enabled as boolean,
      createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async createRewardPolicy(input: {
    name: string; tier: import('@/lib/domain/types').RewardTier; criteria: Record<string, unknown>;
    rewardType: import('@/lib/domain/types').RewardType; description?: string | null
  }): Promise<import('@/lib/domain/types').RewardPolicy> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('reward_policies')
      .insert({
        organization_id: this.orgId, name: input.name, tier: input.tier,
        criteria: input.criteria, reward_type: input.rewardType,
        description: input.description ?? null, enabled: true, created_by: this.rep.id,
      })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string, name: data.name as string,
      tier: data.tier as import('@/lib/domain/types').RewardTier,
      criteria: (data.criteria as Record<string, unknown>) ?? {},
      rewardType: data.reward_type as import('@/lib/domain/types').RewardType,
      description: (data.description as string) ?? null, enabled: data.enabled as boolean,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async updateRewardPolicy(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RewardPolicy> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('reward_policies').update(patches).eq('id', id).select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string, name: data.name as string,
      tier: data.tier as import('@/lib/domain/types').RewardTier,
      criteria: (data.criteria as Record<string, unknown>) ?? {},
      rewardType: data.reward_type as import('@/lib/domain/types').RewardType,
      description: (data.description as string) ?? null, enabled: data.enabled as boolean,
      createdBy: (data.created_by as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async deleteRewardPolicy(id: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { error } = await this.client.from('reward_policies').delete().eq('id', id)
    if (error) throw error
  }

  async listRewardEligibility(reviewId: string): Promise<import('@/lib/domain/types').RewardEligibility[]> {
    const { data, error } = await this.client
      .from('reward_eligibility').select('*').eq('monthly_review_id', reviewId)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, monthlyReviewId: r.monthly_review_id as string,
      policyId: r.policy_id as string, status: r.status as import('@/lib/domain/types').RewardEligibilityStatus,
      reasonSnapshot: (r.reason_snapshot as Record<string, unknown>) ?? {},
      approvedBy: (r.approved_by as string) ?? null, approvedAt: (r.approved_at as string) ?? null,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async createRewardEligibility(input: {
    monthlyReviewId: string; policyId: string; reasonSnapshot?: Record<string, unknown>
  }): Promise<import('@/lib/domain/types').RewardEligibility> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('reward_eligibility')
      .insert({
        monthly_review_id: input.monthlyReviewId, policy_id: input.policyId,
        status: 'pending', reason_snapshot: input.reasonSnapshot ?? {},
      })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, monthlyReviewId: data.monthly_review_id as string,
      policyId: data.policy_id as string, status: data.status as import('@/lib/domain/types').RewardEligibilityStatus,
      reasonSnapshot: (data.reason_snapshot as Record<string, unknown>) ?? {},
      approvedBy: (data.approved_by as string) ?? null, approvedAt: (data.approved_at as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async updateRewardEligibility(id: string, patches: Record<string, unknown>): Promise<import('@/lib/domain/types').RewardEligibility> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('reward_eligibility').update(patches).eq('id', id).select('*').single()
    if (error) throw error
    return {
      id: data.id as string, monthlyReviewId: data.monthly_review_id as string,
      policyId: data.policy_id as string, status: data.status as import('@/lib/domain/types').RewardEligibilityStatus,
      reasonSnapshot: (data.reason_snapshot as Record<string, unknown>) ?? {},
      approvedBy: (data.approved_by as string) ?? null, approvedAt: (data.approved_at as string) ?? null,
      createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async getOperatorAvailability(personId: string, date: string): Promise<import('@/lib/domain/types').OperatorAvailability | null> {
    const { data, error } = await this.client
      .from('operator_availability').select('*')
      .eq('person_id', personId).eq('date', date).maybeSingle()
    if (error) throw error
    return data ? {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, date: data.date as string,
      status: data.status as import('@/lib/domain/types').AvailabilityStatus,
      note: (data.note as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    } : null
  }

  async setOperatorAvailability(input: {
    personId: string; date: string; status: import('@/lib/domain/types').AvailabilityStatus; note?: string | null
  }): Promise<import('@/lib/domain/types').OperatorAvailability> {
    const { data, error } = await this.client
      .from('operator_availability')
      .upsert({
        organization_id: this.orgId, person_id: input.personId, date: input.date,
        status: input.status, note: input.note ?? null,
      }, { onConflict: 'person_id,date' })
      .select('*').single()
    if (error) throw error
    return {
      id: data.id as string, organizationId: data.organization_id as string,
      personId: data.person_id as string, date: data.date as string,
      status: data.status as import('@/lib/domain/types').AvailabilityStatus,
      note: (data.note as string) ?? null, createdAt: data.created_at as string, updatedAt: data.updated_at as string,
    }
  }

  async listOperatorAvailability(personId: string, startDate: string, endDate: string): Promise<import('@/lib/domain/types').OperatorAvailability[]> {
    const { data, error } = await this.client
      .from('operator_availability').select('*')
      .eq('person_id', personId).gte('date', startDate).lte('date', endDate)
      .order('date')
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string, organizationId: r.organization_id as string,
      personId: r.person_id as string, date: r.date as string,
      status: r.status as import('@/lib/domain/types').AvailabilityStatus,
      note: (r.note as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }))
  }

  async getMyDayView(): Promise<import('@/lib/domain/types').MyDayView> {
    const today = new Date().toISOString().slice(0, 10)
    const { data: assignments } = await this.client
      .from('identity_assignments').select('revenue_identity_id').eq('rep_id', this.rep.id)

    const identityIds = assignments?.map((a: any) => a.revenue_identity_id) ?? []
    const { data: contracts } = await this.client
      .from('revenue_identity_contracts').select('*').eq('status', 'active').in('revenue_identity_id', identityIds)
    const { data: allocations } = await this.client
      .from('contract_allocations').select('*').in('contract_id', contracts?.map((c: any) => c.id) ?? [])
    const { data: identities } = await this.client
      .from('revenue_identities').select('*').in('id', identityIds)
    const { data: dayCloses } = await this.client
      .from('day_closes').select('*').eq('person_id', this.rep.id).eq('date', today)
    const { data: availability } = await this.client
      .from('operator_availability').select('*').eq('person_id', this.rep.id).eq('date', today).maybeSingle()

    const myContracts: import('@/lib/domain/types').DailyContract[] = []
    const progress: import('@/lib/domain/types').DailyProgress[] = []

    for (const contract of contracts ?? []) {
      const identity = identities?.find((i: any) => i.id === contract.revenue_identity_id)
      const myAlloc = allocations?.find((a: any) => a.contract_id === contract.id && a.person_id === this.rep.id)
      const pct = (myAlloc?.allocation_pct ?? (allocations?.filter((a: any) => a.contract_id === contract.id).length === 0 ? 100 : 0)) / 100

      myContracts.push({
        revenueIdentityId: contract.revenue_identity_id,
        identityName: identity?.identity_name ?? '',
        annualRevenueTarget: contract.annual_revenue_target,
        qualifiedProspects: Math.round(contract.qualified_prospects * pct),
        connections: Math.round(contract.connections * pct),
        firstDms: Math.round(contract.first_dms * pct),
        emails: Math.round(contract.emails * pct),
        followups: Math.round(contract.followups * pct),
        dueRepliesPct: contract.due_replies_pct,
        meaningfulTouches: Math.round(contract.meaningful_touches * pct),
        loggingCompletenessPct: contract.logging_completeness_pct,
        allocationPct: Math.round(pct * 100),
      })

      const dc = dayCloses?.find((d: any) => d.revenue_identity_id === contract.revenue_identity_id)
      const snap = (dc?.completion_snapshot ?? {}) as Record<string, number>
      const qp = Math.round(contract.qualified_prospects * pct)
      const conn = Math.round(contract.connections * pct)
      const fd = Math.round(contract.first_dms * pct)
      const em = Math.round(contract.emails * pct)
      const fu = Math.round(contract.followups * pct)
      const mt = Math.round(contract.meaningful_touches * pct)

      progress.push({
        qualifiedProspects: { completed: snap.qualifiedProspects ?? 0, target: qp, remaining: Math.max(0, qp - (snap.qualifiedProspects ?? 0)) },
        connections: { completed: snap.connections ?? 0, target: conn, remaining: Math.max(0, conn - (snap.connections ?? 0)) },
        firstDms: { completed: snap.firstDms ?? 0, target: fd, remaining: Math.max(0, fd - (snap.firstDms ?? 0)) },
        emails: { completed: snap.emails ?? 0, target: em, remaining: Math.max(0, em - (snap.emails ?? 0)) },
        followups: { completed: snap.followups ?? 0, target: fu, remaining: Math.max(0, fu - (snap.followups ?? 0)) },
        dueReplies: { completed: snap.dueReplies ?? 0, target: contract.due_replies_pct, remaining: Math.max(0, contract.due_replies_pct - (snap.dueReplies ?? 0)) },
        meaningfulTouches: { completed: snap.meaningfulTouches ?? 0, target: mt, remaining: Math.max(0, mt - (snap.meaningfulTouches ?? 0)) },
        logging: { completed: snap.logging ?? 0, target: contract.logging_completeness_pct, remaining: Math.max(0, contract.logging_completeness_pct - (snap.logging ?? 0)) },
      })
    }

    const totalTarget = myContracts.reduce((s, c) => s + c.qualifiedProspects + c.connections + c.firstDms + c.emails + c.followups + c.meaningfulTouches, 0)
    const totalCompleted = progress.reduce((s, p) => s + p.qualifiedProspects.completed + p.connections.completed + p.firstDms.completed + p.emails.completed + p.followups.completed + p.meaningfulTouches.completed, 0)

    // Aggregate progress across ALL identities (not just first)
    const aggProgress: import('@/lib/domain/types').DailyProgress = progress.length > 0
      ? {
          qualifiedProspects: {
            completed: progress.reduce((s, p) => s + p.qualifiedProspects.completed, 0),
            target: progress.reduce((s, p) => s + p.qualifiedProspects.target, 0),
            remaining: progress.reduce((s, p) => s + p.qualifiedProspects.remaining, 0),
          },
          connections: {
            completed: progress.reduce((s, p) => s + p.connections.completed, 0),
            target: progress.reduce((s, p) => s + p.connections.target, 0),
            remaining: progress.reduce((s, p) => s + p.connections.remaining, 0),
          },
          firstDms: {
            completed: progress.reduce((s, p) => s + p.firstDms.completed, 0),
            target: progress.reduce((s, p) => s + p.firstDms.target, 0),
            remaining: progress.reduce((s, p) => s + p.firstDms.remaining, 0),
          },
          emails: {
            completed: progress.reduce((s, p) => s + p.emails.completed, 0),
            target: progress.reduce((s, p) => s + p.emails.target, 0),
            remaining: progress.reduce((s, p) => s + p.emails.remaining, 0),
          },
          followups: {
            completed: progress.reduce((s, p) => s + p.followups.completed, 0),
            target: progress.reduce((s, p) => s + p.followups.target, 0),
            remaining: progress.reduce((s, p) => s + p.followups.remaining, 0),
          },
          dueReplies: {
            completed: progress.reduce((s, p) => s + p.dueReplies.completed, 0),
            target: progress.reduce((s, p) => s + p.dueReplies.target, 0),
            remaining: progress.reduce((s, p) => s + p.dueReplies.remaining, 0),
          },
          meaningfulTouches: {
            completed: progress.reduce((s, p) => s + p.meaningfulTouches.completed, 0),
            target: progress.reduce((s, p) => s + p.meaningfulTouches.target, 0),
            remaining: progress.reduce((s, p) => s + p.meaningfulTouches.remaining, 0),
          },
          logging: {
            completed: progress.reduce((s, p) => s + p.logging.completed, 0),
            target: progress.reduce((s, p) => s + p.logging.target, 0),
            remaining: progress.reduce((s, p) => s + p.logging.remaining, 0),
          },
        }
      : {
          qualifiedProspects: { completed: 0, target: 0, remaining: 0 },
          connections: { completed: 0, target: 0, remaining: 0 },
          firstDms: { completed: 0, target: 0, remaining: 0 },
          emails: { completed: 0, target: 0, remaining: 0 },
          followups: { completed: 0, target: 0, remaining: 0 },
          dueReplies: { completed: 0, target: 0, remaining: 0 },
          meaningfulTouches: { completed: 0, target: 0, remaining: 0 },
          logging: { completed: 0, target: 0, remaining: 0 },
        }

    return {
      personId: this.rep.id,
      personName: this.rep.name,
      date: today,
      isWorkingDay: availability?.status !== 'leave' && availability?.status !== 'holiday' && availability?.status !== 'approved_unavailable',
      availabilityStatus: availability?.status ?? 'working',
      contracts: myContracts,
      progress: aggProgress,
      totalCompleted,
      totalTarget,
      totalRemaining: Math.max(0, totalTarget - totalCompleted),
      overallStatus: totalCompleted >= totalTarget && totalTarget > 0 ? 'completed' : totalCompleted > 0 ? 'on_track' : 'at_risk',
      canCloseDay: totalCompleted >= totalTarget && totalTarget > 0,
      dayCloseStatus: dayCloses?.[0]?.status ?? null,
      nextAction: totalCompleted >= totalTarget ? 'Day complete' : 'Continue outreach',
    }
  }

  async getTeamAccountabilityView(date?: string): Promise<import('@/lib/domain/types').TeamAccountabilityView> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10)
    const { data: dayCloses } = await this.client
      .from('day_closes').select('*').eq('organization_id', this.orgId).eq('date', targetDate)
    const { data: reps } = await this.client
      .from('reps').select('id, name').eq('organization_id', this.orgId)
    const { data: identities } = await this.client
      .from('revenue_identities').select('id, identity_name').eq('organization_id', this.orgId)

    const members: import('@/lib/domain/types').TeamMemberView[] = (dayCloses ?? []).map((dc: any) => {
      const rep = reps?.find((r: any) => r.id === dc.person_id)
      const identity = identities?.find((i: any) => i.id === dc.revenue_identity_id)
      const snap = (dc.completion_snapshot ?? {}) as Record<string, number>
      const completed = (snap.qualifiedProspects ?? 0) + (snap.connections ?? 0) + (snap.firstDms ?? 0) + (snap.emails ?? 0) + (snap.followups ?? 0) + (snap.meaningfulTouches ?? 0)
      return {
        personId: dc.person_id,
        personName: rep?.name ?? dc.person_id,
        revenueIdentityId: dc.revenue_identity_id,
        identityName: identity?.identity_name ?? '',
        totalCompleted: completed,
        totalTarget: 0,
        totalRemaining: 0,
        status: 'on_track' as const,
        dayCloseStatus: dc.status,
        exceptionReason: dc.exception_reason,
        allocationPct: 100,
      }
    })

    return {
      date: targetDate,
      isWorkingDay: true,
      members,
      exceptions: (dayCloses ?? []).filter((dc: any) => dc.exception_reason),
      needsAttention: [],
    }
  }

  async getIdentityAccountabilityView(identityId: string): Promise<import('@/lib/domain/types').IdentityAccountabilityView> {
    const contract = await this.getActiveContract(identityId)
    const allocations = contract ? await this.listContractAllocations(contract.id) : []
    const { data: identity } = await this.client
      .from('revenue_identities').select('*').eq('id', identityId).maybeSingle()

    return {
      identityId,
      identityName: identity?.identity_name ?? '',
      annualRevenueTarget: contract?.annualRevenueTarget ?? 0,
      contract,
      allocations,
      todayProgress: {
        qualifiedProspects: { completed: 0, target: contract?.qualifiedProspects ?? 0, remaining: contract?.qualifiedProspects ?? 0 },
        connections: { completed: 0, target: contract?.connections ?? 0, remaining: contract?.connections ?? 0 },
        firstDms: { completed: 0, target: contract?.firstDms ?? 0, remaining: contract?.firstDms ?? 0 },
        emails: { completed: 0, target: contract?.emails ?? 0, remaining: contract?.emails ?? 0 },
        followups: { completed: 0, target: contract?.followups ?? 0, remaining: contract?.followups ?? 0 },
        dueReplies: { completed: 0, target: contract?.dueRepliesPct ?? 100, remaining: contract?.dueRepliesPct ?? 100 },
        meaningfulTouches: { completed: 0, target: contract?.meaningfulTouches ?? 0, remaining: contract?.meaningfulTouches ?? 0 },
        logging: { completed: 0, target: contract?.loggingCompletenessPct ?? 100, remaining: contract?.loggingCompletenessPct ?? 100 },
      },
      monthProgress: {
        qualifiedProspects: { completed: 0, target: contract?.qualifiedProspects ?? 0, remaining: contract?.qualifiedProspects ?? 0 },
        connections: { completed: 0, target: contract?.connections ?? 0, remaining: contract?.connections ?? 0 },
        firstDms: { completed: 0, target: contract?.firstDms ?? 0, remaining: contract?.firstDms ?? 0 },
        emails: { completed: 0, target: contract?.emails ?? 0, remaining: contract?.emails ?? 0 },
        followups: { completed: 0, target: contract?.followups ?? 0, remaining: contract?.followups ?? 0 },
        dueReplies: { completed: 0, target: contract?.dueRepliesPct ?? 100, remaining: contract?.dueRepliesPct ?? 100 },
        meaningfulTouches: { completed: 0, target: contract?.meaningfulTouches ?? 0, remaining: contract?.meaningfulTouches ?? 0 },
        logging: { completed: 0, target: contract?.loggingCompletenessPct ?? 100, remaining: contract?.loggingCompletenessPct ?? 100 },
      },
      qualityStatus: 'unknown',
      funnel: {},
      revenue: { won: 0, pipeline: 0, remaining: contract?.annualRevenueTarget ?? 0 },
    }
  }

  async getOwnerCommandCenterView(): Promise<import('@/lib/domain/types').OwnerCommandCenterView> {
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7) + '-01'
    const { data: allReps } = await this.client.from('reps').select('id, name').eq('organization_id', this.orgId)
    const { data: dayCloses } = await this.client.from('day_closes').select('*').eq('organization_id', this.orgId).eq('date', today)
    const { data: monthReviews } = await this.client.from('monthly_accountability_reviews').select('*').eq('organization_id', this.orgId).eq('month', month)
    const { data: exceptions } = await this.client.from('day_closes').select('*').eq('organization_id', this.orgId).eq('status', 'completed_with_exception').eq('date', today)
    const { data: rewardEligibility } = await this.client.from('reward_eligibility').select('*').eq('status', 'pending')

    return {
      date: today,
      isWorkingDay: true,
      totalOperators: allReps?.length ?? 0,
      completeOperators: dayCloses?.filter((dc: any) => dc.status === 'completed').length ?? 0,
      onTrackOperators: dayCloses?.filter((dc: any) => dc.status === 'in_progress' || dc.status === 'ready_to_close').length ?? 0,
      needsAttentionOperators: dayCloses?.filter((dc: any) => dc.status === 'missed').length ?? 0,
      remainingOutboundWork: 0,
      repliesDue: 0,
      monthExpectedWorkingDays: 20,
      monthActualCompletedDays: monthReviews?.length ?? 0,
      monthMeaningfulOutbound: 0,
      monthQualifiedConversations: 0,
      monthCalls: 0,
      monthProposals: 0,
      monthWins: 0,
      monthWonRevenue: 0,
      reviewQueue: monthReviews ?? [],
      exceptionQueue: exceptions ?? [],
      rewardQueue: rewardEligibility ?? [],
      teamBreakdown: [],
    }
  }

  async getMonthlyReviewView(reviewId: string): Promise<import('@/lib/domain/types').MonthlyReviewView> {
    const { data: review } = await this.client
      .from('monthly_accountability_reviews').select('*').eq('id', reviewId).maybeSingle()
    const { data: rep } = await this.client
      .from('reps').select('name').eq('id', review?.person_id).maybeSingle()
    const { data: identity } = await this.client
      .from('revenue_identities').select('identity_name').eq('id', review?.revenue_identity_id).maybeSingle()
    const eligibility = review ? await this.listRewardEligibility(review.id) : []
    const policies = await this.listRewardPolicies()

    return {
      review: review ?? {
        id: '', organizationId: this.orgId, personId: '', revenueIdentityId: '',
        contractId: null, month: '', executionSnapshot: {}, qualitySnapshot: {},
        outcomeSnapshot: {}, consistencySnapshot: {}, reviewStatus: 'pending',
        managerNote: null, adminNote: null, createdAt: '', updatedAt: '',
      },
      personName: rep?.name ?? '',
      identityName: identity?.identity_name ?? '',
      rewardEligibility: eligibility,
      policies,
    }
  }

  // ============================================================================
  // ORCHESTRATION — Event Ledger + Relay Runs (Sprint 1)
  // ============================================================================

  async emitRelayEvent(input: {
    eventType: import('@/lib/domain/types').RelayEventType
    entityType: string
    entityId?: string | null
    actorType?: import('@/lib/domain/types').RelayActorType
    actorId?: string | null
    revenueIdentityId?: string | null
    source?: string
    sourceEventId?: string | null
    correlationId?: string | null
    causationId?: string | null
    relayRunId?: string | null
    payload?: Record<string, unknown>
    metadata?: Record<string, unknown>
    occurredAt?: string
  }): Promise<string | null> {
    // relay_events stores entity/actor/correlation IDs as uuid — coerce any
    // non-UUID value to null rather than failing the whole insert. Event
    // emission must never break the calling operation (callers that need a
    // string identity use payload/sourceEventId instead).
    const uuidOrNullOrUndefined = (value: string | null | undefined): string | null =>
      value == null || value === '' ? null : isUuid(value) ? value : null

    const { data, error } = await this.client.rpc('emit_relay_event', {
      p_org_id: this.orgId,
      p_event_type: input.eventType,
      p_entity_type: input.entityType,
      p_entity_id: uuidOrNullOrUndefined(input.entityId),
      p_actor_type: input.actorType ?? 'system',
      p_actor_id: uuidOrNullOrUndefined(input.actorId),
      p_revenue_identity_id: uuidOrNullOrUndefined(input.revenueIdentityId),
      p_source: input.source ?? 'app',
      p_source_event_id: input.sourceEventId ?? null,
      p_correlation_id: uuidOrNullOrUndefined(input.correlationId),
      p_causation_id: uuidOrNullOrUndefined(input.causationId),
      p_relay_run_id: uuidOrNullOrUndefined(input.relayRunId),
      p_payload: JSON.parse(JSON.stringify(input.payload ?? {})),
      p_metadata: JSON.parse(JSON.stringify(input.metadata ?? {})),
      p_occurred_at: input.occurredAt ?? new Date().toISOString(),
    })
    if (error) {
      // Event emission must never break the calling operation
      console.error('[orchestration] emit_relay_event failed:', error.message)
      return null
    }
    return data as string | null
  }

  async getRelayRunEvents(runId: string): Promise<import('@/lib/domain/types').RelayEvent[]> {
    const { data, error } = await this.client
      .from('relay_events')
      .select('*')
      .eq('relay_run_id', runId)
      .order('occurred_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map((r) => mapRelayEvent(r as Record<string, unknown>))
  }

  async createRelayRun(input: {
    runType?: import('@/lib/domain/types').RelayRunType
    primaryEntityType?: string
    primaryEntityId?: string | null
    assignedRepId?: string | null
    revenueIdentityId?: string | null
    correlationId?: string | null
    context?: Record<string, unknown>
  }): Promise<string | null> {
    const { data, error } = await this.client.rpc('create_relay_run', {
      p_org_id: this.orgId,
      p_run_type: input.runType ?? 'outbound',
      p_primary_entity_type: input.primaryEntityType ?? 'lead',
      p_primary_entity_id: input.primaryEntityId ?? null,
      p_assigned_rep_id: input.assignedRepId ?? null,
      p_revenue_identity_id: input.revenueIdentityId ?? null,
      p_correlation_id: input.correlationId ?? null,
      p_context: JSON.parse(JSON.stringify(input.context ?? {})),
    })
    if (error) {
      console.error('[orchestration] create_relay_run failed:', error.message)
      return null
    }
    return data as string | null
  }

  async transitionRelayRun(input: {
    runId: string
    newStatus: import('@/lib/domain/types').RelayRunStatus
    newStep?: string | null
    eventId?: string | null
    metadata?: Record<string, unknown>
  }): Promise<{ previousStatus: string; newStatus: string; step: string } | null> {
    const { data, error } = await this.client.rpc('transition_relay_run', {
      p_run_id: input.runId,
      p_org_id: this.orgId,
      p_new_status: input.newStatus,
      p_new_step: input.newStep ?? null,
      p_event_id: input.eventId ?? null,
      p_metadata: JSON.parse(JSON.stringify(input.metadata ?? {})),
    })
    if (error) {
      console.error('[orchestration] transition_relay_run failed:', error.message)
      return null
    }
    return data as { previousStatus: string; newStatus: string; step: string }
  }

  async getRelayRun(runId: string): Promise<import('@/lib/domain/types').RelayRun | null> {
    const { data, error } = await this.client
      .from('relay_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return mapRelayRun(data as Record<string, unknown>)
  }

  async listActiveRunsForEntity(entityType: string, entityId: string): Promise<import('@/lib/domain/types').RelayRun[]> {
    const { data, error } = await this.client
      .from('relay_runs')
      .select('*')
      .eq('primary_entity_type', entityType)
      .eq('primary_entity_id', entityId)
      .in('status', ['detected', 'qualifying', 'qualified', 'routing', 'preparing', 'awaiting_human', 'action_recorded', 'waiting', 'followup_due', 'followup_preparing', 'response_received', 'conversation'])
    if (error) throw error
    return (data ?? []).map((r) => mapRelayRun(r as Record<string, unknown>))
  }

  async advanceOutboundRunToWaiting(runId: string): Promise<void> {
    const run = await this.getRelayRun(runId)
    if (!run) return

    const path = OUTBOUND_PATH_TO_WAITING
    const currentIdx = path.indexOf(run.status)
    if (currentIdx === -1) return

    for (let i = currentIdx + 1; i < path.length; i++) {
      const result = await this.transitionRelayRun({ runId, newStatus: path[i] })
      if (!result) break
    }
  }

  private mapCapturedProspect(r: Row): CapturedProspect {
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
      ownerRepId: r.owner_rep_id as string,
      rawInput: r.raw_input as string,
      extractedName: (r.extracted_name as string) ?? null,
      extractedCompany: (r.extracted_company as string) ?? null,
      extractedTitle: (r.extracted_title as string) ?? null,
      extractedLocation: (r.extracted_location as string) ?? null,
      linkedinUrl: (r.linkedin_url as string) ?? null,
      companyUrl: (r.company_url as string) ?? null,
      canonicalScore: (r.canonical_score as number) ?? null,
      canonicalIntelligence: (r.canonical_intelligence as Record<string, unknown>) ?? null,
      scoreBreakdown: (r.score_breakdown as Record<string, unknown>) ?? null,
      revenueIdentityId: (r.revenue_identity_id as string) ?? null,
      senderProfileId: (r.sender_profile_id as string) ?? null,
      status: r.status as CapturedProspect['status'],
      convertedLeadId: (r.converted_lead_id as string) ?? null,
      opportunityKey: (r.opportunity_key as string) ?? null,
      isTest: Boolean(r.is_test),
      sourceKind: (r.source_kind as string) ?? 'PRODUCTION',
      lastActivityAt: r.last_activity_at as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RELAY GROWTH ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  async createGrowthMemory(input: {
    memoryType: import('@/lib/domain/types').GrowthMemoryType
    title: string
    content: string
    source?: string | null
    claimSafety?: import('@/lib/domain/types').ClaimSafety
    territories?: string[]
    audienceSegments?: string[]
  }): Promise<import('@/lib/domain/types').RelayGrowthMemory> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_growth_memory')
      .insert({ organization_id: this.orgId, memory_type: input.memoryType, title: input.title,
        content: input.content, source: input.source ?? null,
        claim_safety: input.claimSafety ?? 'verified_product_fact',
        territories: input.territories ?? [], audience_segments: input.audienceSegments ?? [],
        created_by: this.rep.id }).select('*').single()
    if (error) throw error
    return { id: data.id, organizationId: data.organization_id, memoryType: data.memory_type,
      title: data.title, content: data.content, source: data.source, claimSafety: data.claim_safety,
      territories: data.territories, audienceSegments: data.audience_segments, active: data.active,
      usedInContent: data.used_in_content, createdBy: data.created_by, createdAt: data.created_at,
      updatedAt: data.updated_at }
  }

  async listGrowthMemory(activeOnly = true): Promise<import('@/lib/domain/types').RelayGrowthMemory[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    let query = this.client.from('relay_growth_memory').select('*').eq('organization_id', this.orgId)
    if (activeOnly) query = query.eq('active', true)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) {
      if (isOptionalSearchError(error)) return []
      throw error
    }
    return (data ?? []).map((r) => ({
      id: r.id, organizationId: r.organization_id, memoryType: r.memory_type, title: r.title,
      content: r.content, source: r.source, claimSafety: r.claim_safety, territories: r.territories,
      audienceSegments: r.audience_segments, active: r.active, usedInContent: r.used_in_content,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    }))
  }

  async createGrowthEvent(input: {
    eventType: import('@/lib/domain/types').GrowthEventType
    title: string
    rawContent: string
    sourceKind?: string
  }): Promise<import('@/lib/domain/types').RelayGrowthEvent> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_growth_events')
      .insert({ organization_id: this.orgId, event_type: input.eventType, title: input.title,
        raw_content: input.rawContent, source_kind: input.sourceKind ?? 'build_log',
        created_by: this.rep.id }).select('*').single()
    if (error) throw error
    return { id: data.id, organizationId: data.organization_id, eventType: data.event_type,
      title: data.title, rawContent: data.raw_content, editorialContent: data.editorial_content,
      processed: data.processed, processedAt: data.processed_at, sourceKind: data.source_kind,
      sourceId: data.source_id, createdBy: data.created_by, createdAt: data.created_at }
  }

  async listGrowthEvents(processedOnly = false): Promise<import('@/lib/domain/types').RelayGrowthEvent[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    let query = this.client.from('relay_growth_events').select('*').eq('organization_id', this.orgId)
    if (!processedOnly) query = query.eq('processed', false)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) {
      if (isOptionalSearchError(error)) return []
      throw error
    }
    return (data ?? []).map((r) => ({
      id: r.id, organizationId: r.organization_id, eventType: r.event_type, title: r.title,
      rawContent: r.raw_content, editorialContent: r.editorial_content, processed: r.processed,
      processedAt: r.processed_at, sourceKind: r.source_kind, sourceId: r.source_id,
      createdBy: r.created_by, createdAt: r.created_at,
    }))
  }

  async markGrowthEventProcessed(id: string, editorialContent: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    await this.client.from('relay_growth_events')
      .update({ processed: true, editorial_content: editorialContent, processed_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', this.orgId)
  }

  async createOpportunity(input: {
    sourceType: import('@/lib/domain/types').OpportunitySourceType
    sourceId?: string | null
    title: string
    observation: string
    insight: string
    territory: string
    audienceSegment: string
    contentJob: import('@/lib/domain/types').ContentJob
    evidenceStrength?: 'strong' | 'medium' | 'weak'
    claimBoundaries?: string[]
    audienceRelevance?: number
    novelty?: number
    specificity?: number
    timeliness?: number
    relayDifferentiation?: number
    conversationPotential?: number
    learningValue?: number
    repetitionRisk?: number
    commercialRelevance?: number
  }): Promise<import('@/lib/domain/types').RelayContentOpportunity> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_content_opportunities')
      .insert({ organization_id: this.orgId, source_type: input.sourceType,
        source_id: input.sourceId ?? null, title: input.title, observation: input.observation,
        insight: input.insight, territory: input.territory, audience_segment: input.audienceSegment,
        content_job: input.contentJob, evidence_strength: input.evidenceStrength ?? 'medium',
        claim_boundaries: input.claimBoundaries ?? [], audience_relevance: input.audienceRelevance ?? 50,
        novelty: input.novelty ?? 50, specificity: input.specificity ?? 50,
        timeliness: input.timeliness ?? 50, relay_differentiation: input.relayDifferentiation ?? 50,
        conversation_potential: input.conversationPotential ?? 50, learning_value: input.learningValue ?? 50,
        repetition_risk: input.repetitionRisk ?? 0, commercial_relevance: input.commercialRelevance ?? 50,
      }).select('*').single()
    if (error) throw error
    return { id: data.id, organizationId: data.organization_id, sourceType: data.source_type,
      sourceId: data.source_id, title: data.title, observation: data.observation,
      insight: data.insight, territory: data.territory, audienceSegment: data.audience_segment,
      contentJob: data.content_job, evidenceStrength: data.evidence_strength,
      claimBoundaries: data.claim_boundaries, audienceRelevance: data.audience_relevance,
      novelty: data.novelty, specificity: data.specificity, timeliness: data.timeliness,
      relayDifferentiation: data.relay_differentiation, conversationPotential: data.conversation_potential,
      learningValue: data.learning_value, repetitionRisk: data.repetition_risk,
      commercialRelevance: data.commercial_relevance, selected: data.selected,
      selectionDate: data.selection_date, rejected: data.rejected,
      rejectionReason: data.rejection_reason, generatedAt: data.generated_at,
      generationDate: data.generation_date }
  }

  async listOpportunities(date?: string): Promise<import('@/lib/domain/types').RelayContentOpportunity[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    let query = this.client.from('relay_content_opportunities').select('*').eq('organization_id', this.orgId)
    if (date) query = query.eq('generation_date', date)
    const { data, error } = await query.order('generated_at', { ascending: false })
    if (error) {
      if (isOptionalSearchError(error)) return []
      throw error
    }
    return (data ?? []).map((r) => ({
      id: r.id, organizationId: r.organization_id, sourceType: r.source_type, sourceId: r.source_id,
      title: r.title, observation: r.observation, insight: r.insight, territory: r.territory,
      audienceSegment: r.audience_segment, contentJob: r.content_job, evidenceStrength: r.evidence_strength,
      claimBoundaries: r.claim_boundaries, audienceRelevance: r.audience_relevance, novelty: r.novelty,
      specificity: r.specificity, timeliness: r.timeliness, relayDifferentiation: r.relay_differentiation,
      conversationPotential: r.conversation_potential, learningValue: r.learning_value,
      repetitionRisk: r.repetition_risk, commercialRelevance: r.commercial_relevance,
      selected: r.selected, selectionDate: r.selection_date, rejected: r.rejected,
      rejectionReason: r.rejection_reason, generatedAt: r.generated_at, generationDate: r.generation_date,
    }))
  }

  async selectOpportunity(id: string, date: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    await this.client.from('relay_content_opportunities')
      .update({ selected: true, selection_date: date })
      .eq('id', id).eq('organization_id', this.orgId)
  }

  async rejectOpportunity(id: string, reason: string): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    await this.client.from('relay_content_opportunities')
      .update({ rejected: true, rejection_reason: reason })
      .eq('id', id).eq('organization_id', this.orgId)
  }

  async createEditorialDecision(input: {
    decisionDate: string
    opportunityId: string | null
    primaryReason: string
    audienceReason: string
    timelinessReason: string
    evidenceReason: string
    takeaway: string
  }): Promise<import('@/lib/domain/types').RelayEditorialDecision> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_editorial_decisions')
      .insert({ organization_id: this.orgId, decision_date: input.decisionDate,
        opportunity_id: input.opportunityId, primary_reason: input.primaryReason,
        audience_reason: input.audienceReason, timeliness_reason: input.timelinessReason,
        evidence_reason: input.evidenceReason, takeaway: input.takeaway }).select('*').single()
    if (error) throw error
    return { id: data.id, organizationId: data.organization_id, decisionDate: data.decision_date,
      opportunityId: data.opportunity_id, primaryReason: data.primary_reason,
      audienceReason: data.audience_reason, timelinessReason: data.timeliness_reason,
      evidenceReason: data.evidence_reason, takeaway: data.takeaway, status: data.status,
      adminFeedback: data.admin_feedback, adminEdits: data.admin_edits,
      createdAt: data.created_at, decidedAt: data.decided_at }
  }

  async getEditorialDecision(date: string): Promise<import('@/lib/domain/types').RelayEditorialDecision | null> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_editorial_decisions').select('*')
      .eq('organization_id', this.orgId).eq('decision_date', date).maybeSingle()
    if (error) {
      if (isOptionalSearchError(error)) return null
      throw error
    }
    if (!data) return null
    return { id: data.id, organizationId: data.organization_id, decisionDate: data.decision_date,
      opportunityId: data.opportunity_id, primaryReason: data.primary_reason,
      audienceReason: data.audience_reason, timelinessReason: data.timeliness_reason,
      evidenceReason: data.evidence_reason, takeaway: data.takeaway, status: data.status,
      adminFeedback: data.admin_feedback, adminEdits: data.admin_edits,
      createdAt: data.created_at, decidedAt: data.decided_at }
  }

  async updateEditorialDecision(id: string, patches: {
    status?: import('@/lib/domain/types').EditorialStatus
    adminFeedback?: import('@/lib/domain/types').AdminFeedback
    adminEdits?: string
  }): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const update: Record<string, unknown> = { decided_at: new Date().toISOString() }
    if (patches.status) update.status = patches.status
    if (patches.adminFeedback) update.admin_feedback = patches.adminFeedback
    if (patches.adminEdits !== undefined) update.admin_edits = patches.adminEdits
    await this.client.from('relay_editorial_decisions')
      .update(update).eq('id', id).eq('organization_id', this.orgId)
  }

  async createGrowthDraft(input: {
    decisionId?: string | null
    opportunityId?: string | null
    postPlan: Record<string, unknown>
    platform?: string
  }): Promise<import('@/lib/domain/types').RelayGrowthDraft> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_growth_drafts')
      .insert({ organization_id: this.orgId, decision_id: input.decisionId ?? null,
        opportunity_id: input.opportunityId ?? null, post_plan: JSON.parse(JSON.stringify(input.postPlan)),
        platform: input.platform ?? 'linkedin' }).select('*').single()
    if (error) throw error
    return { id: data.id, organizationId: data.organization_id, decisionId: data.decision_id,
      opportunityId: data.opportunity_id, postPlan: data.post_plan, platform: data.platform,
      caption: data.caption, hook: data.hook, visualType: data.visual_type,
      visualConcept: data.visual_concept, visualPrompt: data.visual_prompt, status: data.status,
      qualityScore: data.quality_score, qualityNotes: data.quality_notes,
      createdAt: data.created_at, updatedAt: data.updated_at }
  }

  async getGrowthDraft(id: string): Promise<import('@/lib/domain/types').RelayGrowthDraft | null> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_growth_drafts').select('*').eq('id', id)
      .eq('organization_id', this.orgId).maybeSingle()
    if (error) throw error
    if (!data) return null
    return { id: data.id, organizationId: data.organization_id, decisionId: data.decision_id,
      opportunityId: data.opportunity_id, postPlan: data.post_plan, platform: data.platform,
      caption: data.caption, hook: data.hook, visualType: data.visual_type,
      visualConcept: data.visual_concept, visualPrompt: data.visual_prompt, status: data.status,
      qualityScore: data.quality_score, qualityNotes: data.quality_notes,
      createdAt: data.created_at, updatedAt: data.updated_at }
  }

  async getGrowthDraftByDecision(decisionId: string): Promise<import('@/lib/domain/types').RelayGrowthDraft | null> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_growth_drafts').select('*').eq('decision_id', decisionId)
      .eq('organization_id', this.orgId).maybeSingle()
    if (error) {
      if (isOptionalSearchError(error)) return null
      throw error
    }
    if (!data) return null
    return { id: data.id, organizationId: data.organization_id, decisionId: data.decision_id,
      opportunityId: data.opportunity_id, postPlan: data.post_plan, platform: data.platform,
      caption: data.caption, hook: data.hook, visualType: data.visual_type,
      visualConcept: data.visual_concept, visualPrompt: data.visual_prompt, status: data.status,
      qualityScore: data.quality_score, qualityNotes: data.quality_notes,
      createdAt: data.created_at, updatedAt: data.updated_at }
  }

  async updateGrowthDraft(id: string, patches: {
    caption?: string
    hook?: string
    status?: string
    visualType?: string
    visualConcept?: string
    visualPrompt?: string
    qualityScore?: number
    qualityNotes?: string[]
  }): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patches.caption !== undefined) update.caption = patches.caption
    if (patches.hook !== undefined) update.hook = patches.hook
    if (patches.status) update.status = patches.status
    if (patches.visualType) update.visual_type = patches.visualType
    if (patches.visualConcept) update.visual_concept = patches.visualConcept
    if (patches.visualPrompt) update.visual_prompt = patches.visualPrompt
    if (patches.qualityScore !== undefined) update.quality_score = patches.qualityScore
    if (patches.qualityNotes) update.quality_notes = patches.qualityNotes
    await this.client.from('relay_growth_drafts')
      .update(update).eq('id', id).eq('organization_id', this.orgId)
  }

  async createPublication(input: {
    draftId?: string | null
    platform: string
    caption: string
    territory: string
    audienceSegment: string
    contentJob: string
    campaign?: string
  }): Promise<import('@/lib/domain/types').RelayContentPublication> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_content_publications')
      .insert({ organization_id: this.orgId, draft_id: input.draftId ?? null,
        platform: input.platform, caption: input.caption, territory: input.territory,
        audience_segment: input.audienceSegment, content_job: input.contentJob,
        campaign: input.campaign ?? null }).select('*').single()
    if (error) throw error
    return { id: data.id, organizationId: data.organization_id, draftId: data.draft_id,
      platform: data.platform, publishedAt: data.published_at, externalId: data.external_id,
      externalUrl: data.external_url, campaign: data.campaign, utmSource: data.utm_source,
      utmMedium: data.utm_medium, utmContent: data.utm_content, caption: data.caption,
      territory: data.territory, audienceSegment: data.audience_segment,
      contentJob: data.content_job, createdAt: data.created_at }
  }

  async listPublications(): Promise<import('@/lib/domain/types').RelayContentPublication[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_content_publications').select('*').eq('organization_id', this.orgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id, organizationId: r.organization_id, draftId: r.draft_id, platform: r.platform,
      publishedAt: r.published_at, externalId: r.external_id, externalUrl: r.external_url,
      campaign: r.campaign, utmSource: r.utm_source, utmMedium: r.utm_medium,
      utmContent: r.utm_content, caption: r.caption, territory: r.territory,
      audienceSegment: r.audience_segment, contentJob: r.content_job, createdAt: r.created_at,
    }))
  }

  async recordOutcome(input: {
    publicationId: string
    impressions?: number
    likes?: number
    comments?: number
    shares?: number
    saves?: number
    profileVisits?: number
    newFollowers?: number
    signups?: number
  }): Promise<void> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    await this.client.from('relay_content_outcomes').insert({
      organization_id: this.orgId, publication_id: input.publicationId,
      impressions: input.impressions ?? null, likes: input.likes ?? null,
      comments: input.comments ?? null, shares: input.shares ?? null,
      saves: input.saves ?? null, profile_visits: input.profileVisits ?? null,
      new_followers: input.newFollowers ?? null, signups: input.signups ?? null,
    })
  }

  async listOutcomes(publicationId: string): Promise<import('@/lib/domain/types').RelayContentOutcome[]> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('relay_content_outcomes').select('*').eq('publication_id', publicationId)
      .order('recorded_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id, organizationId: r.organization_id, publicationId: r.publication_id,
      impressions: r.impressions, uniqueReach: r.unique_reach, likes: r.likes,
      comments: r.comments, shares: r.shares, saves: r.saves, profileVisits: r.profile_visits,
      newFollowers: r.new_followers, linkClicks: r.link_clicks, relayVisits: r.relay_visits,
      signups: r.signups, activatedUsers: r.activated_users, recordedAt: r.recorded_at,
      notes: r.notes,
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAM-SCOPED QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  async getTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
    const { data, error } = await this.client
      .from('team_memberships')
      .select('person_id, membership_role, reps!inner(id, name)')
      .eq('team_id', teamId)
      .eq('active', true)
    if (error) throw error
    return (data ?? []).map((r: any) => ({
      repId: r.reps.id,
      repName: r.reps.name,
      role: r.membership_role,
    }))
  }

  async getTeamTargets(teamId: string, date?: string): Promise<TeamTargetRow[]> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10)

    const { data: memberships } = await this.client
      .from('team_memberships')
      .select('person_id')
      .eq('team_id', teamId)
      .eq('active', true)

    if (!memberships || memberships.length === 0) return []

    const repIds = memberships.map((m) => m.person_id)

    const { data: targets } = await this.client
      .from('daily_targets')
      .select('rep_id, revenue_identity_id, activity_type, target_count, active')
      .in('rep_id', repIds)
      .eq('active', true)

    if (!targets || targets.length === 0) return []

    const { data: accountability } = await this.client
      .from('daily_accountability')
      .select('rep_id, revenue_identity_id, activity_type, completed_count, status')
      .in('rep_id', repIds)
      .eq('target_date', targetDate)

    const accMap = new Map(
      (accountability ?? []).map((a) => [`${a.rep_id}:${a.revenue_identity_id}:${a.activity_type}`, a]),
    )

    const identityIds = [...new Set(targets.map((t) => t.revenue_identity_id).filter(Boolean))]
    const { data: identities } = identityIds.length > 0
      ? await this.client
          .from('revenue_identities')
          .select('id, identity_name, channel')
          .in('id', identityIds)
      : { data: [] as Array<{ id: string; identity_name: string; channel: string }> }

    const identityMap = new Map((identities ?? []).map((i) => [i.id, i]))

    const { data: reps } = await this.client
      .from('reps')
      .select('id, name')
      .in('id', repIds)

    const repMap = new Map((reps ?? []).map((r) => [r.id, r.name]))

    return targets.map((t) => {
      const key = `${t.rep_id}:${t.revenue_identity_id}:${t.activity_type}`
      const acc = accMap.get(key)
      const identity = identityMap.get(t.revenue_identity_id)
      const completed = acc?.completed_count ?? 0
      return {
        repId: t.rep_id,
        repName: repMap.get(t.rep_id) ?? 'Unknown',
        revenueIdentityId: t.revenue_identity_id,
        identityName: identity?.identity_name ?? 'Unknown',
        channel: identity?.channel ?? 'other',
        activityType: t.activity_type,
        targetCount: t.target_count,
        completedCount: completed,
        remaining: Math.max(0, t.target_count - completed),
        status: acc?.status ?? 'on_track',
      }
    })
  }

  async getRepAssignments(repId: string): Promise<Array<{
    assignmentId: string
    revenueIdentityId: string
    identityName: string
    title: string | null
    channel: string
  }>> {
    const { data, error } = await this.client
      .from('identity_assignments')
      .select('id, revenue_identity_id, identity:revenue_identities(id, identity_name, title, channel)')
      .eq('rep_id', repId)
      .eq('organization_id', this.orgId)
    if (error) throw error
    return (data ?? []).map((a: any) => ({
      assignmentId: a.id,
      revenueIdentityId: a.revenue_identity_id,
      identityName: a.identity?.identity_name ?? 'Unknown',
      title: a.identity?.title ?? null,
      channel: a.identity?.channel ?? 'other',
    }))
  }

  async getRepInfo(repId: string): Promise<{ id: string; name: string; role: string } | null> {
    const { data, error } = await this.client
      .from('reps')
      .select('id, name, role')
      .eq('id', repId)
      .eq('organization_id', this.orgId)
      .maybeSingle()
    if (error) throw error
    return data ? { id: data.id, name: data.name, role: data.role } : null
  }

  async getOrganizationRoles(): Promise<Array<{ personId: string; role: string }>> {
    const { data, error } = await this.client
      .from('organization_roles')
      .select('person_id, role')
      .eq('organization_id', this.orgId)
    if (error) throw error
    return (data ?? []).map((r) => ({ personId: r.person_id, role: r.role }))
  }

  async getActiveTeamMemberships(): Promise<Array<{ teamId: string; personId: string; membershipRole: string }>> {
    const { data, error } = await this.client
      .from('team_memberships')
      .select('team_id, person_id, membership_role')
      .eq('active', true)
    if (error) throw error
    return (data ?? []).map((m) => ({
      teamId: m.team_id,
      personId: m.person_id,
      membershipRole: m.membership_role,
    }))
  }

  async getTeamInfo(teamId: string): Promise<{ id: string; name: string; description: string | null } | null> {
    const { data, error } = await this.client
      .from('teams')
      .select('id, name, description')
      .eq('id', teamId)
      .eq('organization_id', this.orgId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  async listTeams(): Promise<Array<{ id: string; name: string; description: string | null }>> {
    const { data, error } = await this.client
      .from('teams')
      .select('id, name, description')
      .eq('organization_id', this.orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
    if (error) throw error
    return data ?? []
  }

  async getManagedTeamSummary(managerId: string): Promise<TeamSummaryRow[]> {
    const { data: memberships } = await this.client
      .from('team_memberships')
      .select('team_id, teams!inner(name)')
      .eq('person_id', managerId)
      .eq('membership_role', 'MANAGER')
      .eq('active', true)

    if (!memberships || memberships.length === 0) return []

    const teamIds = memberships.map((m) => m.team_id)
    const today = new Date().toISOString().slice(0, 10)

    const { data: allTargets } = await this.client
      .from('daily_targets')
      .select('rep_id, revenue_identity_id, activity_type, target_count, active')
      .eq('active', true)

    const { data: allAcc } = await this.client
      .from('daily_accountability')
      .select('rep_id, revenue_identity_id, activity_type, completed_count, status')
      .eq('target_date', today)

    const { data: teamMembers } = await this.client
      .from('team_memberships')
      .select('team_id, person_id')
      .in('team_id', teamIds)
      .eq('active', true)

    const teamRepIds = new Map<string, string[]>()
    for (const tm of teamMembers ?? []) {
      const ids = teamRepIds.get(tm.team_id) ?? []
      ids.push(tm.person_id)
      teamRepIds.set(tm.team_id, ids)
    }

    const accMap = new Map(
      (allAcc ?? []).map((a) => [`${a.rep_id}:${a.revenue_identity_id}:${a.activity_type}`, a]),
    )

    return (memberships as any[]).map((m) => {
      const repIds = teamRepIds.get(m.team_id) ?? []
      let totalTarget = 0
      let totalCompleted = 0
      let needsAttention = 0

      for (const repId of repIds) {
        const repTargets = (allTargets ?? []).filter((t) => t.rep_id === repId)
        for (const t of repTargets) {
          const key = `${repId}:${t.revenue_identity_id}:${t.activity_type}`
          const acc = accMap.get(key)
          totalTarget += t.target_count
          totalCompleted += acc?.completed_count ?? 0
          if (acc?.status === 'at_risk' || acc?.status === 'missed') {
            needsAttention++
          }
        }
      }

      return {
        teamId: m.team_id,
        teamName: m.teams?.name ?? 'Unknown',
        memberCount: repIds.length,
        totalTarget,
        totalCompleted,
        totalRemaining: Math.max(0, totalTarget - totalCompleted),
        needsAttention,
      }
    })
  }


  async listTrendSources(): Promise<TrendSource[]> {
    const { data, error } = await this.client
      .from('trend_sources')
      .select('*')
      .order('source_key')
    if (error) throw error
    return (data ?? []).map(mapTrendSource)
  }

  async getTrendSource(sourceKey: string): Promise<TrendSource | null> {
    const { data, error } = await this.client
      .from('trend_sources')
      .select('*')
      .eq('source_key', sourceKey)
      .maybeSingle()
    if (error) throw error
    return data ? mapTrendSource(data) : null
  }

  async upsertTrendSource(input: {
    sourceKey: string
    sourceType: TrendSourceType
    displayName: string
    baseUrl?: string
    enabled?: boolean
    fetchIntervalMinutes?: number
    config?: Record<string, unknown>
  }): Promise<TrendSource> {
    const { data, error } = await this.client
      .from('trend_sources')
      .upsert({
        source_key: input.sourceKey,
        source_type: input.sourceType,
        display_name: input.displayName,
        base_url: input.baseUrl ?? null,
        enabled: input.enabled ?? true,
        fetch_interval_minutes: input.fetchIntervalMinutes ?? 60,
        config: input.config ?? {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_key' })
      .select('*')
      .single()
    if (error) throw error
    return mapTrendSource(data)
  }

  async updateTrendSourceHealth(sourceKey: string, success: boolean, error?: string): Promise<void> {
    const now = new Date().toISOString()
    if (success) {
      await this.client
        .from('trend_sources')
        .update({ last_fetched_at: now, last_success_at: now, consecutive_failures: 0, last_error: null, updated_at: now })
        .eq('source_key', sourceKey)
    } else {
      const { data: current } = await this.client
        .from('trend_sources')
        .select('consecutive_failures')
        .eq('source_key', sourceKey)
        .maybeSingle()
      await this.client
        .from('trend_sources')
        .update({
          last_fetched_at: now,
          consecutive_failures: ((current?.consecutive_failures as number) ?? 0) + 1,
          last_error: error ?? null,
          updated_at: now,
        })
        .eq('source_key', sourceKey)
    }
  }

  async createTrendItem(input: {
    sourceId: string
    sourceItemId: string
    url?: string
    title: string
    excerpt?: string
    author?: string
    publishedAt?: string
    metrics?: Record<string, unknown>
    topics?: string[]
    contentFingerprint: string
    evidenceQuality?: EvidenceQuality
    expiresAt?: string
  }): Promise<TrendItem> {
    const { data, error } = await this.client
      .from('trend_items')
      .insert({
        source_id: input.sourceId,
        source_item_id: input.sourceItemId,
        url: input.url ?? null,
        title: input.title,
        excerpt: input.excerpt ?? null,
        author: input.author ?? null,
        published_at: input.publishedAt ?? null,
        metrics: input.metrics ?? {},
        topics: input.topics ?? [],
        content_fingerprint: input.contentFingerprint,
        evidence_quality: input.evidenceQuality ?? 'medium',
        expires_at: input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('*')
      .single()
    if (error) throw error
    return mapTrendItem(data)
  }

  async listTrendItems(opts?: { since?: string; topics?: string[]; limit?: number }): Promise<TrendItem[]> {
    let query = this.client
      .from('trend_items')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .limit(opts?.limit ?? 100)

    if (opts?.since) {
      query = query.gt('fetched_at', opts.since)
    }
    if (opts?.topics && opts.topics.length > 0) {
      query = query.contains('topics', opts.topics)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(mapTrendItem)
  }


  async createDailyContentBrief(input: {
    organizationId: string
    personaId: string
    localDate: string
    generationVersion?: number
    trendSnapshot?: Record<string, unknown>
    promptVersion?: string
  }): Promise<DailyContentBrief> {
    const { data, error } = await this.client
      .from('daily_content_briefs')
      .insert({
        organization_id: input.organizationId,
        persona_id: input.personaId,
        local_date: input.localDate,
        generation_version: input.generationVersion ?? 1,
        trend_snapshot: input.trendSnapshot ?? {},
        prompt_version: input.promptVersion ?? 'v1',
        status: 'generating',
        generation_started_at: new Date().toISOString(),
      })
      .select('*')
      .limit(1)
    if (error) throw error
    return mapDailyContentBrief(data[0])
  }

  async getDailyContentBrief(personaId: string, localDate: string): Promise<DailyContentBrief | null> {
     const { data, error } = await this.client
       .from('daily_content_briefs')
       .select('*')
       .eq('persona_id', personaId)
       .eq('local_date', localDate)
       .order('generation_version', { ascending: false })
       .limit(1)
       .maybeSingle()
     if (error) throw error
     return data ? mapDailyContentBrief(data) : null
   }

  async deleteDailyContentBriefByPersonaAndDate(personaId: string, localDate: string): Promise<void> {
     await this.client
       .from('daily_content_briefs')
       .delete()
       .eq('persona_id', personaId)
       .eq('local_date', localDate)
   }

  async getDailyContentBriefWithIdeas(personaId: string, localDate: string): Promise<{
    brief: DailyContentBrief
    ideas: DailyContentIdea[]
  } | null> {
    const brief = await this.getDailyContentBrief(personaId, localDate)
    if (!brief) return null
    const ideas = await this.listDailyContentIdeas(brief.id)
    return { brief, ideas }
  }

  async updateDailyContentBriefStatus(briefId: string, status: BriefStatus, cost?: number): Promise<DailyContentBrief> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (status === 'ready') {
      update.generation_completed_at = new Date().toISOString()
    }
    if (cost !== undefined) {
      update.generation_cost_usd = cost
    }
    const { data, error } = await this.client
      .from('daily_content_briefs')
      .update(update)
      .eq('id', briefId)
      .select('*')
      .limit(1)
    if (error) throw error
    return mapDailyContentBrief(data[0])
  }

  async updateDailyContentBriefRecommended(briefId: string, ideaId: string): Promise<DailyContentBrief> {
    const { data, error } = await this.client
      .from('daily_content_briefs')
      .update({ recommended_idea_id: ideaId, updated_at: new Date().toISOString() })
      .eq('id', briefId)
      .select('*')
      .limit(1)
    if (error) throw error
    return mapDailyContentBrief(data[0])
  }

  async getLatestDailyContentBrief(personaId: string): Promise<DailyContentBrief | null> {
    const { data, error } = await this.client
      .from('daily_content_briefs')
      .select('*')
      .eq('persona_id', personaId)
      .order('local_date', { ascending: false })
      .order('generation_version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? mapDailyContentBrief(data) : null
  }

  async createDailyContentIdea(input: {
    briefId: string
    organizationId: string
    personaId: string
    ideaType: IdeaType
    title: string
    angle?: string
    whyNow?: string
    sourceIds?: string[]
    sourceFreshness?: SourceFreshness
    formatSuggestion?: string
    territory?: string
    noveltyScore?: number
    relevanceScore?: number
    credibilityScore?: number
    insightScore?: number
    trendGrounded?: boolean
    postCaption?: string
    postPlatform?: string
     visualType?: VisualType
     visualConcept?: string
     visualPrompt?: string
     visualCommunicationGoal?: string
     visualSubject?: string
     visualScene?: string
     visualComposition?: string
     visualLighting?: string
     visualPalette?: string
     visualMood?: string
     visualStyle?: string
     visualAspectRatio?: string
     visualFocalPoint?: string
     visualAllowedText?: string
     visualScreenshotTarget?: string
     visualAvoid?: string
     visualRealism?: string
     visualReason?: string
     qualityResult?: Record<string, unknown>
   }): Promise<DailyContentIdea> {
    const { data, error } = await this.client
      .from('daily_content_ideas')
      .insert({
        brief_id: input.briefId,
        organization_id: input.organizationId,
        persona_id: input.personaId,
        idea_type: input.ideaType,
        title: input.title,
        angle: input.angle ?? null,
        why_now: input.whyNow ?? null,
        source_ids: input.sourceIds ?? [],
        source_freshness: input.sourceFreshness ?? null,
        format_suggestion: input.formatSuggestion ?? null,
        territory: input.territory ?? null,
        novelty_score: input.noveltyScore ?? null,
        relevance_score: input.relevanceScore ?? null,
        credibility_score: input.credibilityScore ?? null,
        insight_score: input.insightScore ?? null,
        trend_grounded: input.trendGrounded ?? false,
        post_caption: input.postCaption ?? null,
        post_platform: input.postPlatform ?? 'linkedin',
         visual_type: input.visualType ?? null,
         visual_concept: input.visualConcept ?? null,
         visual_prompt: input.visualPrompt ?? null,
         visual_communication_goal: input.visualCommunicationGoal ?? null,
         visual_subject: input.visualSubject ?? null,
         visual_scene: input.visualScene ?? null,
         visual_composition: input.visualComposition ?? null,
         visual_lighting: input.visualLighting ?? null,
         visual_palette: input.visualPalette ?? null,
         visual_mood: input.visualMood ?? null,
         visual_style: input.visualStyle ?? null,
         visual_aspect_ratio: input.visualAspectRatio ?? '1.91:1',
         visual_focal_point: input.visualFocalPoint ?? null,
         visual_allowed_text: input.visualAllowedText ?? null,
         visual_screenshot_target: input.visualScreenshotTarget ?? null,
         visual_avoid: input.visualAvoid ?? null,
         visual_realism: input.visualRealism ?? null,
         visual_reason: input.visualReason ?? null,
         quality_result: input.qualityResult ?? null,
       })
        .select('*')
        .limit(1)
      if (error) throw error
      return mapDailyContentIdea(data[0])
    }

  async listDailyContentIdeas(briefId: string): Promise<DailyContentIdea[]> {
    const { data, error } = await this.client
      .from('daily_content_ideas')
      .select('*')
      .eq('brief_id', briefId)
      .order('idea_type', { ascending: true })
    if (error) throw error
    return (data ?? []).map(mapDailyContentIdea)
  }

  async getDailyContentIdeaById(ideaId: string): Promise<DailyContentIdea | null> {
     const { data, error } = await this.client
       .from('daily_content_ideas')
       .select('*')
       .eq('id', ideaId)
       .maybeSingle()
     if (error) return null
     return data ? mapDailyContentIdea(data) : null
   }

  async markDailyContentIdeaCopied(ideaId: string): Promise<void> {
    await this.client
      .from('daily_content_ideas')
      .update({ copied_at: new Date().toISOString() })
      .eq('id', ideaId)
  }

  async markDailyContentIdeaRejected(ideaId: string): Promise<void> {
    await this.client
      .from('daily_content_ideas')
      .update({ rejected_at: new Date().toISOString() })
      .eq('id', ideaId)
  }

  async markDailyContentIdeaPosted(ideaId: string): Promise<void> {
    await this.client
      .from('daily_content_ideas')
      .update({ posted_at: new Date().toISOString() })
      .eq('id', ideaId)
  }

  async updatePersonaTrendInterest(personaId: string, profile: TrendInterestProfile): Promise<void> {
    await this.client
      .from('content_personas')
      .update({ trend_interest_profile: profile, updated_at: new Date().toISOString() })
      .eq('id', personaId)
  }

  async updatePersonaFieldConfidence(personaId: string, confidence: FieldConfidence): Promise<void> {
    await this.client
      .from('content_profiles')
      .update({ field_confidence: confidence })
      .eq('persona_id', personaId)
  }

  async synthesizePersonaIntelligence(input: {
    personaId: string
    profileInput?: string
    pastPostsInput?: string
    role?: string
    company?: string
    description?: string
  }): Promise<PersonaIntelligenceProfile> {
    const { generate } = await import('@/lib/ai/runtime')
    const system = `You are a persona intelligence synthesizer. Given raw user input, produce a structured Persona Intelligence Profile.
RULES:
- Only use information explicitly provided or strongly implied by the input.
- Do NOT invent experience, opinions, accomplishments, or technical skills.
- Mark each field confidence as: PROVIDED (explicitly stated), STRONG_INFERENCE (clearly implied), WEAK_INFERENCE (possible but uncertain), UNKNOWN (no basis).
- Weak inferences must NOT be used as factual first-person experience.
- Be concise. Output ONLY valid JSON matching the schema.`

    const user = JSON.stringify({
      profileInput: input.profileInput,
      pastPostsInput: input.pastPostsInput,
      role: input.role,
      company: input.company,
      description: input.description,
    })

    const result = await generate<PersonaIntelligenceProfile>({
      task: 'FAST_STRUCTURED',
      system,
      user,
      promptVersion: 'persona-synthesis-v1',
      callSite: 'studio-v2:synthesizePersonaIntelligence',
      feature: 'studio_v2_persona',
      organizationId: this.orgId,
    })

    return result.data
  }


  async createDailyGrowthBrief(input: {
    organizationId: string
    localDate: string
    generationVersion?: number
    trendSnapshot?: Record<string, unknown>
    promptVersion?: string
    postCaption?: string
    visualType?: VisualType
    visualConcept?: string
    visualPrompt?: string
    visualReason?: string
    alternateIdeas?: Array<{ title: string; angle: string; whyNow: string }>
    contentMemoryHash?: string
    qualityResult?: Record<string, unknown>
    generationCostUsd?: number
  }): Promise<DailyGrowthBrief> {
    if (this.rep.role !== 'admin') throw new Error('Admin only')
    const { data, error } = await this.client
      .from('daily_growth_briefs')
      .insert({
        organization_id: input.organizationId,
        local_date: input.localDate,
        generation_version: input.generationVersion ?? 1,
        trend_snapshot: input.trendSnapshot ?? {},
        prompt_version: input.promptVersion ?? 'v1',
        post_caption: input.postCaption ?? null,
        visual_type: input.visualType ?? null,
        visual_concept: input.visualConcept ?? null,
        visual_prompt: input.visualPrompt ?? null,
        visual_reason: input.visualReason ?? null,
        alternate_ideas: input.alternateIdeas ?? [],
        content_memory_hash: input.contentMemoryHash ?? null,
        quality_result: input.qualityResult ?? null,
        generation_cost_usd: input.generationCostUsd ?? null,
        status: input.postCaption ? 'ready' : 'generating',
      })
      .select('*')
      .single()
    if (error) throw error
    return mapDailyGrowthBrief(data)
  }

  async getDailyGrowthBrief(localDate: string): Promise<DailyGrowthBrief | null> {
    const { data, error } = await this.client
      .from('daily_growth_briefs')
      .select('*')
      .eq('organization_id', this.orgId)
      .eq('local_date', localDate)
      .order('generation_version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? mapDailyGrowthBrief(data) : null
  }

  async markDailyGrowthBriefCopied(briefId: string): Promise<void> {
    await this.client
      .from('daily_growth_briefs')
      .update({ copied_at: new Date().toISOString() })
      .eq('id', briefId)
  }

  async tryMarkContentDraftPosted(draftId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('content_drafts')
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', draftId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()
    if (error) throw error
    return data !== null
  }

  async pruneContentMemories(personaId: string, retainDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - retainDays * 86400000).toISOString()
    await this.client
      .from('content_memories')
      .delete()
      .eq('persona_id', personaId)
      .lt('created_at', cutoff)
  }

  async listEditorialDecisions(fromDate: string, toDate: string): Promise<import('@/lib/domain/types').RelayEditorialDecision[]> {
    const { data, error } = await this.client
      .from('editorial_decisions')
      .select('*')
      .eq('organization_id', this.orgId)
      .gte('decision_date', fromDate)
      .lte('decision_date', toDate)
      .order('decision_date', { ascending: false })
    if (error) throw error
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      organizationId: r.organization_id as string,
      decisionDate: r.decision_date as string,
      opportunityId: r.opportunity_id as string | null,
      primaryReason: r.primary_reason as string,
      audienceReason: r.audience_reason as string,
      timelinessReason: r.timeliness_reason as string,
      evidenceReason: r.evidence_reason as string,
      takeaway: r.takeaway as string,
      status: r.status as import('@/lib/domain/types').EditorialStatus,
      adminFeedback: r.admin_feedback as import('@/lib/domain/types').AdminFeedback | null,
      adminEdits: r.admin_edits as string | null,
      createdAt: r.created_at as string,
      decidedAt: r.decided_at as string | null,
    }))
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Mapper functions
// ═════════════════════════════════════════════════════════════════════════════

function mapTrendSource(r: Record<string, unknown>): TrendSource {
  return {
    id: r.id as string,
    sourceKey: r.source_key as string,
    sourceType: r.source_type as TrendSource['sourceType'],
    displayName: r.display_name as string,
    baseUrl: r.base_url as string | null,
    enabled: r.enabled as boolean,
    fetchIntervalMinutes: r.fetch_interval_minutes as number,
    lastFetchedAt: r.last_fetched_at as string | null,
    lastSuccessAt: r.last_success_at as string | null,
    lastError: r.last_error as string | null,
    consecutiveFailures: r.consecutive_failures as number,
    rateLimitRemaining: r.rate_limit_remaining as number | null,
    rateLimitResetAt: r.rate_limit_reset_at as string | null,
    config: r.config as Record<string, unknown>,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapTrendItem(r: Record<string, unknown>): TrendItem {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    sourceItemId: r.source_item_id as string,
    url: r.url as string | null,
    title: r.title as string,
    excerpt: r.excerpt as string | null,
    author: r.author as string | null,
    publishedAt: r.published_at as string | null,
    fetchedAt: r.fetched_at as string,
    metrics: r.metrics as Record<string, unknown>,
    topics: (r.topics as string[]) ?? [],
    contentFingerprint: r.content_fingerprint as string,
    evidenceQuality: r.evidence_quality as TrendItem['evidenceQuality'],
    expiresAt: r.expires_at as string,
    createdAt: r.created_at as string,
  }
}

function mapDailyContentBrief(r: Record<string, unknown>): DailyContentBrief {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    localDate: r.local_date as string,
    generationVersion: r.generation_version as number,
    status: r.status as DailyContentBrief['status'],
    recommendedIdeaId: r.recommended_idea_id as string | null,
    trendSnapshot: r.trend_snapshot as Record<string, unknown>,
    promptVersion: r.prompt_version as string,
    runtimeVersion: (r.runtime_version as string) ?? '1.0',
    generationStartedAt: r.generation_started_at as string | null,
    generationCompletedAt: r.generation_completed_at as string | null,
    generationCostUsd: r.generation_cost_usd as number | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapDailyContentIdea(r: Record<string, unknown>): DailyContentIdea {
  return {
    id: r.id as string,
    briefId: r.brief_id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    ideaType: r.idea_type as DailyContentIdea['ideaType'],
    title: r.title as string,
    angle: r.angle as string | null,
    whyNow: r.why_now as string | null,
    sourceIds: (r.source_ids as string[]) ?? [],
    sourceFreshness: r.source_freshness as DailyContentIdea['sourceFreshness'],
    formatSuggestion: r.format_suggestion as string | null,
    territory: r.territory as string | null,
    noveltyScore: r.novelty_score as number | null,
    relevanceScore: r.relevance_score as number | null,
    credibilityScore: r.credibility_score as number | null,
    insightScore: r.insight_score as number | null,
    trendGrounded: r.trend_grounded as boolean,
    postCaption: r.post_caption as string | null,
    postPlatform: (r.post_platform as string) ?? 'linkedin',
     visualType: r.visual_type as DailyContentIdea['visualType'],
     visualConcept: r.visual_concept as string | null,
     visualPrompt: r.visual_prompt as string | null,
     visualCommunicationGoal: r.visual_communication_goal as string | null,
     visualSubject: r.visual_subject as string | null,
     visualScene: r.visual_scene as string | null,
     visualComposition: r.visual_composition as string | null,
     visualLighting: r.visual_lighting as string | null,
     visualPalette: r.visual_palette as string | null,
     visualMood: r.visual_mood as string | null,
     visualStyle: r.visual_style as string | null,
     visualAspectRatio: (r.visual_aspect_ratio as string) ?? '1.91:1',
     visualFocalPoint: r.visual_focal_point as string | null,
     visualAllowedText: r.visual_allowed_text as string | null,
     visualScreenshotTarget: r.visual_screenshot_target as string | null,
     visualAvoid: r.visual_avoid as string | null,
     visualRealism: r.visual_realism as string | null,
     visualReason: r.visual_reason as string | null,
    qualityResult: r.quality_result as Record<string, unknown> | null,
    copiedAt: r.copied_at as string | null,
    postedAt: r.posted_at as string | null,
    rejectedAt: r.rejected_at as string | null,
    createdAt: r.created_at as string,
  }
}

function mapDailyGrowthBrief(r: Record<string, unknown>): DailyGrowthBrief {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    localDate: r.local_date as string,
    generationVersion: r.generation_version as number,
    status: r.status as DailyGrowthBrief['status'],
    recommendedIdeaId: r.recommended_idea_id as string | null,
    trendSnapshot: r.trend_snapshot as Record<string, unknown>,
    promptVersion: r.prompt_version as string,
    postCaption: r.post_caption as string | null,
    visualType: r.visual_type as DailyGrowthBrief['visualType'],
    visualConcept: r.visual_concept as string | null,
    visualPrompt: r.visual_prompt as string | null,
    visualReason: r.visual_reason as string | null,
    alternateIdeas: (r.alternate_ideas as DailyGrowthBrief['alternateIdeas']) ?? [],
    contentMemoryHash: r.content_memory_hash as string | null,
    qualityResult: r.quality_result as Record<string, unknown> | null,
    generationCostUsd: r.generation_cost_usd as number | null,
    copiedAt: r.copied_at as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

const OUTBOUND_PATH_TO_WAITING: import('@/lib/domain/types').RelayRunStatus[] = [
  'detected', 'qualifying', 'qualified', 'preparing', 'awaiting_human', 'action_recorded', 'waiting',
]

function mapRelayEvent(r: Record<string, unknown>): import('@/lib/domain/types').RelayEvent {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    eventType: r.event_type as import('@/lib/domain/types').RelayEventType,
    entityType: r.entity_type as string,
    entityId: (r.entity_id as string) ?? null,
    actorType: (r.actor_type as import('@/lib/domain/types').RelayActorType) ?? 'system',
    actorId: (r.actor_id as string) ?? null,
    revenueIdentityId: (r.revenue_identity_id as string) ?? null,
    source: (r.source as string) ?? 'app',
    sourceEventId: (r.source_event_id as string) ?? null,
    correlationId: (r.correlation_id as string) ?? null,
    causationId: (r.causation_id as string) ?? null,
    relayRunId: (r.relay_run_id as string) ?? null,
    payload: (r.payload as Record<string, unknown>) ?? {},
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    occurredAt: r.occurred_at as string,
    createdAt: r.created_at as string,
  }
}

function mapRelayRun(r: Record<string, unknown>): import('@/lib/domain/types').RelayRun {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    runType: (r.run_type as import('@/lib/domain/types').RelayRunType) ?? 'outbound',
    primaryEntityType: (r.primary_entity_type as string) ?? 'lead',
    primaryEntityId: (r.primary_entity_id as string) ?? null,
    status: r.status as import('@/lib/domain/types').RelayRunStatus,
    currentStep: (r.current_step as string) ?? (r.status as string),
    assignedRepId: (r.assigned_rep_id as string) ?? null,
    revenueIdentityId: (r.revenue_identity_id as string) ?? null,
    correlationId: (r.correlation_id as string) ?? (r.id as string),
    startedAt: r.started_at as string,
    waitingUntil: (r.waiting_until as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
    failedAt: (r.failed_at as string) ?? null,
    failureCategory: (r.failure_category as string) ?? null,
    failureReason: (r.failure_reason as string) ?? null,
    context: (r.context as Record<string, unknown>) ?? {},
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapUpworkJob(r: Row): UpworkJob {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    ownerRepId: (r.owner_rep_id as string) ?? null,
    title: r.title as string,
    description: r.description as string,
    budgetMin: (r.budget_min as number) ?? null,
    budgetMax: (r.budget_max as number) ?? null,
    hourlyRateMin: (r.hourly_rate_min as number) ?? null,
    hourlyRateMax: (r.hourly_rate_max as number) ?? null,
    proposalCount: (r.proposal_count as number) ?? null,
    connectsCost: (r.connects_cost as number) ?? 0,
    requiredSkills: (r.required_skills as string[]) ?? [],
    urgencySignal: (r.urgency_signal as string) ?? null,
    score: (r.score as number) ?? null,
    verdict: (r.verdict as UpworkJob['verdict']) ?? null,
    canonicalScore: (r.canonical_score as number) ?? null,
    scoreVersion: (r.score_version as string) ?? null,
    scoreBreakdown: r.score_breakdown ?? null,
    jobFacts: r.job_facts ?? null,
    profileMatch: r.profile_match ?? null,
    status: (r.status as UpworkJob['status']) ?? 'new',
    extractedFields: (r.extracted_fields as Record<string, unknown>) ?? null,
    rawInput: (r.raw_input as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    screeningQuestions: (r.screening_questions as string[]) ?? [],
    applicationRequirements: (r.application_requirements as string[]) ?? [],
    engagementType: (r.engagement_type as string) ?? null,
    weeklyHours: (r.weekly_hours as string) ?? null,
    duration: (r.duration as string) ?? null,
    experienceLevel: (r.experience_level as string) ?? null,
    createdAt: r.created_at as string,
    postedAt: (r.posted_at as string) ?? null,
    remoteStatus: (r.remote_status as string) ?? null,
    clientName: (r.client_name as string) ?? null,
    clientEmail: (r.client_email as string) ?? null,
  }
}

function mapUpworkMessage(r: Row): UpworkMessage {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    jobId: r.job_id as string,
    repId: (r.rep_id as string) ?? null,
    type: r.type as UpworkMessage['type'],
    draftText: (r.draft_text as string) ?? null,
    sentText: (r.sent_text as string) ?? null,
    sentAt: (r.sent_at as string) ?? null,
    modelUsed: (r.model_used as string) ?? null,
    createdAt: r.created_at as string,
  }
}


function mapContentPersona(r: Record<string, unknown>): ContentPersona {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    repId: r.rep_id as string,
    displayName: r.display_name as string,
    platforms: (r.platforms as ContentPlatform[]) ?? [],
    voiceProfileId: (r.voice_profile_id as string) ?? null,
    humorStyle: (r.humor_style as string) ?? '',
    valuesAndOpinions: normalizeStringArray(r.values_and_opinions),
    admiredExamples: normalizeStringArray(r.admired_examples),
    contentProfileId: (r.content_profile_id as string) ?? null,
    personaRole: (r.persona_role as string) ?? undefined,
    personaCompany: (r.persona_company as string) ?? undefined,
    personaLocation: (r.persona_location as string) ?? undefined,
    contentComfort: normalizeStringArray(r.content_comfort),
    onboardingStep: (r.onboarding_step as string) ?? undefined,
    onboardingCompleted: (r.onboarding_completed as boolean) ?? undefined,
    onboardingData: (r.onboarding_data as Record<string, unknown>) ?? undefined,
    trendInterestProfile: (r.trend_interest_profile as TrendInterestProfile) ?? undefined,
    lastBriefAt: (r.last_brief_at as string) ?? undefined,
    createdAt: r.created_at as string,
  }
}

function mapContentPillar(r: Record<string, unknown>): ContentPillar {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    pillarName: r.pillar_name as string,
    description: (r.description as string) ?? '',
    createdAt: r.created_at as string,
  }
}

function mapContentDraft(r: Record<string, unknown>): ContentDraft {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    pillarId: (r.pillar_id as string) ?? null,
    topicClusterId: (r.topic_cluster_id as string) ?? null,
    researchFindingId: (r.research_finding_id as string) ?? null,
    structureId: (r.structure_id as string) ?? null,
    sourceKind: ((r.source_kind as ContentDraft['sourceKind']) ?? 'answer'),
    sourceMaterial: r.source_material as string,
    platform: r.platform as ContentPlatform,
    caption: (r.caption as string) ?? '',
    hookScore: (r.hook_score as number) ?? null,
    hookFeedback: (r.hook_feedback as string) ?? '',
    selfCheckPassed: (r.self_check_passed as boolean) ?? false,
    selfCheckNote: (r.self_check_note as string) ?? '',
    specificityHit: Boolean(r.specificity_hit),
    status: (r.status as ContentDraftStatus) ?? 'draft',
    createdAt: r.created_at as string,
  }
}

function mapContentHistory(r: Record<string, unknown>): ContentHistoryEntry {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    pillarId: (r.pillar_id as string) ?? null,
    topicClusterId: (r.topic_cluster_id as string) ?? null,
    platform: r.platform as ContentPlatform,
    openingLine: r.opening_line as string,
    postedAt: r.posted_at as string,
    ledToRealOutcome: Boolean(r.led_to_real_outcome ?? false),
    outcomeNotedAt: (r.outcome_noted_at as string) ?? null,
    likes: (r.likes as number) ?? null,
    reach: (r.reach as number) ?? null,
    comments: (r.comments as number) ?? null,
    reposts: (r.reposts as number) ?? null,
    saves: (r.saves as number) ?? null,
    profileVisits: (r.profile_visits as number) ?? null,
    followerDelta: (r.follower_delta as number) ?? null,
    metricsLoggedAt: (r.metrics_logged_at as string) ?? null,
  }
}

function mapPostStructure(r: Record<string, unknown>): ContentPostStructure {
  return {
    id: r.id as string,
    category: r.category as ContentPostStructure['category'],
    structureName: r.structure_name as string,
    shape: r.shape as string,
    example: (r.example as string) ?? '',
    createdAt: r.created_at as string,
  }
}

function mapTrendingAngle(r: Record<string, unknown>): TrendingAngle {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    pillarId: r.pillar_id as string,
    topicClusterId: (r.topic_cluster_id as string) ?? null,
    angleDescription: r.angle_description as string,
    sourceNote: (r.source_note as string) ?? '',
    sourceUrl: (r.source_url as string) ?? '',
    addedBy: (r.added_by as string) ?? null,
    addedAt: r.added_at as string,
    used: Boolean(r.used),
  }
}

function mapTopicCluster(r: Record<string, unknown>): TopicCluster {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    clusterName: r.cluster_name as string,
    description: (r.description as string) ?? '',
    sourceType: (r.source_type as TopicCluster['sourceType']) ?? 'system',
    mergedIntoId: (r.merged_into_id as string) ?? null,
    lastInputAt: (r.last_input_at as string) ?? null,
    lastResearchAt: (r.last_research_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapContentResearchFinding(r: Record<string, unknown>): ContentResearchFinding {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    topicClusterId: r.topic_cluster_id as string,
    finding: r.finding as string,
    sourceLabel: r.source_label as string,
    sourceUrl: r.source_url as string,
    sourcePublishedAt: (r.source_published_at as string) ?? null,
    createdAt: r.created_at as string,
    used: Boolean(r.used),
  }
}

function mapContentDraftFeedback(r: Record<string, unknown>): ContentDraftFeedback {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    draftId: r.draft_id as string,
    topicClusterId: (r.topic_cluster_id as string) ?? null,
    sourceKind: (r.source_kind as ContentDraftFeedback['sourceKind']) ?? 'answer',
    reaction: (r.reaction as ContentDraftFeedback['reaction']) ?? 'not_for_me',
    edited: Boolean(r.edited),
    editSignals: normalizeStringArray(r.edit_signals),
    createdAt: r.created_at as string,
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {} } catch { return {} }
  }
  return {}
}

function mapContentProfile(r: Record<string, unknown>): ContentProfile {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    role: (r.role as string) ?? '',
    seniority: (r.seniority as string) ?? '',
    industries: normalizeStringArray(r.industries),
    audience: (r.audience as string) ?? '',
    expertise: parseJsonArray(r.expertise) as ContentProfile['expertise'],
    technologies: parseJsonArray(r.technologies) as ContentProfile['technologies'],
    goals: parseJsonArray(r.goals) as ContentProfile['goals'],
    topicsCared: parseJsonArray(r.topics_cared) as ContentProfile['topicsCared'],
    topicsAvoided: parseJsonArray(r.topics_avoided) as ContentProfile['topicsAvoided'],
    opinions: parseJsonArray(r.opinions) as ContentProfile['opinions'],
    projects: parseJsonArray(r.projects) as ContentProfile['projects'],
    experiences: parseJsonArray(r.experiences) as ContentProfile['experiences'],
    writingCharacteristics: parseJsonObject(r.writing_characteristics) as ContentProfile['writingCharacteristics'],
    storytellingTendencies: parseJsonArray(r.storytelling_tendencies) as ContentProfile['storytellingTendencies'],
    confidence: (r.confidence as number) ?? 0,
    lastLearnedAt: (r.last_learned_at as string) ?? null,
    sources: (r.sources as ContentProfile['sources']) ?? undefined,
    audiences: normalizeStringArray(r.audiences),
    territories: normalizeStringArray(r.territories),
    voiceSamples: (r.voice_samples as ContentProfile['voiceSamples']) ?? undefined,
    voiceSelection: (r.voice_selection as string) ?? undefined,
    contentGoals: normalizeStringArray(r.content_goals),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapContentMemory(r: Record<string, unknown>): ContentMemory {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    memoryType: r.memory_type as ContentMemoryType,
    content: r.content as string,
    sourceDraftId: (r.source_draft_id as string) ?? null,
    sourceHistoryId: (r.source_history_id as string) ?? null,
    createdAt: r.created_at as string,
    embedding: (r.embedding as number[]) ?? null,
    contentFingerprint: (r.content_fingerprint as string) ?? null,
  }
}

function mapContentOpportunity(r: Record<string, unknown>): ContentOpportunity {
  const qual = parseJsonObject(r.qualification) as Record<string, unknown>
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    opportunityType: r.opportunity_type as ContentOpportunityType,
    title: r.title as string,
    description: r.description as string,
    trigger: r.trigger as string,
    qualification: {
      novelty: (qual.novelty as number) ?? undefined,
      evidenceStrength: (qual.evidence_strength as number) ?? undefined,
      personalSpecificity: (qual.personal_specificity as number) ?? undefined,
      relevance: (qual.relevance as number) ?? undefined,
      audienceFit: (qual.audience_fit as number) ?? undefined,
      scrollStopPotential: (qual.scroll_stop_potential as number) ?? undefined,
    },
    qualified: Boolean(r.qualified),
    sourceKind: (r.source_kind as ContentOpportunity['sourceKind']) ?? null,
    sourceReference: (r.source_reference as string) ?? null,
    status: (r.status as ContentOpportunity['status']) ?? 'pending',
    createdAt: r.created_at as string,
    dismissedAt: (r.dismissed_at as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
  }
}

function mapContentIdeaGenome(r: Record<string, unknown>): ContentIdeaGenome {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    source: r.source as IdeaGenomeSource,
    topic: r.topic as string,
    angle: r.angle as string,
    archetype: r.archetype as IdeaGenomeArchetype,
    audience: r.audience as string,
    emotion: (r.emotion as string) ?? null,
    value_type: (r.value_type as ContentIdeaGenome['value_type']) ?? null,
    novelty: (r.novelty as number) ?? 0,
    evidenceStrength: (r.evidence_strength as number) ?? 0,
    personalSpecificity: (r.personal_specificity as number) ?? 0,
    relevance: (r.relevance as number) ?? 0,
    conversationPotential: (r.conversation_potential as number) ?? 0,
    contentMemoryOverlap: parseJsonArray(r.content_memory_overlap) as string[],
    differentiationNote: (r.differentiation_note as string) ?? '',
    status: (r.status as ContentIdeaGenome['status']) ?? 'candidate',
    rejectionReason: (r.rejection_reason as string) ?? null,
    opportunityId: (r.opportunity_id as string) ?? null,
    draftId: (r.draft_id as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapContentEvaluation(r: Record<string, unknown>): ContentEvaluation {
  const qNotes = parseJsonObject(r.quality_notes) as Record<string, string>
  const dNotes = parseJsonObject(r.distribution_notes) as Record<string, string>
  return {
    id: r.id as string,
    draftId: r.draft_id as string,
    originality: (r.originality as number) ?? 0,
    personalSpecificity: (r.personal_specificity as number) ?? 0,
    usefulness: (r.usefulness as number) ?? 0,
    credibility: (r.credibility as number) ?? 0,
    evidence: (r.evidence as number) ?? 0,
    clarity: (r.clarity as number) ?? 0,
    storytelling: (r.storytelling as number) ?? 0,
    voiceMatch: (r.voice_match as number) ?? 0,
    stopPotential: (r.stop_potential as number) ?? 0,
    dwellPotential: (r.dwell_potential as number) ?? 0,
    commentPotential: (r.comment_potential as number) ?? 0,
    savePotential: (r.save_potential as number) ?? 0,
    sharePotential: (r.share_potential as number) ?? 0,
    audienceRelevance: (r.audience_relevance as number) ?? 0,
    slopScore: (r.slop_score as number) ?? 0,
    genericProbability: (r.generic_probability as number) ?? 0,
    qualityNotes: qNotes,
    distributionNotes: dNotes,
    createdAt: r.created_at as string,
  }
}

function mapContentInterviewSession(r: Record<string, unknown>): ContentInterviewSession {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personaId: r.persona_id as string,
    opportunityId: (r.opportunity_id as string) ?? null,
    sessionType: r.session_type as ContentInterviewSession['sessionType'],
    status: (r.status as ContentInterviewSession['status']) ?? 'active',
    questionsAsked: (r.questions_asked as number) ?? 0,
    informationGain: (r.information_gain as number) ?? 0,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null,
  }
}

function mapContentInterviewAnswer(r: Record<string, unknown>): ContentInterviewAnswer {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    question: r.question as string,
    answer: r.answer as string,
    informationGain: (r.information_gain as number) ?? 0,
    createdAt: r.created_at as string,
  }
}

function mapProofCard(r: Row): ProofCard {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    profileId: r.profile_id as string,
    capability: r.capability as string,
    strength: r.strength as ProofCard['strength'],
    safeClaim: r.safe_claim as string,
    sourceType: r.source_type as ProofCard['sourceType'],
    sourceReference: (r.source_reference as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    verified: Boolean(r.verified),
    forbiddenClaims: (r.forbidden_claims as string[]) ?? [],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

/** commercial_state keys used for memory/draft until the conversation-memory migration is applied. */
const MEMORY_FALLBACK_KEY = '__conversationMemory'
const DRAFT_FALLBACK_KEY = '__composerDraft'

function mapConversationState(r: Row): ConversationState {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    leadId: r.lead_id as string,
    stage: r.stage as ConversationState['stage'],
    lastSentAt: (r.last_sent_at as string) ?? null,
    lastSentMessageId: (r.last_sent_message_id as string) ?? null,
    lastReplyAt: (r.last_reply_at as string) ?? null,
    senderProfileId: (r.sender_profile_id as string) ?? null,
    lastStrategy: (r.last_strategy as string) ?? null,
    lastAngle: (r.last_angle as string) ?? null,
    lastCta: (r.last_cta as string) ?? null,
    followupCount: (r.followup_count as number) ?? 0,
    nextFollowupAt: (r.next_followup_at as string) ?? null,
    wonAt: (r.won_at as string) ?? null,
    lostAt: (r.lost_at as string) ?? null,
    lostReason: (r.lost_reason as string) ?? null,
    commercialState: (r.commercial_state as Record<string, unknown>) ?? null,
    memory: (r.memory as ConversationState['memory'])
      ?? ((r.commercial_state as Record<string, unknown> | null)?.[MEMORY_FALLBACK_KEY] as ConversationState['memory'])
      ?? null,
    composerDraft: r.composer_draft !== undefined
      ? (r.composer_draft as ConversationState['composerDraft']) ?? null
      : ((r.commercial_state as Record<string, unknown> | null)?.[DRAFT_FALLBACK_KEY] as ConversationState['composerDraft']) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapSalesMemory(r: Row): SalesMemory {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    memoryType: r.memory_type as SalesMemory['memoryType'],
    content: r.content as string,
    leadId: (r.lead_id as string) ?? null,
    profileId: (r.profile_id as string) ?? null,
    industry: (r.industry as string) ?? null,
    leadType: (r.lead_type as string) ?? null,
    channel: (r.channel as string) ?? null,
    stage: (r.stage as string) ?? null,
    outcome: (r.outcome as SalesMemory['outcome']) ?? null,
    occurrenceCount: (r.occurrence_count as number) ?? 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }


}

// ═════════════════════════════════════════════════════════════════════════════
// Helper functions (outside class)
// ═════════════════════════════════════════════════════════════════════════════
