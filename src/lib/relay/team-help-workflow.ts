/**
 * Team Closing Workflow — state machine for collaboration on a lead.
 *
 * Roles: OWNER, BEST_SENDER, HELPER, ADMIN
 * Actions: ask for help, refer, request proof, request review, hand off
 * States: IDLE → HELP_REQUESTED → HELP_ACCEPTED → HELP_COMPLETED
 */

export type LeadRole = 'OWNER' | 'BEST_SENDER' | 'HELPER' | 'ADMIN'

export type HelpType =
  | 'TECHNICAL_PROOF'
  | 'BETTER_SENDER'
  | 'MESSAGE_REVIEW'
  | 'PRICING_GUIDANCE'
  | 'CLOSING_HELP'

export type HelpStatus = 'IDLE' | 'HELP_REQUESTED' | 'HELP_ACCEPTED' | 'HELP_COMPLETED'

export interface HelpRequest {
  id: string
  leadId: string
  fromRepId: string
  fromRepName: string | null
  toRepId: string
  toRepName: string | null
  helpType: HelpType
  status: HelpStatus
  context: {
    leadScore: number | null
    scoreLabel: string | null
    reasonForHelp: string
    suggestedAction: string
    leadCompany: string | null
    leadContact: string | null
    senderMatch: number | null
    bestSenderName: string | null
  }
  createdAt: string
  respondedAt: string | null
  resolution: string | null
}

export interface HelpActionResult {
  success: boolean
  helpRequest?: HelpRequest
  error?: string
}

const VALID_TRANSITIONS: Record<HelpStatus, HelpStatus[]> = {
  IDLE: ['HELP_REQUESTED'],
  HELP_REQUESTED: ['HELP_ACCEPTED', 'IDLE'],   // accepted or cancelled
  HELP_ACCEPTED: ['HELP_COMPLETED', 'IDLE'],   // completed or abandoned
  HELP_COMPLETED: [],
}

export function canTransition(from: HelpStatus, to: HelpStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function createHelpRequest(params: {
  leadId: string
  fromRepId: string
  fromRepName?: string | null
  toRepId: string
  toRepName?: string | null
  helpType: HelpType
  reasonForHelp: string
  leadScore?: number | null
  scoreLabel?: string | null
  suggestedAction?: string
  leadCompany?: string | null
  leadContact?: string | null
  senderMatch?: number | null
  bestSenderName?: string | null
}): HelpRequest {
  return {
    id: `help_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    leadId: params.leadId,
    fromRepId: params.fromRepId,
    fromRepName: params.fromRepName ?? null,
    toRepId: params.toRepId,
    toRepName: params.toRepName ?? null,
    helpType: params.helpType,
    status: 'HELP_REQUESTED',
    context: {
      leadScore: params.leadScore ?? null,
      scoreLabel: params.scoreLabel ?? null,
      reasonForHelp: params.reasonForHelp,
      suggestedAction: params.suggestedAction ?? 'review and assist',
      leadCompany: params.leadCompany ?? null,
      leadContact: params.leadContact ?? null,
      senderMatch: params.senderMatch ?? null,
      bestSenderName: params.bestSenderName ?? null,
    },
    createdAt: new Date().toISOString(),
    respondedAt: null,
    resolution: null,
  }
}

export function transitionHelpRequest(
  request: HelpRequest,
  newStatus: HelpStatus,
  resolution?: string,
): HelpRequest {
  if (!canTransition(request.status, newStatus)) {
    return request
  }
  return {
    ...request,
    status: newStatus,
    respondedAt: newStatus !== 'IDLE' ? new Date().toISOString() : request.respondedAt,
    resolution: resolution ?? request.resolution,
  }
}

export function describeHelpType(helpType: HelpType): string {
  switch (helpType) {
    case 'TECHNICAL_PROOF': return 'Need technical proof'
    case 'BETTER_SENDER': return 'Need a better sender'
    case 'MESSAGE_REVIEW': return 'Need message review'
    case 'PRICING_GUIDANCE': return 'Need pricing guidance'
    case 'CLOSING_HELP': return 'Need closing help'
  }
}

export function helpRequestSummary(request: HelpRequest): string {
  const { context } = request
  const parts: string[] = [
    `${describeHelpType(request.helpType)}`,
  ]
  if (context.leadCompany) parts.push(`re: ${context.leadCompany}`)
  if (context.leadScore !== null) parts.push(`Score: ${context.leadScore}/100`)
  if (context.bestSenderName && request.helpType === 'BETTER_SENDER') {
    parts.push(`Best sender: ${context.bestSenderName}`)
  }
  if (context.reasonForHelp) parts.push(`"${context.reasonForHelp}"`)
  return parts.join(' — ')
}
