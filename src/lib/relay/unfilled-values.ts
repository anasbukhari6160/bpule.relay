/**
 * True when a draft still carries an unfilled slot: a template token
 * ("{{name}}", "[company]"), a number that never arrived ("a -month trial",
 * "with / support", "for $"), or a dangling connective before punctuation.
 *
 * Pure and dependency-free so the same check runs in the browser (disable
 * Copy / Log as sent) and on the server (refuse to log the text).
 */
export function hasUnfilledValues(text: string): boolean {
  if (/\{\{[^}]*\}\}|\{[a-z_]+\}|\[(?:name|company|first ?name|title|role|product|x|placeholder|insert[^\]]*)\]/i.test(text)) return true
  // A unit with no number in front: " -month", " -day", " -week", " -year".
  if (/(?:^|[\s(])-\s?(?:month|day|week|year|hour|minute|person|user|seat)s?\b/i.test(text)) return true
  // A separator with nothing on at least one side: "with / support", "24/ support", " / ".
  if (/(?:^|\s)\/\s|\s\/(?:\s|$)/.test(text)) return true
  // A currency sign with no amount: "for $." or "$ per month".
  if (/[$€£]\s*(?:[.,;!?]|$|\s(?:per|a|an|each)\b)/m.test(text)) return true
  // A connective immediately followed by punctuation or end: "offering a.", "with,".
  if (/\b(?:with|for|of|a|an|the)\s*[.,;!?](?:\s|$)/i.test(text)) return true
  return false
}

export const UNFILLED_VALUES_MESSAGE = 'This draft still has an empty value or placeholder. Fill it in before copying or logging.'
