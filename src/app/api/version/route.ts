import { NextResponse } from 'next/server'
import { SCORING_VERSION } from '@/lib/intelligence-v3/versions'
import { BUYER_INTENT_VERSION } from '@/lib/intelligence-v3/buyer-intent'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

// Evaluated once when the route is prerendered at build time.
const BUILT_AT = new Date().toISOString()

/**
 * Read-only build identity, so a deployed runtime can be compared with the
 * intended source. Values come from Vercel's build metadata when present;
 * otherwise `sha` is null and the deploy is reported as unidentified.
 * Nothing here is a secret.
 */
export function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    ?? process.env.GIT_COMMIT_SHA
    ?? null
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? null
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? null
  return NextResponse.json(
    {
      sha,
      shortSha: sha ? sha.slice(0, 7) : null,
      ref,
      deploymentId,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      buildTime: process.env.BUILD_TIME ?? BUILT_AT,
      scoringVersion: SCORING_VERSION,
      buyerIntentVersion: BUYER_INTENT_VERSION,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
