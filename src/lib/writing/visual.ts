/**
 * Visual Concept Generator — creates image prompts for social posts.
 *
 * Every generated social post gets an optional visual concept: a concise
 * prompt the user can copy into any image-generation model. The concept
 * is generated AFTER the final post is selected so it reflects the actual angle.
 */

export interface VisualConcept {
  visualIdea: string
  imagePrompt: string
}

export interface VisualConceptInput {
  postText: string
  platform: 'linkedin' | 'x'
  angle: string
  topic: string
  styleCard?: string | null
  /** The specific insight or detail the post centers on */
  coreDetail: string
  /** The emotional tone of the post */
  tone: string
  /** Whether to prefer illustration, photography, or abstract */
  visualStyle?: 'editorial-illustration' | 'technical-diagram' | 'visual-metaphor' | 'object-composition' | 'minimal-data' | 'photographic' | 'typographic' | 'abstract-concept'
}

const OVERUSED_VISUALS = [
  /generic\s+laptop/i,
  /robot\b/i,
  /ai\s+brain/i,
  /floating\s+code/i,
  /floating\s+cards?/i,
  /glowing\s+nodes?/i,
  /abstract\s+networks?/i,
  /split[\s-]?screen/i,
  /before\s*(and|&|\/)\s*after/i,
  /generic\s+arrows?/i,
  /futuristic\s+dashboard/i,
  /glowing\s+dashboard/i,
  /stock\s+photo/i,
  /developer\s+at\s+desk/i,
  /motivational\s+quote\s+card/i,
  /person\s+looking\s+at\s+screen/i,
  /digital\s+brain/i,
  /circuit\s+board/i,
  /abstract\s+blue\s+technology/i,
  /shaking\s+hands/i,
  /business\s+meeting/i,
  /laptop\s+on\s+a\s+table/i,
]

const GENERIC_CORE_DETAIL_PATTERNS = [
  /teach a counterintuitive lesson/i,
  /common misconception/i,
  /share a specific insight/i,
  /from your experience/i,
  /share the reasoning behind this belief/i,
  /what most people get wrong/i,
]

/**
 * Generate a visual concept for a social post.
 * Returns a structured concept with idea description and image prompt.
 */
export function generateVisualConcept(input: VisualConceptInput): VisualConcept {
  const resolved = {
    ...input,
    coreDetail: resolveCoreDetail(input),
  }
  const style = input.visualStyle ?? selectVisualStyle(resolved)
  const concept = buildConcept(resolved, style ?? 'editorial-illustration')
  return concept
}

function selectVisualStyle(input: VisualConceptInput): VisualConceptInput['visualStyle'] {
  const lower = `${input.postText} ${input.coreDetail} ${input.angle} ${input.topic}`.toLowerCase()

  if (/\b(context window|retrieval|rag|hallucination|eval|evaluation|metric|percent|\d+%|\d+x)\b/.test(lower)) {
    return 'minimal-data'
  }
  if (/\b(kubernetes|service mesh|operator|helm|cluster|tooling|yaml)\b/.test(lower)) {
    return 'object-composition'
  }
  if (/\b(idempotency|retry|dedupe|render|useeffect|side-effect|fallback|handoff|orchestration|pipeline|api|query|cache)\b/.test(lower)) {
    return 'technical-diagram'
  }
  if (/\b(hiring|leadership|manager|team structure|prioritization debt)\b/.test(lower)) {
    return 'typographic'
  }
  if (/\b(mistake|failure|lesson|realization|discover|backfire)\b/.test(lower)) {
    return 'visual-metaphor'
  }
  if (/\b(compare|versus|vs|before|after|tradeoff|instead of)\b/.test(lower)) {
    return 'object-composition'
  }
  if (/\b(opinion|believe|think|argue)\b/.test(lower)) {
    return 'typographic'
  }
  if (/\b(abstract|concept|idea)\b/.test(lower)) {
    return 'abstract-concept'
  }

  return 'editorial-illustration'
}

