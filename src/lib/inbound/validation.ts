import type { InboundInput, LeadSource } from '@/lib/domain/types'

const SOURCES = new Set<LeadSource>(['linkedin', 'upwork', 'email', 'referral', 'other'])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export interface ValidatedInboundAnalysisInput extends InboundInput {
  source: LeadSource
}

export interface ValidatedInboundLeadInput extends ValidatedInboundAnalysisInput {
  company: string
  assignedProfileId: string | null
  idempotencyKey: string | null
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): ValidationResult<string> {
  const value = body[field]
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string.` }
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, error: `${field} is required.` }
  if (trimmed.length > max) return { ok: false, error: `${field} is too long.` }
  return { ok: true, value: trimmed }
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): ValidationResult<string | null> {
  const value = body[field]
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string or null.` }
  const trimmed = value.trim()
  if (trimmed.length > max) return { ok: false, error: `${field} is too long.` }
  return { ok: true, value: trimmed || null }
}

function source(body: Record<string, unknown>): ValidationResult<LeadSource> {
  const value = body.source ?? 'other'
  if (typeof value !== 'string' || !SOURCES.has(value as LeadSource)) {
    return { ok: false, error: 'source is invalid.' }
  }
  return { ok: true, value: value as LeadSource }
}

function common(value: unknown): ValidationResult<ValidatedInboundAnalysisInput> {
  const body = record(value)
  if (!body) return { ok: false, error: 'Request body must be an object.' }

  const message = requiredString(body, 'message', 25_000)
  if (!message.ok) return message
  const parsedSource = source(body)
  if (!parsedSource.ok) return parsedSource

  const company = optionalString(body, 'company', 300)
  if (!company.ok) return company
  const contactName = optionalString(body, 'contactName', 200)
  if (!contactName.ok) return contactName
  const contactTitle = optionalString(body, 'contactTitle', 300)
  if (!contactTitle.ok) return contactTitle
  const url = optionalString(body, 'url', 2_048)
  if (!url.ok) return url
  if (url.value) {
    try {
      const parsed = new URL(url.value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'url must use http or https.' }
      }
    } catch {
      return { ok: false, error: 'url must be a valid URL.' }
    }
  }
  const profileInfo = optionalString(body, 'profileInfo', 25_000)
  if (!profileInfo.ok) return profileInfo
  const jobInfo = optionalString(body, 'jobInfo', 25_000)
  if (!jobInfo.ok) return jobInfo
  const context = optionalString(body, 'context', 25_000)
  if (!context.ok) return context

  const totalLength = message.value.length
    + (profileInfo.value?.length ?? 0)
    + (jobInfo.value?.length ?? 0)
    + (context.value?.length ?? 0)
  if (totalLength > 60_000) return { ok: false, error: 'Inbound input is too long.' }

  return {
    ok: true,
    value: {
      message: message.value,
      source: parsedSource.value,
      company: company.value,
      contactName: contactName.value,
      contactTitle: contactTitle.value,
      url: url.value,
      profileInfo: profileInfo.value,
      jobInfo: jobInfo.value,
      context: context.value,
    },
  }
}

export function validateInboundAnalysisBody(value: unknown): ValidationResult<ValidatedInboundAnalysisInput> {
  return common(value)
}

export function validateInboundLeadBody(value: unknown): ValidationResult<ValidatedInboundLeadInput> {
  const body = record(value)
  const parsed = common(value)
  if (!body || !parsed.ok) return parsed as ValidationResult<ValidatedInboundLeadInput>

  const company = requiredString(body, 'company', 300)
  if (!company.ok) return company
  const assignedProfileId = optionalString(body, 'assignedProfileId', 128)
  if (!assignedProfileId.ok) return assignedProfileId
  if (assignedProfileId.value && !IDENTIFIER.test(assignedProfileId.value)) {
    return { ok: false, error: 'assignedProfileId is invalid.' }
  }
  const idempotencyKey = optionalString(body, 'idempotencyKey', 128)
  if (!idempotencyKey.ok) return idempotencyKey
  if (idempotencyKey.value && !IDENTIFIER.test(idempotencyKey.value)) {
    return { ok: false, error: 'idempotencyKey is invalid.' }
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      company: company.value,
      assignedProfileId: assignedProfileId.value,
      idempotencyKey: idempotencyKey.value,
    },
  }
}
