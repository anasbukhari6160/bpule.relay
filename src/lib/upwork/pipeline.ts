import type { UpworkJobStatus } from '@/lib/domain/types'

/** Stages the live upwork_jobs check constraint accepts. */
export interface UpworkStage {
  key: UpworkJobStatus
  label: string
  detail: string
}

export const UPWORK_OPEN_STAGES: UpworkStage[] = [
  { key: 'new', label: 'Saved', detail: 'On your list. No proposal yet.' },
  { key: 'drafted', label: 'Draft ready', detail: 'Written. Not submitted on Upwork.' },
  { key: 'applied', label: 'Proposal sent', detail: 'Submitted. Connects are spent.' },
  { key: 'replied', label: 'Client replied', detail: 'The client wrote back.' },
]

export const UPWORK_CLOSE_STAGES: UpworkStage[] = [
  { key: 'no', label: 'Passed', detail: 'You are done with this job.' },
  { key: 'dead', label: 'Closed', detail: 'The post is gone or no longer worth it.' },
]

const LEGACY_LABEL: Partial<Record<UpworkJobStatus, string>> = {
  shortlisted: 'Shortlisted',
  interviewing: 'Interview',
  offer_sent: 'Offer',
  awarded: 'Hired',
  rejected: 'Declined',
}

export function upworkStageLabel(status: UpworkJobStatus): string {
  return [...UPWORK_OPEN_STAGES, ...UPWORK_CLOSE_STAGES].find((stage) => stage.key === status)?.label
    ?? LEGACY_LABEL[status]
    ?? status
}

export function upworkStageDetail(status: UpworkJobStatus): string {
  return [...UPWORK_OPEN_STAGES, ...UPWORK_CLOSE_STAGES].find((stage) => stage.key === status)?.detail
    ?? 'This mark is not a stage you can work. Move the job onto the Upwork path.'
}

export function isLegacyUpworkStatus(status: UpworkJobStatus): boolean {
  return status in LEGACY_LABEL
}
