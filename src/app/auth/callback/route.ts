import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

type CookieMutation = {
  name: string
  value: string
  options?: Record<string, unknown>
}

function applyCookieMutations(response: NextResponse, mutations: CookieMutation[]): NextResponse {
  for (const mutation of mutations) {
    response.cookies.set(
      mutation.name,
      mutation.value,
      mutation.options as Parameters<typeof response.cookies.set>[2],
    )
  }
  return response
}

function parseRequestCookies(request: Request): Array<{ name: string; value: string }> {
  const cookie = request.headers.get('cookie')
  if (!cookie) return []
  return cookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf('=')
      if (index < 0) return { name: item, value: '' }
      return {
        name: item.slice(0, index),
        value: item.slice(index + 1),
      }
    })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const requested = url.searchParams.get('next') || '/'
  let redirectTo = '/'
  try {
    const parsed = new URL(requested, url.origin)
    if (parsed.origin === url.origin && parsed.pathname.startsWith('/')) {
      redirectTo = parsed.pathname
    }
  } catch {
    redirectTo = '/'
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', url.origin))
  }

  const cookieMutations: CookieMutation[] = []

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
    cookies: {
      getAll() {
        return parseRequestCookies(request)
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          cookieMutations.push({
            name: cookie.name,
            value: cookie.value,
            options: cookie.options as Record<string, unknown>,
          })
        }
      },
    },
  })

  if (!code) {
    return applyCookieMutations(
      NextResponse.redirect(new URL('/login?error=missing_code', url.origin)),
      cookieMutations,
    )
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return applyCookieMutations(
      NextResponse.redirect(new URL('/login?error=auth_callback_failed', url.origin)),
      cookieMutations,
    )
  }

  const authUserId = data.user?.id
  if (authUserId) {
    const { data: rep } = await supabase
      .from('reps')
      .select('id')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (!rep) {
      await supabase.auth.signOut()
      return applyCookieMutations(
        NextResponse.redirect(new URL('/login?error=no_workspace', url.origin)),
        cookieMutations,
      )
    }
  }

  return applyCookieMutations(
    NextResponse.redirect(new URL(redirectTo, url.origin)),
    cookieMutations,
  )
}
