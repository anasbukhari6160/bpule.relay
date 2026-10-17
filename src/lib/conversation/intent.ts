/**
 * Canonical client-intent classes and the deterministic safeguards behind
 * them. Every surface that reads a client's message (reply analysis, memory,
 * deal stage, next action, follow-up gate, inbox) goes through here, so a
 * rejection means the same thing everywhere.
 *
 * Model analysis stays the semantic layer for nuance; these phrase rules only
 * decide the cases where being wrong is expensive (pushing a follow-up at
 * someone who said no). Negations are checked before positives, so
 * "not interested" can never read as "interested".
 */

export type IntentClass = 'POSITIVE' | 'QUESTION' | 'NEUTRAL' | 'DEFERRED' | 'NEGATIVE' | 'CLOSED'

export type AnalysisIntent =
  | 'interested' | 'question' | 'objection' | 'not_now' | 'not_interested'
  | 'referral' | 'meeting_request' | 'pricing' | 'neutral' | 'auto_reply'

export interface MessageIntent {
  class: IntentClass
  /** True when an explicit phrase decided it (overrides model analysis). */
  explicit: boolean
  intent: AnalysisIntent
  reason: string
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

const AUTO_REPLY = /\b(out of (?:the )?office|ooo\b|auto(?:matic)?[- ]?(?:reply|response)|i am currently away|i'?m currently away|on (?:annual )?leave|on vacation|limited (?:email )?access)/

const STOP = /\b(stop (?:messaging|contacting|emailing|sending|reaching out)|please stop|remove me|take me off|unsubscribe|don'?t (?:contact|message|email|dm) me|do not (?:contact|message|email|dm)|leave me alone|this is spam)\b/

// "not interested" with at most one softening adverb — "not sure if
// interested" is uncertainty, not a rejection, and "never been more
// interested" is the opposite of one.
const NEGATED_INTEREST = /\b(?:not|no longer|isn'?t|aren'?t|am not|i'?m not|we'?re not|we are not)\s+(?:really\s+|that\s+|very\s+|too\s+|currently\s+|actually\s+|at all\s+)?interested\b|\b(?:uninterested|disinterested|no interest)\b/g

const REFUSAL = /\b(no,? thanks?|no thank you|not for (?:me|us)|we'?ll pass|i'?ll pass|pass on (?:this|that)|not a (?:good )?fit|not looking|not in the market|don'?t need|do not need|no need\b(?!\s+to\b)|(?:we'?re|we are|i'?m|all) (?:all )?set\b(?!\s+(?:for|on|with|to|up)\b)|we have (?:a|our own) (?:team|vendor|agency)|already (?:have|working with) (?:a|an|our)|not (?:something|what) we need)/

const WRONG_PERSON = /\b(wrong person|not the right person|not my (?:area|department|call)|not responsible for|i don'?t handle|not involved in|not my decision)\b/
const REFERRAL_CUE = /\b(talk to|reach out to|contact|speak (?:to|with)|ask|try|loop in|cc'?d?)\s+(?:my |our |the )?(?:[A-Z]?\w+)/

// Long horizons only: "a call next week" is interest, "next quarter" is a deferral.
const DEFERRED = /\b(not (?:right )?now|not at the moment|not at this time|maybe later|later this (?:year|quarter)|next (?:quarter|year)|in a (?:few|couple of) months|circle back|check back|reach out (?:again )?(?:later|next|in)|follow up (?:later|next|in)|bad timing|not the right time|too busy|no budget (?:right now|this year|at the moment)|after (?:q[1-4]|the holidays|the new year))\b/

const GOODBYE = /^(?:(?:ok(?:ay)?|k|sure|alright|fine|thanks?|thank you|cheers|noted)[\s,.!]*)*(?:bye|goodbye|good bye|bye bye|take care|cya|see ya|see you|have a (?:good|nice|great) (?:day|one|weekend))\b/

const PRICING = /\b(how much|pricing|price|cost|what(?:'s| is| are) your (?:rate|rates|fee|fees|price)|your rates?|hourly rate|quote)\b/
const MEETING = /\b(book|schedule|(?:a |quick )?call|call me|meeting|zoom|meet up|let'?s meet|meet (?:next|this|on|tomorrow|for)|calendly|let'?s talk|talk (?:this|next|on|tomorrow)|chat (?:this|next|on|tomorrow)|available (?:on|this|next|tomorrow))\b/
const POSITIVE = /\b(interested|sounds (?:good|great|interesting)|let'?s (?:do it|go|proceed|move forward|connect)|keen|happy to|would love to|yes,? please|go ahead|move forward|works for me|tell me more|more info|open to|send (?:me |over |us )?(?:the |your )?(?:details|more|info|information|proposal|jd|job description|portfolio|deck|rates?|case stud(?:y|ies)|examples?)|share (?:your |the )?(?:portfolio|details|rates?|case stud(?:y|ies)|examples?|jd))\b/
// Ready to buy — these outrank any "don't need"/"not interested in…" wording
// around them: "We don't need more slides, when can you start?" is a yes.
const COMMIT = /\b(?:send (?:me |us |over |across )*(?:a |an |the |your )?(?:proposal|contract|agreement|sow|statement of work|invoice|estimate|nda)|(?:ready|want|like|happy) to (?:sign|start|begin|proceed|kick ?off|move ahead)|where do (?:i|we) sign|sign (?:the|a|an) (?:contract|agreement|sow|nda|proposal)|(?:when|how soon) (?:can|could|would) (?:you|we) (?:start|begin|kick ?off)|(?:can|could) (?:we|you) (?:start|begin|kick ?off)|kick ?off (?:next|this|on|tomorrow)|start (?:next|this) (?:week|month|monday)|you(?:'re| are) hired|next steps?)\b/
// A question about doing the work ("when can you…", "can we…") reopens even
// inside the rejecting sentence; "why do you ask?" does not.
const BUYING_QUESTION = /\b(?:when|how soon|can (?:we|you)|could (?:we|you)|would you be able to)\b[^?]*\?/

const CONTRAST = /\b(?:but|however|though|although|that said|instead)\b/

// Politeness that softens a "no" without changing it: "Not interested, but
// thanks for asking" is still a rejection. A for-clause never crosses
// punctuation, so "thanks for the details, send pricing" keeps its request.
const COURTESY = /\b(?:(?:many |a lot of )?thanks?(?: you)?(?: (?:so much|a lot|anyway|again|though|very much))?(?: for [^,.!?;]{0,40})?|(?:i |we |really )*appreciate(?:d)? (?:it|that|you|the [^,.!?;]{0,30}|your [^,.!?;]{0,30})|(?:good|best of) luck(?: with [^,.!?;]{0,40})?|all the best|best wishes|(?:i |we )?wish you (?:luck|well|the best|all the best|success)(?: [^,.!?;]{0,30})?|have a (?:good|nice|great|lovely) (?:day|week|weekend|one)|cheers|take care|no worries|no hard feelings|(?:i'?m |we'?re )?sorry|kind regards|regards|(?:happy to )?(?:keep|stay) in touch|keep (?:it )?up the good work|nice (?:offer|of you|try)|hope you understand)\b/g

// Questions that are not buying questions — they never reopen a rejection.
const NON_BUYING_QUESTION = /\b(?:why (?:do|did|would) you (?:ask|want to know|reach out|message me|contact me)|how did you (?:get|find) (?:my|this|our) [^?]{0,30}|how did you (?:get|find) (?:me|us)\b[^?]{0,20}|who (?:are you|gave you [^?]{0,30}|is this)|where did you get [^?]{0,40})\?/g

/** Interest/question/meeting cues, ignoring negated interest ("not interested"). */
function engagementIn(text: string, opts: { bareQuestion?: boolean } = {}): MessageIntent | null {
  const t = text.replace(NEGATED_INTEREST, ' ').replace(NON_BUYING_QUESTION, ' ')
  if (PRICING.test(t)) return { class: 'QUESTION', explicit: false, intent: 'pricing', reason: 'asked about price' }
  if (MEETING.test(t)) return { class: 'POSITIVE', explicit: false, intent: 'meeting_request', reason: 'asked to talk' }
  if (COMMIT.test(t)) return { class: 'POSITIVE', explicit: false, intent: 'interested', reason: 'ready to move ahead' }
  if (POSITIVE.test(t)) return { class: 'POSITIVE', explicit: false, intent: 'interested', reason: 'expressed interest' }
  if (BUYING_QUESTION.test(t)) return { class: 'QUESTION', explicit: false, intent: 'question', reason: 'asked about the work' }
  if (opts.bareQuestion !== false && /\?/.test(t)) return { class: 'QUESTION', explicit: false, intent: 'question', reason: 'asked a question' }
  return null
}

// After a "no", "keep me posted" is a deferral; on its own it is just interest.
const KEEP_POSTED = /\bkeep me (?:posted|updated|in the loop|in mind)\b/

function isNegative(text: string): boolean {
  NEGATED_INTEREST.lastIndex = 0
  const negated = NEGATED_INTEREST.test(text)
  NEGATED_INTEREST.lastIndex = 0
  return negated || REFUSAL.test(text)
}

/**
 * Classify one client message. Hard stops and clear rejections first. A
 * rejection phrase is only decisive when the same message carries no other
 * engagement: "not interested in full-time, but open to contract work" or
 * "I don't need a deck, just send your rates" are not rejections, and are
 * left non-explicit so the model's reading is not overridden.
 */
export function classifyClientMessage(raw: string): MessageIntent {
  const text = normalize(raw)
  if (!text) return { class: 'NEUTRAL', explicit: false, intent: 'neutral', reason: 'empty' }
  if (AUTO_REPLY.test(text)) return { class: 'NEUTRAL', explicit: true, intent: 'auto_reply', reason: 'auto-reply' }
  if (STOP.test(text)) return { class: 'NEGATIVE', explicit: true, intent: 'not_interested', reason: 'asked to stop contact' }
  if (isNegative(text)) {
    const [, ...rest] = text.split(CONTRAST)
    const tail = rest.join(' ').trim()
    // A rejection stays a rejection unless the "but" clause carries a buying
    // cue or a deferral. Courtesy, sign-offs and names change nothing, so new
    // ways of saying "thanks anyway" never reopen the thread.
    if (tail && !isNegative(tail)) {
      if (DEFERRED.test(tail) || KEEP_POSTED.test(tail)) {
        return { class: 'DEFERRED', explicit: true, intent: 'not_now', reason: 'declined for now, asked to talk later' }
      }
      const engaged = engagementIn(tail.replace(COURTESY, ' '))
      if (engaged) return engaged
    }
    // In the rejecting sentence itself, only a buying cue (price, call,
    // interest) reopens; a bare or non-buying question ("Why do you ask?") does not.
    const engaged = engagementIn(text.replace(COURTESY, ' '), { bareQuestion: false })
    if (engaged) return engaged
    return { class: 'NEGATIVE', explicit: true, intent: 'not_interested', reason: 'explicit rejection' }
  }
  if (WRONG_PERSON.test(text)) {
    return REFERRAL_CUE.test(raw)
      ? { class: 'NEUTRAL', explicit: true, intent: 'referral', reason: 'wrong person, referred elsewhere' }
      : { class: 'NEGATIVE', explicit: true, intent: 'not_interested', reason: 'wrong person' }
  }
  if (DEFERRED.test(text)) return { class: 'DEFERRED', explicit: true, intent: 'not_now', reason: 'asked to talk later' }
  if (GOODBYE.test(text) && text.split(' ').length <= 8) {
    return { class: 'CLOSED', explicit: true, intent: 'neutral', reason: 'ended the conversation' }
  }
  const engaged = engagementIn(text)
  if (engaged) return { ...engaged, explicit: engaged.class !== 'QUESTION' || engaged.intent === 'pricing' }
  return { class: 'NEUTRAL', explicit: false, intent: 'neutral', reason: 'no clear intent' }
}

export interface ConversationIntent {
  class: IntentClass
  declined: boolean
  deferred: boolean
  /** The client message that decided the outcome. */
  decidingText: string | null
  reason: string
}

/**
 * Where the conversation stands, from the client's messages oldest first.
 * The latest explicit meaning wins: a "not interested" overrides an earlier
 * "send details"; a polite "ok bye" or "thanks" after a rejection keeps it a
 * rejection; a real question or interest afterwards reopens it.
 */
export function resolveConversationIntent(clientMessages: string[]): ConversationIntent {
  let state: ConversationIntent = { class: 'NEUTRAL', declined: false, deferred: false, decidingText: null, reason: 'no client messages' }
  for (const text of clientMessages) {
    const m = classifyClientMessage(text)
    if (m.intent === 'auto_reply') continue
    const closedState = state.class === 'NEGATIVE' || state.class === 'DEFERRED'
    if (m.class === 'NEGATIVE' || m.class === 'DEFERRED') {
      state = { class: m.class, declined: m.class === 'NEGATIVE', deferred: m.class === 'DEFERRED', decidingText: text, reason: m.reason }
    } else if (m.class === 'CLOSED' || m.class === 'NEUTRAL') {
      // A goodbye or "ok" after a rejection/deferral keeps that outcome.
      if (!closedState) state = { class: m.class, declined: false, deferred: false, decidingText: text, reason: m.reason }
    } else {
      // POSITIVE / QUESTION reopens the conversation.
      state = { class: m.class, declined: false, deferred: false, decidingText: text, reason: m.reason }
    }
  }
  return state
}