function buildConcept(input: VisualConceptInput, style: NonNullable<VisualConceptInput['visualStyle']>): VisualConcept {
  const aspectRatio = input.platform === 'linkedin' ? 'LinkedIn landscape composition (1.91:1)' : 'X composition (16:9)'

  const baseConstraints = 'No people. No generic AI imagery. No stock photos. No robots. No floating code. No motivational quote cards. No laptops on tables.'
  const mechanism = deriveCompositionHint(input, style)

  switch (style) {
    case 'editorial-illustration':
      return {
        visualIdea: `Editorial illustration focused on this mechanism: ${mechanism}`,
        imagePrompt: `Minimal editorial tech illustration focused on ${mechanism}. Context: ${summarizeForImage(input.coreDetail)}. ${input.tone === 'serious' ? 'Muted, serious palette' : 'Restrained, focused palette'}. Clean lines, precise technical-diagram sensibility. Dark graphite background, warm off-white elements, one restrained accent color. ${baseConstraints} Premium software editorial style. ${aspectRatio}.`,
      }

    case 'technical-diagram':
      return {
        visualIdea: `Technical diagram of: ${mechanism}`,
        imagePrompt: `Clean technical diagram of ${mechanism}. Supporting detail: ${summarizeForImage(input.coreDetail)}. Precise lines, clear relationships, functional aesthetic. Muted technical palette with one signal color for the key insight. White or near-white background. Annotated sparingly with labels only where needed. Engineering documentation quality, not decorative. ${baseConstraints} Technical reference aesthetic. ${aspectRatio}.`,
      }

    case 'visual-metaphor':
      return {
        visualIdea: `Visual metaphor for this tension: ${mechanism}`,
        imagePrompt: `Conceptual visual metaphor centered on ${mechanism}. Context: ${summarizeForImage(input.coreDetail)}. Single clear metaphor, not literal illustration. Restrained color palette, one focal element. Negative space used deliberately. Thoughtful composition that rewards a second look. Editorial quality, not commercial stock. ${baseConstraints} Conceptual art direction. ${aspectRatio}.`,
      }

    case 'object-composition':
      return {
        visualIdea: `Object composition representing this tradeoff: ${mechanism}`,
        imagePrompt: `Carefully composed still life showing ${mechanism}. Supporting context: ${summarizeForImage(input.coreDetail)}. Intentional arrangement, clean lighting, editorial quality. Muted tones, one accent. The composition itself communicates the idea without text. ${baseConstraints} Product photography quality. ${aspectRatio}.`,
      }

    case 'minimal-data':
      return {
        visualIdea: `Minimal data visualization of this relationship: ${mechanism}`,
        imagePrompt: `Minimal data visualization of ${mechanism}, grounded in "${summarizeForImage(input.coreDetail)}". Clean typography, generous white space, single chart or comparison. Muted palette with one accent color for the key data point. Information design quality, not dashboard UI. ${baseConstraints} Data journalism aesthetic. ${aspectRatio}.`,
      }

    case 'photographic':
      return {
        visualIdea: `Photographic concept for this scene: ${mechanism}`,
        imagePrompt: `Editorial photograph framing ${mechanism}. Context: ${summarizeForImage(input.coreDetail)}. Natural lighting, authentic moment, not staged. Muted color grading, documentary quality. The image should feel like it was captured, not generated. ${baseConstraints} Documentary photography aesthetic. ${aspectRatio}.`,
      }

    case 'typographic':
      return {
        visualIdea: `Typographic concept expressing this contrast: ${mechanism}`,
        imagePrompt: `Typography-driven composition expressing ${mechanism}. Pull one short phrase from "${summarizeForImage(input.coreDetail)}" as the visual focal point. Thoughtful type choice, deliberate scale relationships. Minimal imagery; type carries the argument. Restrained palette, editorial layout quality. ${baseConstraints} Editorial design aesthetic. ${aspectRatio}.`,
      }

    case 'abstract-concept':
      return {
        visualIdea: `Abstract visual for this mechanism: ${mechanism}`,
        imagePrompt: `Abstract conceptual composition based on ${mechanism}. Context: ${summarizeForImage(input.coreDetail)}. Shapes, color, and space communicating the idea without literal representation. Restrained palette, deliberate composition. Rewards contemplation. Fine art quality, not decorative. ${baseConstraints} Abstract editorial aesthetic. ${aspectRatio}.`,
      }
  }
}

function resolveCoreDetail(input: VisualConceptInput): string {
  const fallback = [input.coreDetail, input.angle, input.topic].find((v) => typeof v === 'string' && v.trim().length > 0) ?? ''
  const fallbackClean = summarizeForImage(fallback)
  const fromPost = bestSentenceForVisual(input.postText)

  if (fromPost) return fromPost
  if (!isGenericCoreDetail(fallbackClean)) return fallbackClean
  return summarizeForImage(input.topic)
}

