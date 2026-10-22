/**
 * Tests that drive the real AI pipeline need a provider key. CI runs without
 * any provider credentials on purpose (see .github/workflows/ci.yml), so those
 * tests skip there instead of failing — they still run, and pass, wherever a
 * key is present.
 */

export const HAS_AI_PROVIDER = Boolean(
  process.env.OPENAI_API_KEY
  || process.env.GROQ_API_KEY
  || process.env.LONGCAT_API_KEY
  || process.env.DEEPSEEK_API_KEY
  || process.env.FIREWORKS_API_KEY,
)

/** True when the service-role Supabase client can be constructed. */
export const HAS_SERVICE_SUPABASE = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
)
