/**
 * Deterministic facts read directly from the pasted source.
 *
 * Every fact carries the verbatim source line it came from, so scoring rows
 * and decision guards can cite the text instead of asserting an inference.
 * Pure functions — no AI calls — shared by input classification, the V3
 * decision guard, the score engine and the evidence ledger.
 */

import {
  ML_CANDIDATE_SEEKING,
  ML_EMPLOYMENT_HIRING,
  ML_EXTERNAL_REQUEST,
  ML_SELLER_OWNERSHIP,
  mlMatches,
} from './multilingual'

export interface SourceLine {
  /** Verbatim line from the source (trimmed). */
  line: string
}

export interface CommercialRequestFacts {
  /** Explicit request to buy from an external provider (agency, vendor, contractor, outsourced team). */
  externalServiceRequest: SourceLine | null
  /** Employee recruitment (we're hiring, full-time role, submit your CV). */
  employmentHiring: SourceLine | null
}

export interface StatedBudget extends SourceLine {
  amount: string
  approved: boolean
}

export interface StatedTimeline extends SourceLine {
  /** Days until the stated start/deadline. 0 = immediately. */
  days: number
  label: string
}

const NEGATION_BEFORE = /\b(?:no|not|without|never)\s+(?:an?\s+|any\s+)?$/i

const EXTERNAL_PROVIDER =
  /\b(?:agenc(?:y|ies)|vendors?|outsourc\w*|external\s+(?:software\s+|development\s+|engineering\s+|dev\s+|devops\s+)?(?:team|partner|agency|provider|company|firm)s?|(?:development|software|engineering|technology|devops)\s+partners?|staff\s+augmentation|dev(?:elopment)?\s+shops?|software\s+(?:house|consultancy|firm)s?|consultanc(?:y|ies)|contractors?|freelancers?|developers?)\b/i

const REQUEST_CONTEXT =
  /\b(?:looking\s+for|seeking|searching\s+for|need(?:s|ed)?(?:\s+a\s+(?:developer|agency|contractor|vendor|freelancer))?|hire|hiring|engage|want(?:s|ed)?\s+to\s+(?:hire|work\s+with|engage)|invit(?:e|ing)|request(?:ing)?\s+(?:proposals?|quotes?)|rfp|should\s+(?:contact|reach|submit|send|apply)|send\s+(?:us\s+)?(?:a\s+)?(?:proposal|quote)|submit\s+(?:a\s+)?(?:proposal|quote))\b/i

/**
 * Explicit request for a developer/provider to help with a product/project.
 * "Looking for a developer to help scale our product" is a buyer request.
 * Excludes internal hiring: "hiring a developer to join our internal team".
 */
const DEVELOPER_REQUEST =
  /\b(?:looking\s+for|seeking|need(?:s|ed)?|want(?:s|ed)?\s+(?:to\s+)?(?:hire|work\s+with|engage))\s+(?:a\s+)?(?:developer|dev|engineer|programmer)\b/i

/**
 * Asking for an outside team or partner to deliver a project ("Looking for a
 * remote team to help build our mobile wallet", "Help us build…", "We've
 * tried agencies before…"). The purpose clause separates outsourcing a build
 * from recruiting a teammate. This is the one request grammar — the V2
 * commercial-reading patterns are claims checked against it.
 */
