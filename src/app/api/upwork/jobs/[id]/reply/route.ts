import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current'
import { createScoutStore } from '@/lib/store'
import { generate } from '@/lib/ai/runtime'
import { injectStyleCard } from '@/lib/style/inject'
import { BANNED_PHRASES, AI_TELL_PHRASES } from '@/lib/writing/engine'

/**
 * POST /api/upwork/jobs/[id]/reply
 * Generate a reply to a client message on Upwork.
 * Body: { clientMessage: string, proposalContext?: string }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { clientMessage?: string; proposalContext?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  if (!body.clientMessage) {
    return NextResponse.json({ error: 'clientMessage is required.' }, { status: 400 })
  }

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const store = await createScoutStore()
  const job = await store.getUpworkJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const voiceProfile = await store.getVoiceProfile()
  const styleCard = injectStyleCard(voiceProfile?.styleCard)

  const systemPrompt = [
    'You are a senior Upwork freelancer who wins interviews and clients.',
    '',
    styleCard ? `SENDER VOICE (mandatory):\n${styleCard}` : '',
    '',
    '## REPLY STRATEGY',
    '',
    'The client sent you a message on Upwork. Reply to move the deal forward.',
    '',
    '### RULES:',
    '- Be specific to THEIR message — reference what they actually said',
    '- Show you understand their problem',
    '- Be warm, professional, concise (50-150 words max)',
    '- NEVER use first-contact openers ("came across your job", "Building AI...")',
    '- NEVER use placeholders like "%" or "[X]%"',
    `- No banned phrases: ${BANNED_PHRASES.slice(0, 8).join(', ')}.`,
    `- No AI tells: ${AI_TELL_PHRASES.slice(0, 8).join(', ')}.`,
    '',
    '### CLIENT MESSAGE CONTEXT:',
    body.clientMessage,
    '',
    body.proposalContext ? `### YOUR ORIGINAL PROPOSAL:\n${body.proposalContext}` : '',
    '',
    '### JOB DETAILS:',
    `Title: ${job.title}`,
    job.description ? `Description: ${job.description.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n\n')

  const schema = {
    type: 'object',
    required: ['reply', 'self_check_passed', 'self_check_note'],
    properties: {
      reply: { type: 'string' },
      self_check_passed: { type: 'boolean' },
      self_check_note: { type: 'string' },
    },
  } as const

  try {
    const result = await generate<{ reply: string; self_check_passed: boolean; self_check_note: string }>({
      task: 'FAST_STRUCTURED',
      system: systemPrompt,
      user: 'Write a reply that moves the deal forward. Return JSON: {"reply": "...", "self_check_passed": true/false, "self_check_note": "..."}',
      schema: schema as unknown as Record<string, unknown>,
      maxTokens: 512,
      temperature: 0.6,
      feature: 'reply',
      callSite: 'upwork:reply',
      jobId: id,
    })

    let reply = result.data.reply.trim()

    // Clean placeholders
    reply = reply.replace(/\bby\s*%/g, 'significantly')
    reply = reply.replace(/\b%\s*(increase|reduction|improvement)/g, '$1')
    reply = reply.replace(/\[\s*%\s*]/g, '')
    reply = reply.replace(/\(\s*%\s*\)/g, '')

    // Remove banned phrases
    for (const phrase of BANNED_PHRASES.slice(0, 10)) {
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      reply = reply.replace(re, '')
    }

    return NextResponse.json({
      reply: reply.replace(/\s{2,}/g, ' ').trim(),
      selfCheckPassed: result.data.self_check_passed,
      selfCheckNote: result.data.self_check_note,
    })
  } catch {
    return NextResponse.json({ error: 'Reply generation failed. Please try again.' }, { status: 500 })
  }
}