function isGenericCoreDetail(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 24) return true
  return GENERIC_CORE_DETAIL_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function bestSentenceForVisual(postText: string): string | null {
  if (!postText || !postText.trim()) return null
  const candidates = postText
    .split(/\n+/)
    .flatMap((line) => line.split(/[.!?]+/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 24)

  let best = ''
  let bestScore = -1

  for (const line of candidates) {
    if (isGenericCoreDetail(line)) continue
    const score = scoreSentenceForVisual(line)
    if (score > bestScore) {
      best = line
      bestScore = score
    }
  }

  if (!best) return null
  return summarizeForImage(best)
}

function scoreSentenceForVisual(sentence: string): number {
  const lower = sentence.toLowerCase()
  let score = 0

  if (/\b(because|causes?|leads? to|results? in|therefore|so that|instead of|versus|tradeoff)\b/.test(lower)) score += 3
  if (/\b(idempotency|retry|fallback|handoff|render|retrieval|hallucination|kubernetes|pipeline|query|cache|team|hiring|prioritization)\b/.test(lower)) score += 3
  if (/\b(\d+%|\d+x|\d+\s*(ms|sec|min|minutes|hours|users|customers|nodes))\b/.test(lower)) score += 2
  if (/\b(failure|mistake|bottleneck|debt|stale|duplicate|latency|confidence)\b/.test(lower)) score += 2
  if (sentence.length >= 45 && sentence.length <= 160) score += 1

  return score
}

function deriveCompositionHint(
  input: VisualConceptInput,
  style: NonNullable<VisualConceptInput['visualStyle']>,
): string {
  const lower = `${input.postText} ${input.coreDetail}`.toLowerCase()

  if (style === 'technical-diagram') {
    if (/\b(idempotency|retry|duplicate)\b/.test(lower)) {
      return 'a request-retry loop with a dedupe key ledger blocking duplicate writes'
    }
    if (/\b(render|useeffect|side-effect|bundle)\b/.test(lower)) {
      return 'a render pipeline where side-effects are moved out of the render path'
    }
    if (/\b(fallback|handoff|confidence|agent)\b/.test(lower)) {
      return 'a decision tree with confidence gate and explicit human fallback branch'
    }
    return 'a system flow map with one failure seam highlighted and corrected path annotated'
  }

  if (style === 'minimal-data') {
    if (/\b(context window|retrieval|hallucination|rag)\b/.test(lower)) {
      return 'context quality vs hallucination rate as a single two-axis relationship'
    }
    return 'one measurable relationship showing cause and effect'
  }

  if (style === 'object-composition') {
    if (/\b(kubernetes|service mesh|operator|tooling|complexity)\b/.test(lower)) {
      return 'a stack of tooling layers with excess layers removed to reveal a stable core'
    }
    return 'two competing objects arranged to show a clear tradeoff'
  }

  if (style === 'typographic') {
    if (/\b(hiring|leadership|manager|team)\b/.test(lower)) {
      return 'the contrast between hiring fast and hiring well'
    }
    return 'one primary claim paired with a short qualifying counterpoint'
  }

  if (style === 'visual-metaphor') {
    if (/\b(failure|mistake|wrong|backfire)\b/.test(lower)) {
      return 'a controlled failure point redirected into a safer path'
    }
    return 'a single metaphor showing mechanism, tension, and consequence'
  }

  return summarizeForImage(input.coreDetail)
}

/**
 * Summarize a detail into a concise form suitable for an image prompt.
 * Strips quotes, names, and overly specific references that won't visualize well.
 */
function summarizeForImage(text: string): string {
  let cleaned = text.replace(/[""]/g, '')
  cleaned = cleaned.replace(/\s*[—–]\s*/g, ' ')
  // Truncate to a reasonable length
  if (cleaned.length > 120) {
    cleaned = cleaned.slice(0, 117) + '...'
  }
  return cleaned.trim()
}

/**
 * Check if a visual concept is too generic/overused.
 * Returns true if the concept passes originality checks.
 */
export function isVisualConceptOriginal(imagePrompt: string): boolean {
  const sanitized = stripNegativeConstraintMentions(imagePrompt)
  return !OVERUSED_VISUALS.some(pattern => pattern.test(sanitized))
}

function stripNegativeConstraintMentions(text: string): string {
  const negativePatterns = [
    /\bno\s+people\b/gi,
    /\bno\s+generic\s+ai\s+imagery\b/gi,
    /\bno\s+stock\s+photos?\b/gi,
    /\bno\s+robots?\b/gi,
    /\bno\s+floating\s+code\b/gi,
    /\bno\s+motivational\s+quote\s+cards?\b/gi,
    /\bno\s+laptops?\s+on\s+tables?\b/gi,
  ]

  let cleaned = text
  for (const pattern of negativePatterns) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned
}

/**
 * Build a system prompt for the visual concept generation model.
 * Used when delegating concept generation to a model call.
 */
export function buildVisualSystemPrompt(): string {
  return `You create visual concepts for social media posts. Your job is to describe an image concept that makes someone curious about the post caption.

CRITICAL RULES:
- Never suggest generic imagery: no laptops, no robots, no AI brains, no floating code, no stock photos, no motivational quote cards.
- Every concept must be SPECIFIC to the post's actual content and angle.
- The image should complement the post, not literally illustrate every sentence.
- Prefer editorial illustration, technical diagrams, visual metaphors, or abstract concepts over photography.
- If the post is about a technical debugging story, the image should NOT show a person at a computer. It should visualize the CONCEPT.

Return JSON: { "visual_idea": "one sentence describing the concept", "image_prompt": "concise production-ready prompt" }`
}

/**
 * Build a user prompt for visual concept generation.
 */
export function buildVisualUserPrompt(input: {
  postText: string
  topic: string
  angle: string
  platform: string
}): string {
  return `POST TOPIC: ${input.topic}
POST ANGLE: ${input.angle}
PLATFORM: ${input.platform}

POST TEXT:
"""
${input.postText.slice(0, 500)}
"""

Create a visual concept for this post. Output JSON: { "visual_idea": "...", "image_prompt": "..." }`
}

// ============================================================================
// Humanized Image Prompt Generator
// Produces prompts that generate photorealistic, candid images — never vector,
// never illustration, never "AI-looking". The goal: an image that looks like
// a real person captured it with their camera.
// ============================================================================

export interface HumanizedImageInput {
  postText: string
  topic: string
  angle: string
  tone: string
  /** The core detail or insight the post centers on */
  coreDetail: string
  platform: 'linkedin' | 'x'
}

export interface HumanizedImageResult {
  visualIdea: string
  imagePrompt: string
  style: 'candid_documentary' | 'editorial_environment' | 'detail_macro' | 'atmospheric_scene' | 'workplace_moment'
}

const OVERUSED_SUBJECTS = [
  /laptop/i, /robot/i, /ai brain/i, /code on screen/i, /person at desk/i,
  /business handshake/i, /stock photo/i, /3d render/i, /illustration/i,
  /vector/i, /cartoon/i, /flat design/i, /gradient background/i,
  /glowing (circuit|node|network)/i, /floating (screen|device|phone)/i,
  /person staring at (screen|laptop|monitor)/i, /white (background|studio)/i,
  /abstract (shape|pattern|blob|geometry)/i, /hologram/i,
]

function selectHumanizedStyle(input: HumanizedImageInput): HumanizedImageResult['style'] {
  const text = `${input.postText} ${input.coreDetail} ${input.topic}`.toLowerCase()

  if (/\b(error|bug|mistake|fail|broken|fix|debug|crash)\b/.test(text)) {
    return 'detail_macro'
  }
  if (/\b(team|office|cowork|meeting|culture|hire|work)\b/.test(text)) {
    return 'workplace_moment'
  }
  if (/\b(travel|city|street|cafe|outside|nature|walk|commute)\b/.test(text)) {
    return 'candid_documentary'
  }
  if (/\b(data|chart|growth|metric|number|percent|result)\b/.test(text)) {
    return 'atmospheric_scene'
  }
  return 'editorial_environment'
}

function buildHumanizedPrompt(
  style: HumanizedImageResult['style'],
  input: HumanizedImageInput,
): HumanizedImageResult {
  const aspectRatio = input.platform === 'linkedin' ? '1.91:1 landscape' : '16:9 or 1:1'
  const mood = input.tone === 'serious' ? 'contemplative, grounded'
    : input.tone === 'frustrated' ? 'raw, unpolished'
    : input.tone === 'excited' ? 'energetic, alive'
    : 'authentic, unhurried'

  const baseConstraints = [
    'Photorealistic. Shot on a real camera — shallow depth of field, natural lens compression.',
    'NO illustrations, NO vectors, NO 3D renders, NO cartoon, NO flat design.',
    'NO stock photo poses. NO generic business imagery.',
    'NO text overlays, NO watermarks, NO logos.',
    'Must look like a photograph a real person took — imperfect, candid, lived-in.',
  ].join(' ')

  const scene = extractSceneFromPost(input.postText, input.coreDetail)
  const props = selectPropsForTopic(input.topic)

  switch (style) {
    case 'candid_documentary':
      return {
        visualIdea: `Candid documentary photograph: ${scene}`,
        imagePrompt: `Candid documentary photograph. ${scene}. ${props}. Natural light — overcast or golden hour. Shot on Fujifilm X-T5 or similar, 35mm lens, f/2.0. Slight grain, natural color grading. The moment feels unposed — someone captured this while walking by. ${mood} atmosphere. ${baseConstraints} ${aspectRatio}.`,
        style,
      }

    case 'editorial_environment':
      return {
        visualIdea: `Editorial environment photograph: ${scene}`,
        imagePrompt: `Editorial environment photograph. ${scene}. ${props}. Careful composition with strong foreground interest and layered depth. Natural lighting from windows or practical sources. Muted color palette — one subtle warm tone breaking through cool neutrals. Shot on Sony A7IV, 24-70mm. Professional but not sterile. ${mood} atmosphere. ${baseConstraints} ${aspectRatio}.`,
        style,
      }

    case 'detail_macro':
      return {
        visualIdea: `Detail macro photograph: ${scene}`,
        imagePrompt: `Detail macro photograph. ${scene}. ${props}. Extreme close-up, shallow depth of field, focus on texture and material detail. Available light — desk lamp, window, or overhead fluorescents. The imperfection IS the story: coffee rings, worn edges, handwritten notes, screen glare. Shot on Canon R5, 100mm macro. ${mood} atmosphere. ${baseConstraints} ${aspectRatio}.`,
        style,
      }

    case 'atmospheric_scene':
      return {
        visualIdea: `Atmospheric scene: ${scene}`,
        imagePrompt: `Atmospheric photograph. ${scene}. ${props}. Wide shot with strong sense of place. Dawn or dusk light — long shadows, warm highlights. The environment tells the story: empty coworking space at 7am, a single lit window in a dark building, rain on glass. Shot on Leica Q2, 28mm. Cinematic color grade. ${mood} atmosphere. ${baseConstraints} ${aspectRatio}.`,
        style,
      }

    case 'workplace_moment':
      return {
        visualIdea: `Workplace moment: ${scene}`,
        imagePrompt: `Workplace moment photograph. ${scene}. ${props}. Candid — not posed. Real workspace with real mess: cables, notebooks, coffee cups, sticky notes on a monitor. Natural mixed lighting. The person (if any) is shown from behind or in profile — never facing camera. Shot on iPhone 15 Pro or similar. Slightly warm, slightly imperfect. The authenticity is the point. ${mood} atmosphere. ${baseConstraints} ${aspectRatio}.`,
        style,
      }
  }
}

function extractSceneFromPost(postText: string, coreDetail: string): string {
  const sentences = postText.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 20)
  if (sentences.length > 0) {
    const best = sentences.find(s => !/^(i |we |my |the |a |an |it |this |that |here |there |what |how |why |when |do |does |is |are )/i.test(s)) ?? sentences[0]
    const cleaned = best.replace(/^[^a-zA-Z]+/, '').trim()
    if (cleaned.length > 15) return cleaned.slice(0, 120)
  }
  return coreDetail.slice(0, 120)
}

