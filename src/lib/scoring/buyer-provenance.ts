import { detectCommercialRequest } from '@/lib/intelligence-v3/source-facts'

export interface SignalProvenance {
  subjectPerson: 'prospect' | 'third_party' | 'unknown'
  subjectOrganization: 'prospect_org' | 'third_party_org' | 'unknown'
  needOwner: 'buyer' | 'seller' | 'advisor' | 'recruiter' | 'unknown'
  sourceActor: 'prospect' | 'third_party' | 'unknown'
  eventType: 'request' | 'offering' | 'hiring' | 'commentary' | 'repost' | 'unknown'
  eventStatus: 'current' | 'historical' | 'hypothetical' | 'unknown'
  timeReference: 'event_bound' | 'prose' | 'unknown'
  verifiedClaim: boolean
  verificationNote: string
}

export interface VerifiedBuyerSignal {
  signalType: 'explicitAsk' | 'hiring' | 'seekingVendor' | 'budget' | 'launching' | 'askingForHelp'
  rawDetected: boolean
  provenance: SignalProvenance
  buyerIntentValid: boolean
}

const SELLER_MARKERS = [
  /\b(?:we\s+(?:offer|provide|specialize\s+in|help\s+(?:companies|clients|businesses)|build\s+for|work\s+with))\b/i,
  /\b(?:our\s+(?:services?|solutions?|agency|practice|team\s+helps))\b/i,
  /\b(?:client\s+(?:work|projects?|engagements?))\b/i,
  /\b(?:we(?:'|’)?re\s+(?:an?\s+)?(?:agency|consultancy|dev\s+shop|studio|freelancer))\b/i,
  /\b(?:hire\s+(?:us|me|our\s+team))\b/i,
  /\b(?:let\s+(?:us|me)\s+(?:help|build|create|design))\b/i,
]

const ADVISOR_MARKERS = [
  /\b(?:I\s+(?:advise|coach|consult\s+for|help\s+(?:founders|companies)|mentor))\b/i,
  /\b(?:my\s+(?:clients?|students?|audience|followers?)\s+(?:are|include|come\s+from))\b/i,
  /\b(?:here(?:'|’)?s\s+(?:how|what|my\s+tip|my\s+advice|the\s+key))\b/i,
  /\b(?:pro\s+tip|lesson\s+learned|what\s+I\s+learned|my\s+experience\s+building)\b/i,
]

const RECRUITER_MARKERS = [
  /\b(?:I(?:'|’)?m\s+(?:a|an)\s+(?:recruiter|talent\s+(?:acquisition|partner)|sourcer|headhunter))\b/i,
  /\b(?:recruiting\s+(?:for|at)|hiring\s+(?:for|at)\s+(?:my\s+client|a\s+client))\b/i,
  /\b(?:role\s+(?:at|with)\s+(?:my\s+client|a\s+client|one\s+of\s+my))\b/i,
]

const HISTORICAL_MARKERS = [
  /\b(?:when\s+I\s+(?:was|worked|built|started|launched))\b/i,
  /\b(?:previously\s+at|back\s+when|at\s+my\s+(?:last|previous)\s+(?:role|company|job|startup))\b/i,
  /\b(?:I\s+(?:remember|learned|discovered)\s+(?:then|when\s+I))\b/i,
  /\b(?:in\s+my\s+(?:experience|practice|work\s+with\s+clients))\b/i,
  /\b(?:years?\s+ago|a\s+few\s+(?:years?|months?)\s+ago)\b/i,
  /\b(?:last\s+(?:year|quarter)\s+we\s+(?:tried|attempted|built|started))\b/i,
]

const HYPOTHETICAL_MARKERS = [
  /\b(?:thinking\s+about|considering|planning\s+to|might\s+(?:be|want)|could\s+(?:be|work)|would\s+love\s+to|hope\s+to|someday)\b/i,
  /\b(?:if\s+I\s+(?:could|had|were\s+to)|one\s+day|eventually)\b/i,
]

const REPOST_MARKERS = [
  /\b(?:repost(?:ed)?|via\s+@\w+|shared\s+from|originally\s+posted\s+by|courtesy\s+of)\b/i,
  /\b(?:great\s+(?:post|thread|insight|advice)\s+from)\b/i,
  /\b(?:@\w+\s+(?:on\s+(?:launch|funding|raising|building|hiring|looking\s+for)))/i,
]

const PROSE_TIME_MARKERS = [
  /\b(?:realized\s+immediately|immediately\s+(?:understood|saw|knew|felt|recognized))\b/i,
  /\b(?:move\s+fast|fast\s+pace|quickly\s+(?:realized|learned|adapted))\b/i,
  /\b(?:limited\s+budget\s+(?:in\s+my\s+(?:last|previous|early)|when\s+I\s+was))\b/i,
  /\b(?:launch(?:ed|ing)?\s+(?:a\s+workshop|a\s+course|a\s+newsletter|a\s+podcast|a\s+book|my\s+(?:book|course|newsletter)))\b/i,
  /\b(?:launch\s+was\s+(?:a\s+)?(?:success|great|the\s+best\s+decision))\b/i,
]

function isSeller(text: string): boolean {
  const header = text.split('\n').slice(0, 6).join('\n')
  if (SELLER_MARKERS.some((re) => re.test(header))) {
    const commercial = detectCommercialRequest(text)
    if (!commercial.externalServiceRequest) return true
  }
  return false
}

function isAdvisor(text: string): boolean {
  return ADVISOR_MARKERS.some((re) => re.test(text))
}

function isRecruiter(text: string): boolean {
  const header = text.split('\n').slice(0, 8).join('\n')
  return RECRUITER_MARKERS.some((re) => re.test(header))
}

function isHistorical(text: string): boolean {
  return HISTORICAL_MARKERS.some((re) => re.test(text))
}

function isHypothetical(text: string): boolean {
  const buyerSection = text.split('\n').slice(0, 10).join('\n')
  return HYPOTHETICAL_MARKERS.some((re) => re.test(buyerSection))
}

function isRepost(text: string): boolean {
  return REPOST_MARKERS.some((re) => re.test(text))
}

function isProseTiming(text: string): boolean {
  return PROSE_TIME_MARKERS.some((re) => re.test(text))
}

function computeProvenance(text: string): Omit<SignalProvenance, 'verifiedClaim' | 'verificationNote'> {
  const commercial = detectCommercialRequest(text)
  const hasExternalRequest = commercial.externalServiceRequest !== null

  let needOwner: SignalProvenance['needOwner'] = 'unknown'
  if (isRecruiter(text)) needOwner = 'recruiter'
  else if (isAdvisor(text)) needOwner = 'advisor'
  else if (isSeller(text)) needOwner = 'seller'
  else if (hasExternalRequest) needOwner = 'buyer'

  let eventType: SignalProvenance['eventType'] = 'unknown'
  if (needOwner === 'seller') eventType = 'offering'
  else if (isRepost(text)) eventType = 'repost'
  else if (hasExternalRequest) eventType = 'request'
  else if (commercial.employmentHiring) eventType = 'hiring'
  else if (needOwner === 'advisor') eventType = 'commentary'

  let eventStatus: SignalProvenance['eventStatus'] = 'unknown'
  if (isHistorical(text)) eventStatus = 'historical'
  else if (isHypothetical(text)) eventStatus = 'hypothetical'
  else if (hasExternalRequest || commercial.employmentHiring) eventStatus = 'current'

  const timeReference = isProseTiming(text) ? 'prose' : (eventType === 'request' ? 'event_bound' : 'unknown')

  return {
    subjectPerson: 'prospect',
    subjectOrganization: 'prospect_org',
    needOwner,
    sourceActor: 'prospect',
    eventType,
    eventStatus,
    timeReference,
  }
}

export function verifyBuyerSignal(params: {
  signalType: VerifiedBuyerSignal['signalType']
  text: string
  rawDetected: boolean
}): VerifiedBuyerSignal {
  const { signalType, text, rawDetected } = params
  const base = computeProvenance(text)

  if (!rawDetected) {
    return {
      signalType,
      rawDetected,
      provenance: { ...base, verifiedClaim: false, verificationNote: 'Signal not detected' },
      buyerIntentValid: false,
    }
  }

  const reasons: string[] = []
  let verified: boolean = rawDetected
  const commercial = detectCommercialRequest(text)
  const hasExternalRequest = commercial.externalServiceRequest !== null

  if (base.needOwner === 'seller') { verified = false; reasons.push('prospect is the seller') }
  if (base.needOwner === 'advisor') { verified = false; reasons.push('prospect is advising') }
  if (base.needOwner === 'recruiter') { verified = false; reasons.push('prospect recruits for others') }

  if (base.eventType === 'offering') { verified = false; reasons.push('service offering, not request') }
  if (base.eventType === 'commentary') { verified = false; reasons.push('industry commentary, not event') }
  if (base.eventType === 'repost') { verified = false; reasons.push('third-party repost') }
  if (base.eventType === 'hiring' && signalType !== 'hiring') { verified = false; reasons.push('employment hiring misclassified') }

  if (base.eventStatus === 'historical') { verified = false; reasons.push('historical, not current') }
  if (base.eventStatus === 'hypothetical') { verified = false; reasons.push('hypothetical, not committed') }

  if (base.timeReference === 'prose') { verified = false; reasons.push('timing is prose') }

  if (signalType === 'seekingVendor' && !hasExternalRequest) {
    verified = false; reasons.push('no external-service request in source')
  }
  if (signalType === 'askingForHelp' && !hasExternalRequest) {
    verified = false; reasons.push('help request lacks external provider')
  }

  const note = verified
    ? 'All checks passed'
    : `Not verified: ${reasons.join('; ')}`

  return {
    signalType,
    rawDetected,
    provenance: { ...base, verifiedClaim: verified, verificationNote: note },
    buyerIntentValid: verified,
  }
}