const PROJECT_TEAM_REQUEST =
  /\b(?:looking\s+for|seeking|searching\s+for|need)\s+(?:a|an)\s+(?:[\w/.+-]+\s+){0,4}?(?:team|partner|squad|studio)\s+(?:to|who\s+can)\s+(?:help\s+(?:us\s+)?)?(?:build|develop|ship|design|create|rebuild|scale|launch|finish)\b|\bhelp\s+us\s+build\b|\b(?:we(?:'|’)?ve|we\s+have)\s+tried\s+(?:agencies|contractors|freelancers|vendors)\s+before\b/i

/** Internal hiring context that overrides developer request classification. */
const INTERNAL_HIRING_CONTEXT =
  /\b(?:join\s+(?:our|the|my)\s+(?:internal\s+)?(?:team|company|startup|firm|crew)|as\s+(?:a\s+)?(?:full[- ]time|permanent|in[- ]?house))\b/i

const EMPLOYMENT_HIRING: RegExp[] = [
  /\b(?:we(?:'|')?re|we\s+are|now|currently|is)\s+hiring\b/i,
  /\bhiring\s+(?:a|an|for|our|multiple|several|\d+)\b/i,
  // "Hiring: 3x React developers for a fintech client" — a recruiter posting
  // roles, not a buyer request (QA BUG-14-02).
  /\bhiring\s*[:：]?\s*(?:\d+|a|an|two|three|four|five|multiple|several)/i,
  /\bjoin\s+our\s+(?:\w+\s+){0,3}team\b/i,
  /\b(?:submit|send|share|attach)\s+(?:your|their|a|an)?\s*(?:cv|resume|résumé)\b/i,
  /\b(?:interested|qualified|suitable)\s+candidates\b/i,
  /\bopen\s+(?:role|position|vacanc(?:y|ies))\b/i,
  /\bjob\s+(?:opening|vacancy|description)\b/i,
  /\bapply\s+(?:now|here|via|through|on)\b/i,
  /\bcontractors?\s+needed\b/i,
]

// Historical hiring patterns — reject these as current hiring signals
const HISTORICAL_HIRING_CTX = [
  /\b(?:people\s+hired\s+(?:to|for|by)|hired\s+(?:people|folks|team|developers?)\s+(?:to|for))\b/i,
  /\b(?:my\s+(?:team|crew|staff)\s+(?:has|includes|grew\s+to))\b/i,
  /\b(?:previously\s+(?:hired|employed)|former\s+(?:team|employee|hire))\b/i,
  /\b(?:experience\s+(?:of\s+|in\s+)?hiring|years?\s+(?:of\s+)?(?:hiring|recruiting))\b/i,
  /\b(?:at\s+my\s+(?:previous|former)\s+(?:company|role|firm))\b/i,
  /\b(?:headcount|team\s+size|grew\s+from|scaled\s+(?:the\s+)?team)\b/i,
  /\b(?:people\s+hired\s+to\s+(?:protect|defend|maintain|support))\b/i,
]

function isHistoricalHiring(line: string): boolean {
  return HISTORICAL_HIRING_CTX.some(re => {
    re.lastIndex = 0
    return re.test(line)
  })
}

/**
 * Service offering patterns: a person/company offering their services to
 * others who might be hiring. "If you're hiring for X, let's connect" is a
 * service offering — NOT a buyer request, NOT a hiring event.
 */
const SERVICE_OFFERING =
  /\b(?:if\s+you(?:'|’)?re\s+(?:hiring|looking|seeking|need)|if\s+you\s+(?:are\s+)?(?:hiring|looking|seeking|need)|if\s+your\s+(?:team|company)\s+(?:is\s+)?(?:hiring|looking|needs?)|hiring\?|looking\?|need\?)\b.*\b(?:let(?:'|’)?s\s+(?:connect|talk|chat)|dm\s+(?:me|us)|reach\s+(?:out|me)|contact\s+(?:me|us)|know\s+(?:great|good|awesome)|i\s+(?:can|may)|message\s+(?:me|us)|we\s+(?:can|have\s+capacity)|our\s+team\s+has)\b/i

/**
 * Customer discovery patterns: asking for feedback on a product, talking to
 * users/founders. NOT an external help request.
 */
const CUSTOMER_DISCOVERY =
  /\b(?:feedback\s+(?:on\s+)?(?:my|our|this|the)\s+(?:product|app|platform|feature|idea|mvp|prototype|saas)|talking\s+(?:to|with)\s+(?:founders|users|customers|people)|customer\s+discovery|interviewing\s+(?:founders|users|customers)|research\s+(?:with|on)\s+(?:founders|users|customers)|would\s+love\s+(?:your\s+)?feedback|i(?:|')d\s+love\s+(?:your\s+)?feedback)\b/i

/**
 * Job-seeking patterns: the person themselves is looking for opportunities.
 * "I'm open to contract/full-time opportunities" is CANDIDATE, not HIRING.
 */
const JOB_SEEKING =
  /\b(?:(?:i(?:'|’)?m|i\s+am)\s+(?:open\s+to|looking\s+for|seeking|available\s+for)\s+(?:my\s+|a\s+|new\s+){0,2}(?:contract|full[- ]time|part[- ]time|permanent|freelance|work|employment|opportunities|opportunity|roles?|positions?|challenges?|gigs|projects|next\s+(?:role|position|opportunity|challenge|gig))|open\s+to\s+(?:new\s+)?(?:work|opportunities|roles|positions|contract|freelance)|#?opentowork|available\s+for\s+(?:hire|work|contract|freelance|projects|new\s+missions?)|available\s+for\s+(?:contract|freelance)\s+(?:work|projects|react|node|\w+\s+projects)|looking\s+for\s+(?:my\s+)?(?:next\s+(?:role|position|opportunity|challenge|gig))|(?:seeking|looking\s+for)\s+(?:a\s+)?(?:cto|vp|head|senior|staff|lead|engineering)\s+(?:\w+\s+){0,2}?(?:position|role)\b|my\s+role\s+was\s+affected|recent\s+layoffs?,?\s+i)\b/i

/**
 * Employment metadata rows like "Tencyle · Full-time", "CEO · Full-time",
 * "VP Engineering · Full-time" describe a person's employment status — they
 * are NOT hiring events. Guard: a line matching hiring patterns must also
 * contain a hiring verb, not just a position/employment-type word.
 */
const HIRING_VERB = /\b(?:hiring|recruiting|join|submit|apply|looking\s+for|seeking|need\s+(?:a|an|our)|open\s+(?:role|position)|job\s+(?:opening|vacancy))\b/i
const EMPLOYMENT_METADATA = /·.*\b(?:full[- ]time|part[- ]time|permanent|contract)\b|·\s*\b(?:ceo|cto|cfo|vp|director|manager|engineer|developer|founder|lead|head)\b.*\b(?:full[- ]time|part[- ]time|permanent|contract)\b/i

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function isNegatedAt(line: string, index: number): boolean {
  return NEGATION_BEFORE.test(line.slice(Math.max(0, index - 14), index))
}

/** First match of `re` in `line` that is not preceded by a negation. */
function firstAffirmedMatch(line: string, re: RegExp): RegExpExecArray | null {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m: RegExpExecArray | null
  while ((m = global.exec(line)) !== null) {
    if (!isNegatedAt(line, m.index)) return m
  }
  return null
}

/** "developer tools", "developer advocate", "freelancer friends": the noun is not a provider being sought. */
const PROVIDER_NOUN_AS_MODIFIER = /\b(?:developer|developers|freelancer|freelancers|contractor|contractors|vendor|vendors|agency|agencies|consultancy)\s+(?:tools?|advocate|advocacy|experience|community|conference|friends?|relations|lock-?in|market|ecosystem|portal|renovation|fees?|list)\b/i

/**
 * First-person procurement verbs: the sender's own organization is evaluating
 * or sourcing external providers. These are buyer-side only — a conditional
 * ("If your team is evaluating...") or third-party framing must NOT match.
 * The "we are" prefix is the key guard against seller false positives.
 */
const FIRST_PERSON_PROCUREMENT =
  /\bwe(?:'|’)?re\s+(?:currently\s+)?(?:evaluating|assessing|considering|reviewing|sourcing|scouting|procuring)\b|\bwe\s+(?:are\s+)?(?:evaluating|assessing|considering|reviewing|sourcing|scouting|procuring)\b/i

/** A named or first-person delegate explicitly tasked with sourcing a provider. */
const DELEGATED_PROCUREMENT =
  /\b(?:i|we|[\p{Lu}][\p{L}'’.-]+)\s+(?:(?:have|has)\s+been|was|am|are)?\s*(?:assigned|asked|tasked|authorized|authorised)\s+to\s+(?:find|source|evaluate|select|engage|hire)\b/iu

function isExternalServiceLine(line: string): boolean {
  if (hasThirdPartySubject(line) || isAdviceOrHypothetical(line) || isNonProviderRequest(line)) return false
  if (DEVELOPER_REQUEST.test(line) && !INTERNAL_HIRING_CONTEXT.test(line) && !PROVIDER_NOUN_AS_MODIFIER.test(line)) return true
  // First-person procurement: "We are evaluating external agencies" — buyer-side
  // only. Requires a first-person "we are" prefix so seller conditionals like
  // "If your team is evaluating..." do not match.
  if (FIRST_PERSON_PROCUREMENT.test(line)) {
    const procIdx = line.search(FIRST_PERSON_PROCUREMENT)
    const tail = line.slice(procIdx, procIdx + 100)
    const provider = firstAffirmedMatch(tail, EXTERNAL_PROVIDER)
    if (provider && !PROVIDER_NOUN_AS_MODIFIER.test(tail)) return true
  }
  if (DELEGATED_PROCUREMENT.test(line)) {
    const delegatedIdx = line.search(DELEGATED_PROCUREMENT)
    const tail = line.slice(delegatedIdx, delegatedIdx + 120)
    const provider = firstAffirmedMatch(tail, EXTERNAL_PROVIDER)
    if (provider && !PROVIDER_NOUN_AS_MODIFIER.test(tail)) return true
  }
  const request = line.match(REQUEST_CONTEXT)
  if (!request) return false
  // The provider noun must be the object of the request: within the clause
  // that follows the request verb, not anywhere in the line.
  const tail = line.slice(request.index ?? 0, (request.index ?? 0) + 90)
  const provider = firstAffirmedMatch(tail, EXTERNAL_PROVIDER)
  if (!provider) return false
  if (PROVIDER_NOUN_AS_MODIFIER.test(tail)) return false
  return true
}

/**
 * Recruiter header patterns: the person is recruiting for clients, not buying.
 * "Looking for developers for multiple clients" from a recruiter is not a
 * buyer request — the recruiter is the intermediary.
 */
const RECRUITER_HEADER =
  /\b(?:technical\s+recruiter|tech\s+recruiter|it\s+recruiter|recruiter|rekruter(?:ka)?|talent\s+(?:acquisition|partner|specialist)|sourcer|headhunter|hiring\s+manager)\b/i
const RECRUITER_CTX = /\b(?:for\s+(?:my|our|multiple)\s+clients?|at\s+(?:my|our|multiple)\s+clients?|(?:my|our)\s+clients?\s+(?:is|are|needs?|wants?))\b/i

/**
 * Seller ownership: the line is the prospect's own organization offering or
 * promoting what it sells ("We built…", "Our platform helps…", "Bring us the
 * workflow", "Request services"). Seller-owned lines describe supply, never a
 * request to buy, so they can raise commercial potential but not buyer intent.
 * The single seller grammar for the codebase — buyer provenance and the
 * buyer-intent resolver read it from here.
 */
const SELLER_OWNERSHIP: RegExp[] = [
  // Offering services to the reader / to clients. "We build a payments
  // platform" is a PRODUCT statement (builder), not an offer — building
  // words only count when the beneficiary is clients, companies or "you".
  /\bwe(?:(?:'|’)ve)?\s+(?:offer|provide|help|deliver|specialize\s+in|specialise\s+in|evaluate|assess|serve|work\s+with|partner\s+with|advise)\b/i,
  /\b(?:we|i)\s+(?:build|built|develop|design|create|ship)\s+(?:\w+\s+){0,4}?(?:for|with)\s+(?:our\s+)?(?:clients?|customers|companies|brands|startups|founders|teams|businesses|enterprises|you)\b/i,
  /\b(?:i|we)\s+(?:help|partner\s+with|advise|coach|consult\s+(?:for|with))\s+(?:\w+\s+){0,2}?(?:companies|startups|founders|teams|businesses|brands|clients|enterprises|leaders|organi[sz]ations|smbs|smes)\b/i,
  /\bhelping\s+(?:\w+\s+){0,2}?(?:companies|startups|founders|teams|businesses|brands|clients|enterprises|organi[sz]ations|smbs|smes)\s+(?:\w+\s+){0,3}?(?:build|ship|scale|grow|launch|modernize|modernise|succeed|hire|find|streamline|reduce|accelerate|automate)\b/i,
  /\bi\s+(?:specialize|specialise)\s+in\b/i,
  // Modal offers to the reader: "we can help you…", "we'll evaluate it…".
  /\bwe(?:(?:'|’)ll|\s+can|\s+will|\s+could)\s+(?:help|offer|provide|deliver|evaluate|assess|audit|automate|handle|get\s+you|take\s+care)\b/i,
  /\bour\s+(?:product|platform|tool|software|solution|service|team|agency|firm|practice|studio)s?\s+(?:helps?|lets?|enables?|evaluates?|assesses?|automates?|gives?|delivers?|provides?|has\s+capacity|is\s+(?:used|trusted|built))\b/i,
  /\bour\s+(?:services?|solutions?|offerings?)\b|\bour\s+(?:customers|clients)\b(?!\s+(?:portal|dashboard|app|data|tracking|support|success|onboarding|experience|platform))/i,
  /\bbring\s+us\b/i,
  /\b(?:try|book|request|get|schedule)\s+(?:a\s+|our\s+|your\s+)?(?:product|demo|services?|free\s+trial|trial|(?:free\s+)?consultation|assessment|call\s+with\s+(?:our|us|me))\b/i,
  /\bhire\s+(?:us|me|our\s+team)\b/i,
  /\blet\s+(?:us|me)\s+(?:help|build|create|design|handle)\b/i,
  /\bwe(?:'|’)?re\s+(?:an?\s+)?(?:agency|consultancy|dev\s+shop|studio)\b|\bwe\s+are\s+an?\s+(?:\w+\s+){0,2}?(?:agency|consultancy|dev\s+shop|studio|software\s+house)\b/i,
  // "I run AgentAce, a software development agency…" — first-person ownership of a services firm.
  /\b(?:i|we)\s+(?:run|own|lead|founded|started|operate)\s+[^.\n]{0,50}?,\s+an?\s+(?:\w+[\s-]+){0,3}?(?:agency|consultancy|dev\s+shop|studio|software\s+house|outsourcing\s+(?:company|firm)|services\s+(?:company|firm))\b/i,
  /\bworking\s+with\s+(?:\w+\s+){0,3}clients\b/i,
  /\bclient\s+(?:work|projects?|engagements?)\b/i,
  /\b(?:your|the)\s+(?:next\s+)?project\s+could\s+be\s+next\b|\bfor\s+your\s+next\s+(?:project|build|app)\b|\bdiscuss\s+your\s+project\b/i,
  /\b(?:fractional|interim)\s+(?:cto|cmo|cfo|coo)\b|\bconsulting\s+engagements?\b|\bavailable\s+for\s+consulting\b/i,
  /\bcase\s+stud(?:y|ies)\b.*\b(?:client|customer)\b|\bnew\s+case\s+study\b/i,
  /\b(?:rate\s+card|pricing\s+starts\s+at|starts\s+at\s+[$€£]\d)\b/i,
  // A services menu: "Services: Web Development, …", "Our services include…".
  /^(?:services?|our\s+services?|what\s+we\s+offer|offerings?)\s*:/i,
  /\b(?:services|solutions)\s+(?:for|to)\s+(?:websites|businesses|companies|startups|enterprises|brands|clients)\b/i,
]

/**
 * The seller grammar that must win over a first-person-request reading.
 * "Looking for React projects" starts with "looking for" but is the prospect
 * seeking work, not a request to buy — so it is checked before the
 * first-person-request override.
 */
const SELLER_GRAMMAR: RegExp[] = [
  /\b(?:i|we)\s+(?:am|are)\s+(?:a\s+|an\s+)?(?:freelance|independent|self[- ]employed|contract(?:or)?|solo|boutique)\b/i,
  // "I'm a freelance React dev" — the apostrophe form is the common one and
  // must read as the prospect selling, not buying (QA RQA-021).
  /\b(?:i|we)(?:'|’)?m\s+(?:a\s+|an\s+)?(?:freelance|independent|self[- ]employed|contract(?:or)?|solo|boutique)\b/i,
  // "I'm a React dev ... open to projects" / "we're open to new clients".
  /\b(?:i|we)(?:'|’)?m\s+(?:a\s+|an\s+)?[\w\s]{0,40}?\bopen\s+to\s+(?:new\s+)?(?:projects?|work|clients?|gigs?|contracts?|hire|opportunities?)\b/i,
  /\b(?:looking|searching|seeking)\s+for\s+(?:new\s+)?(?:clients?|projects?|work|gigs?|contracts?|assignments?|missions?)\b/i,
  /\b(?:i|we)\s+can\s+(?:help|build|develop|design|create|ship|deliver|automate)\b/i,
  /\bavailable\s+for\s+(?:new\s+)?(?:projects?|work|clients?|gigs?|contracts?|hire)\b/i,
  // An invitation addressed to the reader is a seller offer only when it names
  // a need to be filled — "contact me if you need a developer" is the prospect
  // selling; "message me if you have done this before" is a buyer inviting a
  // reply, and "if you love dense UI, DM me" is a hiring post.
  /\b(?:contact|reach|dm|message|email)\s+(?:me|us)\s+if\s+(?:you|your\s+(?:team|company|organization))\b[^.\n]{0,50}\b(?:need|needs|hire|hiring|looking|seeking|want|interested)\b/i,
  /\b(?:if|when)\s+(?:you|your\s+(?:team|company|organization))\b[^.\n]{0,60}\b(?:need|needs|hire|hiring|looking|seeking|want)\b[^.\n]{0,60}\b(?:contact|reach|dm|message|email)\s+(?:me|us)\b/i,
]

/** The prospect asking for something themselves — overrides a seller reading on the same line. */
const FIRST_PERSON_REQUEST =
  /\b(?:we(?:'|’)?re|we\s+are|i(?:'|’)?m|i\s+am|we|i)\s+(?:(?:currently|now|actively|urgently|also)\s+)?(?:looking\s+for|seeking|searching\s+for|need|hiring|want\s+to\s+(?:hire|engage|work\s+with)|(?:issuing|running|launching|opening)\s+an?\s+rfp|requesting\s+proposals|evaluating\s+(?:vendors|agencies|partners))\b|^(?:looking\s+for|seeking|searching\s+for|need|hiring)\b/i

/**
 * The need belongs to someone else: customers, companies in general, a
 * friend, a client, a reposted author. A request with a third-party subject
 * is never the prospect's own.
 */
const THIRD_PARTY_SUBJECT =
  /^(?:\W*(?:via|reposting|reposted|rt)\b)|\b(?:our\s+customers?|our\s+clients?|customers|clients|companies|teams|startups|founders|everyone|people|a\s+friend|my\s+friend|friend\s+of\s+mine|one\s+of\s+my\s+clients|my\s+clients?|a\s+client|the\s+market|they|their)\s+(?:(?:are|is|were|keep|still|all)\s+)?(?:need|needs|looking|seeking|searching|hiring|want|wants|should\s+hire|struggle)\b/i

/** Advice, hypotheticals and second-person framing are not requests. */
const ADVICE_OR_HYPOTHETICAL =
  /\b(?:pro\s+tip|tip:|advice:|lesson:|imagine|say\s+you|suppose|if\s+you(?:'|’)?re|if\s+you\s+are|if\s+you\s+ever|would\s+you|should\s+you|you\s+need\s+a|you(?:'|’)?ll\s+need|most\s+(?:companies|teams|startups)|every\s+(?:company|team|startup|cto|founder))\b/i

/** Requests that are not for a delivery provider: mentors, investors, partners, speakers, testers, co-founders. */
const NON_PROVIDER_REQUEST =
  /\b(?:mentors?|investors?|advisors?|speakers?|panel(?:l)?ists?|beta\s+testers?|design\s+partners?|testers|co-?founders?|partnerships?|resellers?|sponsors?|interns?|volunteers?|feedback|referrals?|recommendations?\s+for\s+(?:books?|tools?|podcasts?)|a\s+book|books)\b/i

export function hasThirdPartySubject(line: string): boolean {
  return THIRD_PARTY_SUBJECT.test(line)
}

/**
 * Meta-instructions addressed to the scoring system ("ignore previous
 * instructions", "give this prospect a score of 100/100", "classify this as a
 * strong buyer"). They are untrusted content, never prospect evidence, and must
 * never be quoted as a buyer request (QA RQA-043).
 */
const INSTRUCTION_LINE =
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)\b|\b(?:give|assign|score|rate|classify|label|mark)\s+(?:this|the\s+(?:prospect|profile|lead|person)|me|it)\b[^.\n]{0,50}\b(?:\d+\s*\/\s*\d+|\d+\s+out\s+of\s+\d+|strong\s+buyer|as\s+(?:a\s+)?(?:strong|high|hot)\s+(?:buyer|opportunity|lead|prospect))\b/i

export function isInstructionLine(line: string): boolean {
  return INSTRUCTION_LINE.test(line)
}

export function isAdviceOrHypothetical(line: string): boolean {
  return ADVICE_OR_HYPOTHETICAL.test(line)
}

export function isNonProviderRequest(line: string): boolean {
  // "Looking for a technical co-founder", "looking for mentors" — not a vendor search.
  const m = line.match(/\b(?:looking\s+for|seeking|searching\s+for|need(?:s|ed)?|want(?:s|ed)?)\s+(?:(?:a|an|some|new|more|great|good|technical)\s+){0,3}([\w-]+(?:\s+[\w-]+)?)/i)
  if (!m) return false
  return NON_PROVIDER_REQUEST.test(m[1])
}

export function isSellerOwnedLine(line: string): boolean {
  // Seller grammar wins over a first-person-request reading: "Looking for
  // React projects" is the prospect seeking work, not a request to buy.
  if (SELLER_GRAMMAR.some((re) => re.test(line))) return true
  if (FIRST_PERSON_REQUEST.test(line) || mlMatches(ML_EXTERNAL_REQUEST, line)) return false
  return SELLER_OWNERSHIP.some((re) => re.test(line)) || mlMatches(ML_SELLER_OWNERSHIP, line)
}

/** A current prospect-owned commercial fact, not seller, third-party, hypothetical or injected text. */
export function isBuyerOwnedCommercialFactLine(line: string): boolean {
  return Boolean(
    line
      && !isSellerOwnedLine(line)
      && !hasThirdPartySubject(line)
      && !isAdviceOrHypothetical(line)
      && !isInstructionLine(line),
  )
}

export interface SellerOwnership {
  isSeller: boolean
  /** Verbatim seller-owned lines, in source order. */
  lines: string[]
}

export function detectSellerOwnership(rawText: string): SellerOwnership {
  const owned = lines(rawText).filter(isSellerOwnedLine)
  return { isSeller: owned.length > 0, lines: owned }
}

/**
 * Classify a single line of source text.
 * Priority: service_offering > seller_offering > customer_discovery > job_seeking > recruiter > external_request > employment_hiring
 */
export type LineClassification = 'service_offering' | 'seller_offering' | 'customer_discovery' | 'job_seeking' | 'recruiter' | 'external_request' | 'employment_hiring' | 'neutral'

/** "Say you are hiring…", "if you're hiring…", "right now the hiring market…" — not an opening. */
const SECOND_PERSON_OR_GENERIC_HIRING = /\b(?:say\s+you(?:'|’)?(?:re|\s+are)?\s+hiring|if\s+you(?:'|’)?(?:re|\s+are)?\s+(?:hiring|looking|need)|when\s+you(?:'|’)?(?:re|\s+are)?\s+hiring|you(?:'|’)?re\s+hiring|you\s+are\s+hiring|the\s+hiring\s+market|hiring\s+market|hiring\s+manager\s+(?:for|is)|hiring\s+is\s+(?:brutal|hard|tough|broken))\b/i
/** Openings that are closed: paused, frozen, filled, no longer. */
const HIRING_CLOSED = /\b(?:no\s+longer\s+hiring|paused\s+hiring|hiring\s+(?:freeze|paused|is\s+paused|stopped)|role\s+(?:has\s+been\s+)?filled|position\s+(?:has\s+been\s+)?filled|not\s+hiring)\b/i
/** "We are not looking for an agency", "we don't need outside help", "never outsourced". */
const NEGATED_REQUEST = /\b(?:not|never|no\s+longer|aren(?:'|’)?t|don(?:'|’)?t|do\s+not|won(?:'|’)?t|without|haven(?:'|’)?t|have\s+never)\s+(?:currently\s+|actively\s+|really\s+|ever\s+)?(?:looking|seeking|searching|hiring|need|needed|want|in\s+the\s+market|outsourced?|hired?\s+an?\s+agency|used\s+an?\s+agency)\b/i

export function isNegatedRequest(line: string): boolean {
  return NEGATED_REQUEST.test(line)
}

export function classifyLine(line: string): LineClassification {
  if (isInstructionLine(line)) return 'neutral'
  if (SERVICE_OFFERING.test(line)) return 'service_offering'
  if (isSellerOwnedLine(line)) return 'seller_offering'
  if (CUSTOMER_DISCOVERY.test(line)) return 'customer_discovery'
  if (JOB_SEEKING.test(line) || mlMatches(ML_CANDIDATE_SEEKING, line)) return 'job_seeking'
  if (RECRUITER_CTX.test(line)) return 'recruiter'
  const thirdParty = hasThirdPartySubject(line) || isAdviceOrHypothetical(line)
  if (isNegatedRequest(line)) return 'neutral'
  if (!thirdParty && !isNonProviderRequest(line)) {
    if (DEVELOPER_REQUEST.test(line) && !INTERNAL_HIRING_CONTEXT.test(line) && !PROVIDER_NOUN_AS_MODIFIER.test(line)) return 'external_request'
    if (PROJECT_TEAM_REQUEST.test(line) && !INTERNAL_HIRING_CONTEXT.test(line)) return 'external_request'
    if (mlMatches(ML_EXTERNAL_REQUEST, line)) return 'external_request'
  }
  const hiringBlocked = thirdParty || SECOND_PERSON_OR_GENERIC_HIRING.test(line) || HIRING_CLOSED.test(line) || isHistoricalHiring(line)
  if (!hiringBlocked && EMPLOYMENT_HIRING.some((re) => firstAffirmedMatch(line, re))) return 'employment_hiring'
  if (!hiringBlocked && mlMatches(ML_EMPLOYMENT_HIRING, line)) return 'employment_hiring'
  if (EMPLOYMENT_METADATA.test(line) && !HIRING_VERB.test(line)) return 'neutral'
  if (isExternalServiceLine(line)) return 'external_request'
  return 'neutral'
}

const ML_RECRUITER_HEADER = /\b(?:personalberater(?:in)?|recruiter(?:in)?|talent\s+acquisition|chasseur\s+de\s+têtes|recruteur|recruteuse|reclutador[a]?|headhunter|işe\s+alım\s+uzmanı|yetenek\s+kazanımı)\b/i

export function isRecruiterProfile(rawText: string): boolean {
  const header = lines(rawText).slice(0, 8).join('\n')
  return RECRUITER_HEADER.test(header) || ML_RECRUITER_HEADER.test(header)
}

export function detectCommercialRequest(rawText: string): CommercialRequestFacts {
  const all = lines(rawText)
  let external: string | null = null
  let employment: string | null = null

  for (const line of all) {
    const classification = classifyLine(line)
    if (classification === 'recruiter') continue
    if (classification === 'service_offering') continue
    if (classification === 'seller_offering') continue
    if (classification === 'customer_discovery') continue
    if (classification === 'job_seeking') continue
    if (classification === 'external_request' && !external) external = line
    if (classification === 'employment_hiring' && !employment) employment = line
    if (external && employment) break
  }

  return {
    externalServiceRequest: external ? { line: external } : null,
    employmentHiring: employment ? { line: employment } : null,
  }
}

/** Employee recruitment with no request to buy from an external provider. */
export function isEmploymentHiringOnly(rawText: string): boolean {
  const facts = detectCommercialRequest(rawText)
  return facts.employmentHiring !== null && facts.externalServiceRequest === null
}

const MONEY = /(?:[$€£]\s?\d[\d,.]*\s*(?:k|m|million|thousand)?|\b\d[\d,.]*\s*(?:k|m)?\s*(?:usd|eur|gbp|dollars)\b)/i

// Historical budget markers — reject these as current buyer budget
const HISTORICAL_BUDGET_CTX = [
  /\b(?:back\s+in|when\s+I|years?\s+ago|previously|at\s+my\s+(?:previous|former)|in\s+\d{4}|from\s+\d{4})\b/i,
  /\b(?:a\s+reasonable\s+budget|typically\s+budget|for\s+example\s+a\s+budget|as\s+an?\s+example)\b/i,
  /\b(?:needed\s+to\s+build|budget\s+(?:was|had|required\s+for))\b/i,
  /\b(?:if\s+you(?:|'ve)\s+gotten\s+a\s+budget|investing\s+in|spent\s+on)\b/i,
]

export function extractStatedBudget(rawText: string): StatedBudget | null {
  for (const line of lines(rawText)) {
    if (!/\b(?:budget|budgeted|funded|allocated|fixed\s+price|project\s+value)\b/i.test(line)) continue

    // Reject historical/example budgets
    if (HISTORICAL_BUDGET_CTX.some(re => {
      re.lastIndex = 0
      return re.test(line)
    })) continue

    // Reject product metrics (CPI, LTV, etc.)
    if (/\b(?:cpi|ltv|roi|roas|arpu|cac|mrr|arr|revenue|profit|burn\s+rate|runway|churn)\b/i.test(line)) continue

    const money = line.match(MONEY)
    if (!money) continue
    return {
      line,
      amount: money[0].replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim(),
      approved: /\b(?:approved|allocated|confirmed|secured|signed[- ]off)\b/i.test(line),
    }
  }
  return null
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, few: 3, couple: 2 }

function unitDays(unit: string): number {
  const u = unit.toLowerCase()
  if (u.startsWith('day')) return 1
  if (u.startsWith('week')) return 7
  return 30
}

/**
 * Guard: is this line establishing the prospect's OWN project timeline?
 *
 * Returns false for dates/durations that are NOT buyer-owned:
 * - Seller delivery promises ("We can deliver in 4 weeks", "our team ships in 2 sprints")
 * - Third-party deadlines ("our client needs this by June", "the board meets in March")
 * - Hypothetical/conditional timelines ("if you started next month", "suppose we begin in Q2")
 * - Instructional examples ("for example, a 3-week sprint", "typically takes 2 months")
 * - Recruiter timelines ("the role must be filled by September")
 *
 * Returns true when the prospect is describing their own project's timeline:
 * - "We plan to start in February", "our deadline is March 2027"
 * - "We need this by Q1 2027", "implementation should take 12 weeks"
 * - "I want to begin next month", "we're targeting a June launch"
 */
function isBuyerTimelineLine(line: string): boolean {
  if (!line.trim()) return false

  // --- Reject seller delivery promises ---
  if (/\bwe\s+(?:can|could|will|usually|typically|offer)\s+(?:deliver|complete|finish|ship|turn\s+around|have\s+it\s+ready)\b/i.test(line)) return false
  if (/\bour\s+(?:team|company|studio)\s+(?:delivers?|completes?|ships?|finishes?|turns?\s+around)\b/i.test(line)) return false
  if (/\b(?:delivery|turnaround|completion)\s+time\s+(?:is|would\s+be)\b/i.test(line)) return false

  // --- Reject third-party deadlines ---
  if (/\b(?:our|my)\s+(?:client|customer|boss|manager|director|board|stakeholder|partner)\s+(?:needs?|wants?|requires?|said|expects?|mandated)\b/i.test(line)) return false
  if (/\b(?:they|them|their)\s+(?:need|want|require|expect|said|deadline)\b/i.test(line)) return false

  // --- Reject hypothetical/conditional ---
  if (/\b(?:if\s+(?:you|we|they)\s+(?:were|are|can|could|should|want)|suppose|imagine|assuming|say\s+you|in\s+theory|hypothetically)\b/i.test(line)) return false

  // --- Reject instructional/examples ---
  if (/\b(?:for\s+example|typically|normally|usually|in\s+general|as\s+a\s+rule|on\s+average|a\s+typical)\b/i.test(line)) return false

  // --- Reject recruiter timelines ---
  if (/\b(?:role|position|vacancy|hiring|recruitment)\s+(?:must\s+be\s+filled|closes?|deadline|target|timeline)\b/i.test(line)) return false

  return true
}

export function extractStatedTimeline(rawText: string): StatedTimeline | null {
  for (const line of lines(rawText)) {
    // Only attribute timelines that the prospect owns. Skip seller delivery
    // promises, third-party deadlines, hypotheticals, and instructional examples.
    if (!isBuyerTimelineLine(line)) continue
    // "X should take Y weeks/months" — common buyer duration statement.
    const takeDuration = line.match(/\b(?:should|would|will|could)\s+take\s+(?:about\s+|approximately\s+|around\s+|~\s*)?(\d+|a\s+few\s+|a\s+couple\s*(?:of\s+)?|several)\s*(day|week|month)s?\b/i)
    if (takeDuration) {
      const raw = takeDuration[1].toLowerCase().replace(/\s+/g, ' ').trim()
      const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw.replace(/\s+of$/, '').replace(/\s+/g, '')] ?? 3
      return { line, days: n * unitDays(takeDuration[2]), label: `take ${takeDuration[1].trim()} ${takeDuration[2]}` }
    }
    const within = line.match(/\b(?:within|in\s+the\s+next|over\s+the\s+next)\s+(\d+|a|an|one|two|three|four|five|six|few|couple(?:\s+of)?)\s*(days?|weeks?|months?)\b/i)
    if (within) {
      const n = /^\d+$/.test(within[1]) ? Number(within[1]) : WORD_NUMBERS[within[1].toLowerCase().replace(/\s+of$/, '')] ?? 1
      return { line, days: n * unitDays(within[2]), label: within[0].replace(/\s+/g, ' ') }
    }
    const startIn = line.match(/\b(?:start(?:ing)?|kick(?:ing)?[- ]?off|begin(?:ning)?|deliver(?:y)?|launch(?:ing)?|go[- ]live)\b[^.\n]{0,30}?\bin\s+(\d+|a|an|one|two|three|four|five|six|few)\s*(days?|weeks?|months?)\b/i)
    if (startIn) {
      const n = /^\d+$/.test(startIn[1]) ? Number(startIn[1]) : WORD_NUMBERS[startIn[1].toLowerCase()] ?? 1
      return { line, days: n * unitDays(startIn[2]), label: `start in ${startIn[1]} ${startIn[2]}` }
    }
    const immediate = line.match(/\b(?:asap|immediately|immediate\s+start|right\s+away|urgent(?:ly)?)\b/i)
    if (immediate && !isNegatedAt(line, immediate.index ?? 0)) {
      return { line, days: 0, label: immediate[0] }
    }
    const thisWeek = line.match(/\b(?:start(?:ing)?|begin(?:ning)?|kick(?:ing)?[- ]?off)\b[^.\n]{0,20}?\b(this|next)\s+(week|month)\b/i)
    if (thisWeek) {
      const days = thisWeek[2].toLowerCase() === 'week' ? (thisWeek[1].toLowerCase() === 'this' ? 3 : 10) : (thisWeek[1].toLowerCase() === 'this' ? 15 : 45)
      return { line, days, label: thisWeek[0] }
    }
  }
  return null
}

const CONTACT_INSTRUCTION =
  /\b(?:contact\s+us|reach\s+out|get\s+in\s+touch|dm\s+(?:me|us)|message\s+(?:me|us)|email\s+(?:me|us)|send\s+(?:us|me|your|their)|submit\s+(?:your|their|a)|apply\s+(?:now|here|via|through)|should\s+(?:contact|reach|send|submit|apply))\b/i

export function findContactInstruction(rawText: string): SourceLine | null {
  const line = lines(rawText).find((l) => CONTACT_INSTRUCTION.test(l))
  return line ? { line } : null
}

/**
 * Extract a concise project need description from the source.
 *
 * Finds the first line that describes what the prospect wants built —
 * patterns like "looking for X to build Y", "need a Z", "evaluating partners
 * for W". Returns a trimmed, single-sentence summary or null when no
 * project description is found.
 *
 * Generalized: works for any project type, not hardcoded to fixtures.
 */
export function extractProjectNeed(rawText: string): string | null {
  if (!rawText) return null
  const all = lines(rawText)

  // Pattern 1: "looking for/seeking/need a [provider] to [build/create/develop] [project]"
  const buildMatch = all.find((l) => /\b(?:looking\s+for|seeking|need|want|require)\s+(?:a\s+|an\s+)?(?:\w+\s+){0,4}(?:to|for)\s+(?:build|create|develop|design|implement|deliver)\s+/i.test(l))
  if (buildMatch) {
    const sentence = buildMatch.split(/[.!?]/)[0].trim()
    return sentence.length <= 200 ? sentence : sentence.slice(0, 197) + '…'
  }

  // Pattern 2: "evaluating/reviewing [partners/agencies] for [project]"
  const evalMatch = all.find((l) => /\b(?:evaluating|assessing|considering|reviewing|sourcing|searching\s+for)\s+(?:a\s+|an\s+)?(?:\w+\s+){0,6}(?:for|to)\s+/i.test(l))
  if (evalMatch) {
    const sentence = evalMatch.split(/[.!?]/)[0].trim()
    return sentence.length <= 200 ? sentence : sentence.slice(0, 197) + '…'
  }

  // Pattern 3: "need/require a [project description]"
  const needMatch = all.find((l) => /\b(?:we\s+)?(?:need|require|want)\s+(?:a\s+|an\s+)?(?:new\s+|custom\s+|centralized\s+)?\w+(?:\s+\w+){2,8}\b/i.test(l) && !/\b(?:job|role|position|developer|engineer)\b/i.test(l))
  if (needMatch) {
    const sentence = needMatch.split(/[.!?]/)[0].trim()
    return sentence.length <= 200 ? sentence : sentence.slice(0, 197) + '…'
  }

  return null
}

/** A source line containing any of the given terms (case-insensitive, whole word). */
export function findLineMentioning(rawText: string, terms: string[]): SourceLine | null {
  const usable = terms.map((t) => t.trim()).filter((t) => t.length >= 2)
  if (usable.length === 0) return null
  const escaped = usable.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(?<![a-z0-9])(?:${escaped.join('|')})(?![a-z0-9])`, 'i')
  const line = lines(rawText).find((l) => re.test(l))
  return line ? { line } : null
}

// ── Terminal opportunity state ──────────────────────────────────────────────

export type TerminalStateKind = 'DO_NOT_CONTACT' | 'CLOSED' | 'COMPLETED' | 'PARTNER_SELECTED'

/** The prospect asked not to be contacted, or the search/project is over. */
const DO_NOT_CONTACT =
  /\b(?:do\s+not\s+contact|don'?t\s+contact|please\s+stop\s+(?:contacting|reaching\s+out)|stop\s+contacting|no\s+(?:unsolicited\s+)?(?:offers?|agency\s+offers?|solicitations?)|unsubscribe|opt[- ]?out|not\s+interested\s+in\s+(?:any\s+)?(?:agency\s+)?offers?|please\s+remove\s+us|do\s+not\s+reach\s+out|no\s+longer\s+accepting\s+(?:agency\s+)?offers?)\b/i

/** The need was filled or the search closed — a terminal state, not a lead. */
const TERMINAL_CLOSURE =
  /\b(?:partner\s+(?:has\s+been\s+)?(?:selected|chosen|awarded)|(?:we|i|they)\s+(?:have\s+)?(?:selected|chosen|awarded|decided\s+on|went\s+with|hired|engaged)\s+(?:a\s+|an\s+)?(?:partner|agency|vendor|team|provider|supplier|consultant|firm)|project\s+(?:is\s+)?(?:complete(?:d)?|finished|done|closed|wrapped\s+up)|(?:position|role|project|search|engagement|requirement|need)\s+(?:has\s+been\s+)?(?:filled|closed|completed|on\s+hold)|no\s+longer\s+(?:looking|seeking|hiring|need|require)|(?:we|i)\s+(?:are|am)\s+not\s+(?:looking|seeking|hiring|accepting)|closed\s+(?:the\s+)?(?:project|search|engagement|requirement)|(?:search|project|engagement)\s+(?:is\s+)?closed|thank\s+you\s+but\s+we(?:'|’)?ve\s+(?:decided|moved\s+on))\b/i

export interface TerminalState {
  kind: TerminalStateKind
  line: string
  index: number
}

/**
 * The latest explicit terminal state in the source. When present, historical
 * buying intent is overridden: QA BUG-PRO-022 requires the newest state to win.
 */
export function detectTerminalState(rawText: string): TerminalState | null {
  const all = lines(rawText)
  let best: TerminalState | null = null
  all.forEach((line, index) => {
    let kind: TerminalStateKind | null = null
    if (DO_NOT_CONTACT.test(line)) kind = 'DO_NOT_CONTACT'
    else if (TERMINAL_CLOSURE.test(line)) {
      kind = /partner|agency|vendor|team|provider|supplier|consultant|firm/i.test(line) ? 'PARTNER_SELECTED' : 'COMPLETED'
    }
    if (kind && (!best || index >= best.index)) best = { kind, line, index }
  })
  return best
}

// ── Explicit dates ──────────────────────────────────────────────────────────

export interface ExplicitDateEvidence {
  /** When the prospect posted / was active, from an absolute date. */
  activityDate: string | null
  /** When they want to start, from an explicit start/kickoff date. */
  buyerStartDate: string | null
  /** A stated deadline. */
  deadline: string | null
  /** Stated duration in days, when the source gives one. */
  durationDays: number | null
  /** Every explicit date line found, for the trace. */
  lines: string[]
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const ABSOLUTE_DATE = new RegExp(`\\b${MONTH}\\s+(?:(?:19|20)\\d{2}|\\d{1,2}(?:st|nd|rd|th)?)\\b`, 'i')
const START_CTX = /\b(?:start|kick[- ]?off|begin|launch|go[- ]?live|onboard|engagement\s+starts?|project\s+starts?)\b/i
const DEADLINE_CTX = /\b(?:deadline|by\s+(?:the\s+)?(?:end\s+of\s+)?|before\s+(?:the\s+)?(?:end\s+of\s+)?|due\s+(?:by|date)|no\s+later\s+than|target\s+date)\b/i

/**
 * Read absolute dates ("November 2026", "Oct 1", "Nov 2026") that the
 * relative-age reader misses. Separates activity date from buyer start date
 * and duration so a recent post is never confused with buyer timing
 * (QA BUG-PRO-023).
 */
export function extractExplicitDates(rawText: string): ExplicitDateEvidence {
  const all = lines(rawText)
  let activityDate: string | null = null
  let buyerStartDate: string | null = null
  let deadline: string | null = null
  let durationDays: number | null = null
  const found: string[] = []

  all.forEach((line) => {
    // Only attribute dates/durations that the prospect owns.
    if (!isBuyerTimelineLine(line)) return

    const date = line.match(ABSOLUTE_DATE)?.[0]?.replace(/\s+/g, ' ').trim() ?? null
    if (date) {
      found.push(line)
      if (START_CTX.test(line)) {
        buyerStartDate = date
      } else if (DEADLINE_CTX.test(line)) {
        deadline = date
      } else {
        activityDate = date
      }
    }
    const dur = line.match(/\b(?:about\s+|around\s+|~\s*)?(\d+)\s*(day|week|month)s?\b/i)
    if (dur && durationDays === null) {
      const n = Number(dur[1])
      const u = dur[2].toLowerCase()
      durationDays = u.startsWith('day') ? n : u.startsWith('week') ? n * 7 : n * 30
    }
  })

  return { activityDate, buyerStartDate, deadline, durationDays, lines: found }
}

/**
 * Whether `quote` appears verbatim in the source (whitespace- and
 * quote-style-insensitive). Used to keep paraphrases out of "source quote" slots.
 */
export function isVerbatimInSource(quote: string | null | undefined, rawText: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
  const q = norm(quote ?? '')
  if (q.length < 12) return false
  return norm(rawText).includes(q)
}
