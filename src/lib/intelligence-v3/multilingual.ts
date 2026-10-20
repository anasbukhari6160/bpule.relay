/**
 * Multilingual source reading — bounded, deterministic.
 *
 * English regexes systematically under-score non-English profiles: a German
 * founder asking "wir suchen eine Agentur" was invisible to the buyer-intent
 * reader, while a Spanish seller line ("ayudamos a empresas") was never
 * excluded as seller-owned. This module gives the line classifier the same
 * grammar in German, French, Spanish and Turkish, plus a cheap language
 * detector so confidence can say when the deterministic readers ran outside
 * their coverage. The decision model (structured, one call) remains the
 * semantic layer for anything the patterns do not cover.
 */

export type SourceLanguage = 'en' | 'de' | 'fr' | 'es' | 'tr' | 'other' | 'mixed'

const STOPWORDS: Record<Exclude<SourceLanguage, 'other' | 'mixed'>, RegExp> = {
  en: /\b(?:the|and|with|for|our|we|are|is|of|to|in|at|looking|building|team|help)\b/gi,
  de: /\b(?:und|wir|sind|mit|für|der|die|das|ein|eine|nicht|auf|bei|suchen|unser|unsere|ich|bin)\b/gi,
  fr: /\b(?:nous|sommes|avec|pour|les|des|une|est|dans|notre|nos|cherchons|chez|je|suis|sur)\b/gi,
  es: /\b(?:nosotros|somos|con|para|los|las|una|está|estamos|nuestro|nuestra|buscamos|en|soy|que)\b/gi,
  tr: /\b(?:ve|biz|ile|için|bir|olarak|arıyoruz|şirket|ekip|ekibimiz|yapıyoruz|kurucu|yeni|çok|ben)\b/gi,
}

export function detectSourceLanguage(text: string): SourceLanguage {
  const sample = text.slice(0, 6000)
  const counts = Object.entries(STOPWORDS).map(([lang, re]) => [lang, (sample.match(re) ?? []).length] as const)
  counts.sort((a, b) => b[1] - a[1])
  const [top, second] = counts
  const total = counts.reduce((s, [, n]) => s + n, 0)
  if (total < 4) return 'other'
  if (top[1] < total * 0.45) return 'mixed'
  if (second && second[1] >= top[1] * 0.6 && second[1] >= 6) return 'mixed'
  return top[0] as SourceLanguage
}

// ── Line grammar, per language ──────────────────────────────────────────────
// Each regex family mirrors the English family in source-facts.ts. They are
// deliberately narrow (first-person requests, explicit nouns) so a translated
// seller sentence cannot become a buyer request.

