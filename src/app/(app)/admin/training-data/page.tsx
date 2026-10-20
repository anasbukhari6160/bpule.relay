import { requireProductAdmin } from '@/lib/auth/admin-page'
import { TrainingDataCenter } from '@/components/admin/training-data-center'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export default async function TrainingDataPage() {
  await requireProductAdmin()
  return <TrainingDataCenter />
}
