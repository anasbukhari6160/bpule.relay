import { redirect } from 'next/navigation'
import { requireProductAdmin } from '@/lib/auth/admin-page'

export const dynamic = 'force-dynamic'

// Identities now live next to the profiles they are built from.
export default async function RevenueIdentitiesPage() {
  await requireProductAdmin()
  redirect('/profile-intelligence?tab=identities')
}
