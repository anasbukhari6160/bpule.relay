import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current'
import { createScoutStore } from '@/lib/store'
import { PersonaDailyPostView } from '@/components/relay/persona-daily-post'

export const dynamic = 'force-dynamic'

export default async function PersonaDailyPage() {
  const user = await getCurrentUser()
  if (!user) notFound()

  const store = await createScoutStore()
  const personas = await store.listContentPersonas(user.rep.id)

  if (personas.length === 0) notFound()

  const persona = personas[0]

  return (
    <PersonaDailyPostView
      personaId={persona.id}
      personaName={persona.displayName}
      initialPlatform={persona.platforms.includes('x') ? 'x' : 'linkedin'}
    />
  )
}