function selectPropsForTopic(topic: string): string {
  const lower = topic.toLowerCase()
  if (/ai|machine learning|llm/.test(lower)) return 'Physical artifacts of AI work: printed model outputs, handwritten architecture sketches, server room, GPU rig with visible cables'
  if (/startup|founder|business/.test(lower)) return 'Startup artifacts: whiteboard with strategy notes, coffee-stained pitch deck pages, early prototype on a desk'
  if (/devops|infrastructure|cloud/.test(lower)) return 'Infrastructure artifacts: server room, cable management, terminal screenshot on a worn monitor, rack lights'
  if (/web|frontend|design/.test(lower)) return 'Design artifacts: browser with dev tools open, design sketches, component library printouts, Figma on screen'
  if (/security/.test(lower)) return 'Security artifacts: encrypted notebook, lock icons drawn on paper, terminal with security scan running'
  if (/data|analytics/.test(lower)) return 'Data artifacts: hand-drawn charts on paper, spreadsheet printouts, database schema on whiteboard'
  return 'Work artifacts: notebook with handwritten notes, coffee cup, warm desk lamp light, natural workspace clutter'
}

/**
 * Generate a humanized, photorealistic image prompt for a social post.
 * The output is designed to produce images that look like real photographs —
 * never vector art, never illustration, never "AI-generated looking".
 */
export function generateHumanizedImagePrompt(input: HumanizedImageInput): HumanizedImageResult {
  const style = selectHumanizedStyle(input)
  const result = buildHumanizedPrompt(style, input)

  // Verify the prompt doesn't contain overused subjects
  for (const pattern of OVERUSED_SUBJECTS) {
    if (pattern.test(result.imagePrompt)) {
      // Inject a stronger negative constraint
      result.imagePrompt = result.imagePrompt.replace(
        '. ',
        '. AVOID: ' + pattern.source + '. ',
      )
    }
  }

  return result
}
