import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current'
import { getAuthContext } from '@/lib/auth/organization'
import { CommandCenterV2 } from '@/components/admin/command-center-v2'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const authCtx = await getAuthContext()
  if (user.rep.role !== 'admin' && !authCtx?.isOwner && !authCtx?.isAdmin) {
    redirect('/dashboard')
  }

  return <CommandCenterV2 orgId={authCtx?.orgId ?? ''} />
}