/** Prospect asks for an outside provider: agency, freelancer, developer, partner. */
export const ML_EXTERNAL_REQUEST: RegExp[] = [
  // German: "wir suchen eine Agentur / einen Freelancer / externe Entwickler", "brauchen Unterstützung von einer Agentur"
  /\b(?:wir|ich)\s+(?:suchen|suche|brauchen|brauche|benötigen|benötige)\s+(?:dringend\s+)?(?:eine?n?\s+)?(?:\w+\s+){0,3}?(?:agentur|freelancer|entwickler(?:in|innen)?|dienstleister|softwarepartner|entwicklungspartner|externe[ns]?\s+(?:team|entwickler|partner))\b/i,
  // French: "nous cherchons une agence / un freelance / un prestataire / des développeurs"
  /\b(?:nous|je)\s+(?:cherchons|cherche|recherchons|recherche|avons\s+besoin\s+d(?:'|’)?|ai\s+besoin\s+d(?:'|’)?)\s*(?:une?\s+|des\s+|d(?:'|’)?)?(?:\w+\s+){0,3}?(?:agence|freelance|prestataire|développeurs?|partenaire\s+(?:technique|de\s+développement)|équipe\s+externe)\b/i,
  // Spanish: "buscamos una agencia / un freelance / desarrolladores externos", "necesitamos un proveedor"
  /\b(?:buscamos|busco|necesitamos|necesito)\s+(?:urgente(?:mente)?\s+)?(?:una?\s+)?(?:\w+\s+){0,3}?(?:agencia|freelance|freelancer|proveedor|desarrolladores?|socio\s+tecnológico|equipo\s+externo|consultora)\b/i,
  // Turkish: "ajans arıyoruz", "freelance geliştirici arıyoruz", "dış kaynak ekip"
  /\b(?:\w+\s+){0,3}?(?:ajans|freelance(?:r)?|yazılım\s+(?:ajansı|firması|ortağı)|dış\s+kaynak|geliştirici)\s+(?:\w+\s+){0,2}?(?:arıyoruz|arıyorum|ihtiyacımız\s+var|lazım)\b/i,
]

/** Employee recruitment at the prospect's own organization. */
export const ML_EMPLOYMENT_HIRING: RegExp[] = [
  /\b(?:wir\s+stellen\s+ein|wir\s+suchen\s+verstärkung|offene\s+stellen?|bewerbung(?:en)?\s+an|jetzt\s+bewerben|werde\s+teil\s+unseres\s+teams)\b/i,
  /\b(?:nous\s+recrutons|on\s+recrute|poste\s+ouvert|postes?\s+à\s+pourvoir|rejoignez\s+notre\s+équipe|envoyez\s+votre\s+cv|candidatez)\b/i,
  /\b(?:estamos\s+contratando|buscamos\s+(?:incorporar|sumar)|vacante|únete\s+a\s+nuestro\s+equipo|env[ií]a\s+tu\s+cv|postula)\b/i,
  /\b(?:işe\s+alıyoruz|ekibimize\s+katıl|açık\s+pozisyon|cv(?:'|’)?nizi\s+gönderin|takım\s+arkadaşı\s+arıyoruz)\b/i,
]

/** Seller-owned supply lines: what the prospect's organization offers. */
export const ML_SELLER_OWNERSHIP: RegExp[] = [
  /\b(?:wir\s+(?:helfen|bieten|entwickeln|bauen|liefern|unterstützen|beraten)|unsere\s+(?:plattform|lösung|software|dienstleistungen?|kunden|agentur)|jetzt\s+demo\s+buchen|kostenlose\s+beratung)\b/i,
  /\b(?:nous\s+(?:aidons|accompagnons|proposons|développons|construisons|livrons)|notre\s+(?:plateforme|solution|logiciel|agence|offre)|nos\s+(?:services|clients|solutions)|réservez\s+une\s+démo)\b/i,
  /\b(?:ayudamos\s+a|ofrecemos|desarrollamos|construimos|acompañamos\s+a|nuestra\s+(?:plataforma|solución|agencia|consultora)|nuestros\s+(?:servicios|clientes)|solicita\s+una\s+demo)\b/i,
  /\b(?:şirketlere\s+yardımcı\s+oluyoruz|sunuyoruz|geliştiriyoruz|müşterilerimiz|hizmetlerimiz|platformumuz|çözümümüz|demo\s+talep\s+et)\b/i,
]

/** The prospect is seeking work for themselves. */
export const ML_CANDIDATE_SEEKING: RegExp[] = [
  /\b(?:ich\s+(?:suche|bin\s+offen\s+für)\s+(?:eine\s+)?(?:neue\s+)?(?:herausforderung|stelle|position|festanstellung|freelance[- ]projekte)|offen\s+für\s+neue\s+(?:aufgaben|herausforderungen|möglichkeiten))\b/i,
  /\b(?:je\s+(?:suis\s+)?(?:à\s+la\s+recherche\s+d(?:'|’)?|ouvert\s+à)\s*(?:un\s+)?(?:nouveau\s+)?(?:poste|emploi|mission|opportunités?|défi)|disponible\s+pour\s+(?:de\s+)?nouvelles?\s+missions?)\b/i,
  /\b(?:busco\s+(?:un\s+)?(?:nuevo\s+)?(?:empleo|trabajo|puesto|reto|oportunidad)|abiert[oa]\s+a\s+(?:nuevas\s+)?oportunidades|disponible\s+para\s+(?:nuevos\s+)?proyectos)\b/i,
  /\b(?:iş\s+arıyorum|yeni\s+(?:iş\s+)?fırsatlara\s+açığım|yeni\s+bir\s+pozisyon\s+arıyorum)\b/i,
]

/** Founder / executive role words. */
export const ML_FOUNDER_ROLE = /\b(?:gründer(?:in)?|mitgründer(?:in)?|geschäftsführer(?:in)?|fondateur|fondatrice|cofondateur|cofondatrice|directeur\s+général|fundador[a]?|cofundador[a]?|director[a]?\s+general|kurucu|kurucu\s+ortak|genel\s+müdür|ceo|cto)\b/i

/** Current product / build activity. */
export const ML_PRODUCT_ACTIVITY = /\b(?:wir\s+(?:bauen|entwickeln|launchen)|gerade\s+gestartet|nous\s+(?:construisons|développons|lançons)|vient\s+de\s+sortir|estamos\s+(?:construyendo|desarrollando|lanzando)|acabamos\s+de\s+lanzar|geliştiriyoruz|yeni\s+ürün|yayına\s+aldık|lansman)\b/i

/** Historical phrasing outside English. */
export const ML_PAST_PHRASE = /\b(?:früher|zuvor|davor|ehemals|ehemalige[rs]?|auparavant|anciennement|ancien(?:ne)?|anteriormente|antes\s+de|ex-|daha\s+önce|önceden|eski)\b/i

export function mlMatches(patterns: RegExp[], line: string): boolean {
  return patterns.some((re) => re.test(line))
}
