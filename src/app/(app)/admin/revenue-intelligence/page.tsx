import { requireProductAdmin } from '@/lib/auth/admin-page'
import { RevenueIntelligenceDashboard } from '@/components/admin/revenue-intelligence-dashboard'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export default async function RevenueIntelligencePage() {
  await requireProductAdmin()
  return <RevenueIntelligenceDashboard />
}
