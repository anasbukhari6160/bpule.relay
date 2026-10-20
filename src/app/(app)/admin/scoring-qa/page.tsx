import { requireProductAdmin } from '@/lib/auth/admin-page'
import { ScoringQaCenter } from '@/components/admin/scoring-qa-center'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export default async function ScoringQaPage() {
  await requireProductAdmin()
  return <ScoringQaCenter />
}
