/**
 * Semantic capability taxonomy — Phase 11/12 of the 360° scoring program.
 *
 * Fit used to be token overlap between a prospect's words and a flat list of
 * org capability strings. Ambiguous tokens ("go", "security", "integration",
 * "mobile") matched on their own. This module maps terms to CAPABILITY
 * FAMILIES and requires context for the ambiguous ones:
 *
 *   "go" counts only as "golang", "Go developer", "written in Go";
 *   "security" counts only as application / cloud / data security;
 *   "integration" counts only with API / system / payment / CRM context;
 *   "mobile" counts only as mobile app / iOS / Android / React Native.
 *
 * Both sides of a fit comparison (what the opportunity needs, what the org or
 * a sender can deliver) are expressed in the same families, so overlap is a
 * set comparison, not a substring test. Deterministic, no AI.
 */

export type CapabilityFamily =
  | 'web_frontend'
  | 'backend_api'
  | 'fullstack_product'
  | 'mobile'
  | 'ai_ml'
  | 'data_engineering'
  | 'cloud_devops'
  | 'payments_fintech'
  | 'ecommerce'
  | 'cms_marketing_sites'
  | 'security_compliance'
  | 'integration_automation'
  | 'web3'
  | 'design_ux'
  | 'qa_testing'
  | 'enterprise_java_dotnet'
  | 'php_laravel'
  | 'ruby_rails'
  | 'python_backend'
  | 'go_rust_systems'

export interface CapabilityMatch {
  family: CapabilityFamily
  label: string
  /** The terms or phrases that produced the match (normalized). */
  evidence: string[]
  /** True when an ambiguous token was accepted because its context qualified it. */
  contextual: boolean
}

interface FamilySpec {
  family: CapabilityFamily
  label: string
  /** Terms that identify the family on their own. */
  strong: RegExp
  /** Ambiguous terms accepted only when `requires` also matches the surrounding context. */
  contextual?: Array<{ term: RegExp; requires: RegExp }>
}

