/**
 * Shared prompt fragments — single source of truth for rules duplicated across
 * draft, forge, content, and message-forge.
 *
 * If a rule is enforced deterministically in code, do NOT repeat it here.
 * Keep prompts short; code is the real gate.
 */

export const ANTI_AI_RULES = `Anti-AI rules: Do not use phrases like "I came across your", "I was immediately excited", "With X+ years of experience", "I am confident", "I'd love the opportunity", "hope this finds you well", "I hope this message finds you", "I wanted to reach out", "I noticed your company", "You recently raised", "which likely gives you some budget", "noticed you're hiring", "noticed the hiring", "noticed [signal] at [company]", "noticed that you", "saw your post", "this caught my eye", "congrats on", "we specialize in", "over the past N years", "I can write a quick analysis", "would that be useful". These are generic AI tells, fake compliments, or research-dumping.`

export const FACTUALITY_RULES = `Claim ONLY facts listed in the facts table. A number that is not in the facts table must not appear in the draft. Never fabricate a project, client, result, or credential. Never invent metrics, budgets, pain points, technologies, customers, revenue problems, or relationships.`

export const SURVEILLANCE_RULES = `Opening rule: A greeting is usually appropriate (Hey Sarah, / Hi Robby,). Never open with scraped intelligence like "You recently raised..." or "You are currently building...". The first line should create context, not expose surveillance.`

export const CTA_RULES = `CTA rule: One question or CTA maximum. Never ask for a call, meeting, or intro on first touch. Do not offer a free read, analysis, audit, or "quick write-up" unless they asked. Connection notes have no pitch and no CTA beyond existing. A first DM ends on one specific question. A follow-up adds one new reason or closes — never "just following up".`

export const SPECIFICITY_RULES = `Specificity rule: use at most one current fact from ALLOWED_NOW. If swapping the name and company would still make the message usable, it is too generic. If the personalization only proves you researched them, remove it. Historical company or role facts are not current opportunity.`

export const VOICE_RULES = `Voice rule: the sender is ONE person. Write in first person singular. Never use 'we', 'our', or 'us' for the sender. Never mention a team, a headcount, or anyone else doing the work. Never echo a prospect quote in first person — if they said "we are hiring", do not write "we are hiring".`

export const FORMATTING_RULES = `FORMATTING RULES:
- Never use em dashes (— or –) anywhere. Use commas, periods, or plain sentences.
- Never write "Hi Name —" or "Name —" — use a comma: "Hi Name,".
- Never use emojis or exclamation marks.
- Write the shortest message that does the one job.
- Budgets: connection notes are at most 120 characters (about 14-20 words). First DM 20-55 words, follow-up 15-45, interested reply 30-70. These are ceilings, not targets.
- One observation. One question.`

export const BANNED_PHRASES_COMPACT = `"unpopular opinion:", "here's the thing", "let that sink in", "thread 🧵", "stop scrolling", "read that again", "let me tell you", "the truth is", "nobody talks about this"`

export const CONTENT_DNA_RULES = `HARD RULES:
1. NEVER use banned phrases.
2. NEVER start with a rhetorical question as the hook.
3. NEVER invent details. Everything must trace back to the source material.
4. NEVER use clickbait.
5. NEVER use corporate jargon.
6. The first 1-2 lines must contain a concrete, specific detail.`
