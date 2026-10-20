import { requireProductAdmin } from '@/lib/auth/admin-page'
import { DatasetCenter } from '@/components/admin/dataset-center'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export default async function DatasetPage() {
  await requireProductAdmin()
  return <DatasetCenter />
}