const W = (s: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(?:${s})(?=$|[^\\p{L}\\p{N}])`, 'iu')

export const CAPABILITY_FAMILIES: readonly FamilySpec[] = [
  {
    family: 'web_frontend', label: 'Web frontend',
    strong: W('react(?:\\.js)?(?!\\s+native)|next(?:\\.js|js)|vue(?:\\.js)?|nuxt|angular|svelte(?:kit)?|tailwind|frontend|front[- ]end|ui\\s+engineering|typescript\\s+frontend|spa|web\\s+app(?:lication)?s?|web\\s+platform|web\\s+portal'),
  },
  {
    family: 'backend_api', label: 'Backend & APIs',
    strong: W('backend|back[- ]end|node(?:\\.js|js)?|express(?:\\.js)?|nest(?:\\.js|js)|fastify|graphql|rest(?:ful)?\\s+apis?|api\\s+(?:development|design|platform)|microservices?|postgres(?:ql)?|mysql|mongodb|redis|supabase|prisma|server[- ]side'),
    contextual: [{ term: W('apis?'), requires: /\b(?:build|develop|design|integrat|backend|platform|endpoint|service)/i }],
  },
  {
    family: 'fullstack_product', label: 'Full-stack product delivery',
    strong: W('full[- ]?stack|mvp|saas\\s+(?:product|platform|app|development)|product\\s+(?:development|engineering|build)|build\\s+(?:a|our|the)\\s+(?:product|platform|app)|end[- ]to[- ]end\\s+(?:development|delivery)|dev\\s+shop|development\\s+(?:agency|partner|team)|custom\\s+software'),
  },
  {
    family: 'mobile', label: 'Mobile apps',
    strong: W('ios|android|react\\s+native|flutter|swift(?:ui)?|kotlin|expo|mobile\\s+(?:app|apps|application|development|dev|engineer|team)|app\\s+store|play\\s+store'),
    contextual: [{ term: W('mobile'), requires: /\b(?:app|apps|application|ios|android|react\s+native|flutter|develop|build)\b/i }],
  },
  {
    family: 'ai_ml', label: 'AI & machine learning',
    strong: W('ai|artificial\\s+intelligence|machine\\s+learning|ml|llms?|gpt|openai|anthropic|claude|rag|retrieval[- ]augmented|nlp|computer\\s+vision|deep\\s+learning|agents?\\s+(?:platform|workflow|pipeline)|ai\\s+agents?|copilots?|langchain|vector\\s+(?:db|database|search)|embeddings?|fine[- ]tun\\w+|prompt\\s+engineering'),
  },
  {
    family: 'data_engineering', label: 'Data engineering & analytics',
    strong: W('data\\s+(?:engineering|pipeline|pipelines|platform|warehouse|lake|infrastructure)|etl|elt|analytics\\s+(?:platform|dashboard|pipeline)|dashboards?|bi\\s+(?:tool|platform)|snowflake|bigquery|databricks|dbt|airflow|spark|kafka'),
  },
  {
    family: 'cloud_devops', label: 'Cloud & DevOps',
    strong: W('aws|amazon\\s+web\\s+services|azure|gcp|google\\s+cloud|kubernetes|k8s|docker|terraform|devops|sre|ci/cd|infrastructure|cloud\\s+(?:migration|architecture|native|platform|infra)|serverless|lambda'),
    contextual: [{ term: W('cloud'), requires: /\b(?:aws|azure|gcp|migrat|infra|architect|deploy|kubernetes|devops|platform)/i }],
  },
  {
    family: 'payments_fintech', label: 'Payments & fintech',
    strong: W('stripe|payments?\\s+(?:integration|platform|processing|gateway|api|flow|rails)|payment\\s+(?:system|infrastructure)|fintech|banking\\s+(?:api|platform|app)|open\\s+banking|plaid|billing\\s+(?:system|platform|integration)|subscriptions?\\s+billing|kyc|aml|ledger'),
    contextual: [{ term: W('payments?'), requires: /\b(?:integrat|build|process|gateway|checkout|stripe|platform|api|flow)/i }],
  },
  {
    family: 'ecommerce', label: 'E-commerce',
    strong: W('shopify|woocommerce|magento|bigcommerce|e-?commerce|ecommerce|online\\s+store|storefront|headless\\s+commerce|checkout\\s+(?:flow|experience)|marketplace\\s+(?:platform|app|build)'),
  },
  {
    family: 'cms_marketing_sites', label: 'CMS & marketing sites',
    strong: W('wordpress|webflow|contentful|sanity|strapi|headless\\s+cms|cms|landing\\s+pages?|marketing\\s+(?:site|website)|company\\s+website|website\\s+(?:redesign|rebuild|build)'),
  },
  {
    family: 'security_compliance', label: 'Security & compliance',
    strong: W('cybersecurity|cyber\\s*security|appsec|application\\s+security|cloud\\s+security|penetration\\s+test\\w*|pen\\s*test\\w*|soc\\s*2|iso\\s*27001|hipaa|gdpr\\s+compliance|compliance\\s+(?:automation|platform|tooling)|security\\s+(?:audit|review|hardening|engineering|tooling|platform)|zero\\s+trust|iam'),
    contextual: [{ term: W('security'), requires: /\b(?:app|application|cloud|data|software|platform|audit|compliance|engineering|infra|network|api)\b/i }],
  },
  {
    family: 'integration_automation', label: 'Integrations & automation',
    strong: W('zapier|make\\.com|n8n|workflow\\s+automation|process\\s+automation|rpa|crm\\s+integration|hubspot|salesforce\\s+(?:integration|api|development)|erp\\s+integration|api\\s+integrations?|system\\s+integrations?|webhooks?|automation\\s+(?:platform|pipeline|workflows?)'),
    contextual: [
      { term: W('integrations?'), requires: /\b(?:api|system|crm|erp|payment|platform|third[- ]party|tool|hubspot|salesforce|stripe|data)\b/i },
      { term: W('automation'), requires: /\b(?:workflow|process|business|sales|marketing|ai|pipeline|back[- ]office|ops)\b/i },
    ],
  },
  {
    family: 'web3', label: 'Web3 & blockchain',
    strong: W('web3|blockchain|solidity|smart\\s+contracts?|defi|nfts?|ethereum|solana|crypto\\s+(?:exchange|wallet|platform)|tokenomics'),
  },
  {
    family: 'design_ux', label: 'Product design & UX',
    strong: W('ui/ux|ux|ui\\s+design|product\\s+design|figma|design\\s+system|user\\s+experience|prototyp\\w+|wireframes?'),
  },
  {
    family: 'qa_testing', label: 'QA & testing',
    strong: W('qa|quality\\s+assurance|test\\s+automation|automated\\s+testing|playwright|cypress|selenium|e2e\\s+tests?'),
  },
  {
    family: 'enterprise_java_dotnet', label: 'Java / .NET enterprise',
    strong: W('java|spring(?:\\s+boot)?|\\.net|dotnet|c#|asp\\.net|azure\\s+functions|enterprise\\s+(?:software|application|systems?)'),
  },
  {
    family: 'php_laravel', label: 'PHP / Laravel',
    strong: W('php|laravel|symfony'),
  },
  {
    family: 'ruby_rails', label: 'Ruby on Rails',
    strong: W('ruby|rails|ruby\\s+on\\s+rails'),
  },
  {
    family: 'python_backend', label: 'Python services',
    strong: W('python|django|fastapi|flask'),
  },
  {
    family: 'go_rust_systems', label: 'Go / Rust systems',
    strong: W('golang|rust|go\\s+(?:developer|engineer|backend|service|services|microservices?|lang)|written\\s+in\\s+go|in\\s+go\\b'),
    contextual: [{ term: W('go'), requires: /\b(?:golang|microservice|backend|developer|engineer|concurrency|grpc|written\s+in)\b/i }],
  },
]

export const CAPABILITY_FAMILY_LABEL: Record<CapabilityFamily, string> = Object.fromEntries(
  CAPABILITY_FAMILIES.map((f) => [f.family, f.label]),
) as Record<CapabilityFamily, string>

export const ALL_CAPABILITY_FAMILIES: readonly CapabilityFamily[] = CAPABILITY_FAMILIES.map((f) => f.family)

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Map free terms (skills, stack tokens, requested capabilities) and an
 * optional context text to capability families. A term that only matches a
 * family's `contextual` rule is accepted only when the surrounding text
 * satisfies the requirement.
 */
export function mapToCapabilities(terms: string[], contextText = ''): CapabilityMatch[] {
  const ctx = norm(contextText)
  const out = new Map<CapabilityFamily, CapabilityMatch>()
  const add = (spec: FamilySpec, evidence: string, contextual: boolean) => {
    const cur = out.get(spec.family)
    if (cur) {
      if (!cur.evidence.includes(evidence)) cur.evidence.push(evidence)
      if (!contextual) cur.contextual = false
      return
    }
    out.set(spec.family, { family: spec.family, label: spec.label, evidence: [evidence], contextual })
  }

  const candidates = [...new Set(terms.map(norm).filter((t) => t.length > 0 && t.length <= 60))]
  for (const term of candidates) {
    for (const spec of CAPABILITY_FAMILIES) {
      if (spec.strong.test(term)) { add(spec, term, false); continue }
      for (const rule of spec.contextual ?? []) {
        if (rule.term.test(term) && (rule.requires.test(ctx) || rule.requires.test(term))) add(spec, term, true)
      }
    }
  }

  // Phrases that appear in the context itself (e.g. "we need help with our
  // Stripe integration") count as evidence too, so a request that names a
  // capability in a sentence is not lost because no token list carried it.
  if (ctx) {
    for (const spec of CAPABILITY_FAMILIES) {
      const m = ctx.match(spec.strong)
      if (m) add(spec, m[0].trim(), false)
      for (const rule of spec.contextual ?? []) {
        const t = ctx.match(rule.term)
        if (t && rule.requires.test(ctx)) add(spec, t[0].trim(), true)
      }
    }
  }

  return [...out.values()].sort((a, b) => a.family.localeCompare(b.family))
}

export interface CapabilityOverlap {
  matched: CapabilityFamily[]
  missing: CapabilityFamily[]
  /** Share of needed families the other side covers, 0-1; 0 when nothing is needed. */
  coverage: number
}

/** Set comparison between what an opportunity needs and what a side can deliver. */
export function capabilityOverlap(needs: readonly CapabilityFamily[], offered: readonly CapabilityFamily[]): CapabilityOverlap {
  const have = new Set(offered)
  const matched = needs.filter((n) => have.has(n))
  const missing = needs.filter((n) => !have.has(n))
  return { matched, missing, coverage: needs.length === 0 ? 0 : matched.length / needs.length }
}

/**
 * Default organization capability set expressed as families. Overridable per
 * organization once profiles carry structured capability data.
 */
export const DEFAULT_ORG_CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  'web_frontend', 'backend_api', 'fullstack_product', 'mobile', 'ai_ml', 'data_engineering', 'cloud_devops',
  'payments_fintech', 'ecommerce', 'cms_marketing_sites', 'integration_automation', 'design_ux', 'qa_testing',
  'enterprise_java_dotnet', 'php_laravel', 'python_backend', 'security_compliance',
]
