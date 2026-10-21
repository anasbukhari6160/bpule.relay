/**
 * Reply Strategies API — multi-strategy reply suggestions with explanations.
 *
 * POST /api/leads/[id]/reply-strategies
 * Body: { replyText: string, replyToMessageId?: string }
 *
 * Returns 2-3 reply strategies with:
 * - intent classification
 * - recommended approach
 * - risk flags
 * - "why this reply" explanation
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase/service'
import { getAuthContext } from '@/lib/auth/organization'
import {
  analyzeReply,
  buildReplyStrategy,
  buildDeterministicConversationSummary,
} from '@/lib/relay/conversation-engine'
import { resolveConversationIntent, classifyClientMessage, type IntentClass } from '@/lib/conversation/intent'
import type { ReplyContext } from '@/lib/relay/conversation-engine'

export const maxDuration = 30

export interface ReplyStrategy {
  id: string
  label: string
  approach: string
  tone: string
  intent: string
  explanation: string
  risks: string[]
  confidence: number
  cta: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params
  // Browser-triggered: resolve the signed-in rep from the request session, not
  // a service-role client (QA RQA-016).
  const auth = await getAuthContext()
  if (!auth) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const store = createServiceSupabase()
  const body = await req.json().catch(() => ({}))
  const replyText = body.replyText ?? ''
  const replyToMessageId = body.replyToMessageId ?? null

  if (!replyText.trim()) {
    return NextResponse.json({ error: 'replyText is required.' }, { status: 400 })
  }

  // Fetch lead + messages for context
  const { data: lead } = await store
    .from('leads')
    .select('id, company, contact_name, contact_title, status, canonical_score, direction, organization_id')
    .eq('id', leadId)
    .eq('organization_id', auth.orgId)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  // Fetch messages for conversation context
  const { data: messages } = await store
    .from('messages')
    .select('id, type, sent_text, draft_text, direction, sent_at, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(50)

  // Classify the inbound reply
  const msgIntent = classifyClientMessage(replyText)
  const clientMessages = (messages ?? [])
    .filter(m => m.direction === 'inbound' && m.sent_text)
    .map(m => m.sent_text!)
  const conversationIntent = resolveConversationIntent([...clientMessages, replyText])

  // Build conversation stage
  const conversationStage = (
    conversationIntent.declined ? 'replied' as const :
    conversationIntent.deferred ? 'contacted' as const :
    conversationIntent.class === 'POSITIVE' ? 'interested' as const :
    conversationIntent.class === 'QUESTION' ? 'qualifying' as const : 'contacted' as const
  )

  const priorMessages = (messages ?? [])
    .filter(m => m.sent_text)
    .map(m => ({
      id: m.id,
      organizationId: lead.organization_id ?? auth.orgId,
      leadId: lead.id,
      repId: auth.repId,
      type: m.type ?? 'dm' as const,
      draftText: m.draft_text ?? null,
      sentText: m.sent_text!,
      sentAt: m.sent_at ?? null,
      modelUsed: null,
      direction: (m.direction ?? 'outbound') as 'outbound' | 'inbound',
      createdAt: m.created_at ?? new Date().toISOString(),
    }))

  const context: ReplyContext = {
    leadId: lead.id,
    leadCompany: lead.company ?? '',
    contactName: lead.contact_name ?? null,
    replyText,
    priorMessages,
    conversationStage,
    senderProfileId: null,
  }

  // Analyze the reply
  const analysis = analyzeReply(replyText, context)

  // Generate multiple strategies
  const strategies: ReplyStrategy[] = []

  // Strategy 1: Primary (from conversation engine)
  const primaryStrategy = buildReplyStrategy(analysis, context, null)

  strategies.push({
    id: 'primary',
    label: 'Recommended',
    approach: primaryStrategy.goal,
    tone: primaryStrategy.tone,
    intent: analysis.intent,
    explanation: buildExplanation(analysis, primaryStrategy, lead.company ?? '', lead.contact_name ?? null),
    risks: buildRiskFlags(analysis, conversationIntent, lead.status ?? '', lead.canonical_score ?? null),
    confidence: analysis.buyingSignal ? 0.8 : 0.5,
    cta: primaryStrategy.ctaStrategy,
  })

  // Strategy 2: Clarify (for questions/objections)
  if (analysis.intent === 'question' || analysis.intent === 'objection') {
    strategies.push({
      id: 'clarify',
      label: 'Clarify first',
      approach: 'Answer their question fully before pitching',
      tone: 'helpful',
      intent: analysis.intent,
      explanation: 'They asked a specific question. Answering builds trust before any next step.',
      risks: ['May delay the sale if over-answered'],
      confidence: 0.6,
      cta: 'Provide a clear, concise answer then propose a low-friction next step',
    })
  }

  // Strategy 3: Close (for positive/buying signals)
  if (conversationIntent.class === 'POSITIVE' || analysis.buyingSignal) {
    strategies.push({
      id: 'close',
      label: 'Move to meeting',
      approach: 'Capitalize on their interest — propose a specific time',
      tone: 'confident',
      intent: analysis.intent,
      explanation: 'They showed buying signals. Strike while warm with a concrete meeting proposal.',
      risks: ['Too aggressive if they were just being polite'],
      confidence: analysis.buyingSignal ? 0.75 : 0.4,
      cta: 'Propose a 15-min call with a specific time option',
    })
  }

  // Strategy 4: Nurture (for deferred/not now)
  if (conversationIntent.deferred || conversationIntent.class === 'NEGATIVE') {
    strategies.push({
      id: 'nurture',
      label: 'Stay warm',
      approach: 'Acknowledge their timing and leave the door open',
      tone: 'light',
      intent: analysis.intent,
      explanation: 'They are not ready now. A light touch keeps you top-of-mind without pressure.',
      risks: ['May lose momentum entirely'],
      confidence: 0.7,
      cta: 'Send a brief acknowledgment and suggest reconnecting in 2-4 weeks',
    })
  }

  return NextResponse.json({
    strategies: strategies.slice(0, 3),
    analysis: {
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      buyingSignal: analysis.buyingSignal,
      objections: analysis.objections,
      questions: analysis.questions,
    },
    conversationSummary: buildDeterministicConversationSummary(context),
  })
}

function buildExplanation(
  analysis: ReturnType<typeof analyzeReply>,
  strategy: ReturnType<typeof buildReplyStrategy>,
  company: string,
  contactName: string | null,
): string {
  const parts: string[] = []

  if (analysis.buyingSignal) {
    parts.push(`${contactName ?? 'They'} showed buying interest`)
  }
  if (analysis.questions.length > 0) {
    parts.push(`asked about ${analysis.questions.slice(0, 2).join(' and ')}`)
  }
  if (analysis.objections.length > 0) {
    parts.push(`raised: "${analysis.objections[0]}"`)
  }

  if (parts.length === 0) {
    parts.push('General engagement — keep the conversation moving')
  }

  return `${strategy.goal}. Because ${parts.join(', ')}.`
}

function buildRiskFlags(
  analysis: ReturnType<typeof analyzeReply>,
  conversationIntent: ReturnType<typeof resolveConversationIntent>,
  status: string,
  score: number | null,
): string[] {
  const risks: string[] = []

  if (conversationIntent.declined) {
    risks.push('They may have already declined — consider closing instead')
  }
  if (status === 'followed_up' && (score ?? 0) < 50) {
    risks.push('Lead has low score and multiple follow-ups — risk of annoyance')
  }
  if (conversationIntent.class === 'NEGATIVE') {
    risks.push('Negative sentiment detected — pushing forward may damage relationship')
  }

  return risks
}
