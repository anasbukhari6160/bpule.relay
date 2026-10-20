import { li } from './builder'
import type { GoldenFixture } from './types'

const BUYER_MODEL = { relationship: 'BUYER' as const, buyerRequestProbability: 0.88, externalNeedProbability: 0.8, fit: 'STRONG' as const, timing: 'CURRENT' as const, access: 'CONNECTION' as const, messageEligible: 0.7 }
const NEUTRAL_MODEL = { relationship: 'UNKNOWN' as const, buyerRequestProbability: 0.15, externalNeedProbability: 0.2, fit: 'MEDIUM' as const, timing: 'WEAK' as const, access: 'CONNECTION' as const, messageEligible: 0.3 }

/**
 * Non-English and mixed-language profiles. The deterministic readers cover
 * DE/FR/ES/TR request, hiring, seller and candidate grammar; the model stays
 * the semantic layer. A German buyer must not score lower than the same
 * English buyer only because of language.
 */
export const MULTILINGUAL_FIXTURES: GoldenFixture[] = [
  // ── German ───────────────────────────────────────────────────────────────
  {
    id: 'de-buyer-agentur-gesucht',
    category: 'multilingual',
    notes: 'German CTO looking for an agency, with budget and start. HIGH intent.',
    rawText: li({
      name: 'Katrin Weber', headline: 'CTO bei Nordlicht Logistik GmbH', location: 'Hamburg, Deutschland', degree: '2nd', connections: '1.200+ Kontakte',
      about: ['Nordlicht Logistik ist ein Spediteur mit 250 Mitarbeitenden. Wir digitalisieren unsere Disposition.'],
      posts: [{ age: '3d', text: 'Wir suchen eine Agentur für die Neuentwicklung unseres Kundenportals in React und TypeScript. Budget ist freigegeben: 60.000 €. Start in 4 Wochen. Bitte Referenzen per Nachricht.' }],
      experience: [{ title: 'CTO', company: 'Nordlicht Logistik GmbH', range: 'Jan 2021 - Heute · 4 Jahre 10 Monate' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [55, 100], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], qualification: ['WORTH_PURSUING', 'STRONG'] },
  },
  {
    id: 'de-seller-wir-helfen',
    category: 'multilingual',
    notes: 'German agency founder selling services. SELLER, UNKNOWN intent, LOW/SKIP.',
    rawText: li({
      name: 'Lukas Brandt', headline: 'Gründer & Geschäftsführer bei Brandt Digital', location: 'München, Deutschland', degree: '2nd', connections: '2.000+ Kontakte',
      about: ['Wir helfen mittelständischen Unternehmen bei der Entwicklung von Web- und Mobile-Apps.', 'Unsere Agentur liefert React- und Node-Projekte in 8 Wochen. Jetzt Demo buchen.'],
      posts: [{ age: '2d', text: 'Neues Case Study: Wir haben für einen Kunden ein Händlerportal in 6 Wochen gebaut. Kostenlose Beratung für Ihr Projekt.' }],
      experience: [{ title: 'Gründer & Geschäftsführer', company: 'Brandt Digital', range: 'Jan 2017 - Heute · 8 Jahre 10 Monate' }],
    }),
    model: { relationship: 'BUYER', buyerRequestProbability: 0.7, externalNeedProbability: 0.6, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { scoreRange: [5, 40], buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], qualification: ['LOW', 'SKIP', 'MAYBE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'de-hiring-wir-stellen-ein',
    category: 'multilingual',
    notes: 'German company hiring employees. Hiring verified, no buyer intent.',
    rawText: li({
      name: 'Sabine Hoffmann', headline: 'Head of Engineering bei Fintura AG', location: 'Frankfurt am Main, Deutschland', degree: '2nd', connections: '900+ Kontakte',
      about: ['Fintura baut Zahlungsinfrastruktur für den Mittelstand.'],
      posts: [{ age: '4d', text: 'Wir stellen ein: zwei Backend-Entwickler (Java, Kafka) für unser Team in Frankfurt. Bewerbungen an jobs@fintura.example.' }],
      experience: [{ title: 'Head of Engineering', company: 'Fintura AG', range: 'Mar 2020 - Heute · 5 Jahre 8 Monate' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.2, externalNeedProbability: 0.2, needOwner: 'HIRING_NEED', fit: 'MEDIUM', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { buyerIntent: ['UNKNOWN'], verifiedHiring: true, qualification: ['MAYBE', 'LOW', 'WORTH_PURSUING'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'de-candidate-offen-fuer-neues',
    category: 'multilingual',
    notes: 'German developer open to a new role. CANDIDATE.',
    rawText: li({
      name: 'Jonas Keller', headline: 'Senior Frontend Entwickler | React | Offen für neue Herausforderungen', location: 'Berlin, Deutschland', degree: '2nd', connections: '600+ Kontakte',
      about: ['Ich suche eine neue Herausforderung als Senior Frontend Entwickler, gerne remote.'],
      posts: [{ age: '1w', text: 'Nach 5 Jahren bei meinem Arbeitgeber bin ich offen für neue Aufgaben. Hinweise auf spannende Teams willkommen!' }],
      experience: [{ title: 'Senior Frontend Entwickler', company: 'Webwerk GmbH', range: 'Jan 2020 - Heute · 5 Jahre 10 Monate' }],
    }),
    model: NEUTRAL_MODEL,
    expect: { relationshipRole: ['CANDIDATE'], buyerIntent: ['UNKNOWN', 'LOW'], qualification: ['LOW', 'SKIP'] },
  },
  // ── French ───────────────────────────────────────────────────────────────
  {
    id: 'fr-buyer-cherchons-agence',
    category: 'multilingual',
    notes: 'French founder looking for an agency with timeline. HIGH/MEDIUM intent.',
    rawText: li({
      name: 'Camille Durand', headline: 'Fondatrice & CEO chez Maison Verte | Marketplace de produits locaux', location: 'Lyon, France', degree: '2nd', connections: '1 500+ relations',
      about: ['Maison Verte connecte producteurs locaux et restaurateurs. 40 personnes, levée de 3 M€ en série A.'],
      posts: [{ age: '2d', text: 'Nous cherchons une agence pour refondre notre application mobile en React Native. Démarrage dans 3 semaines. Envoyez-nous vos références en message.' }],
      experience: [{ title: 'Fondatrice & CEO', company: 'Maison Verte', range: 'Sept 2020 - Aujourd\'hui · 5 ans 2 mois' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [55, 100], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'fr-seller-nous-aidons',
    category: 'multilingual',
    notes: 'French consulting firm selling. SELLER.',
    rawText: li({
      name: 'Thomas Lefèvre', headline: 'Associé chez Lefèvre Conseil | Transformation digitale', location: 'Paris, France', degree: '3rd', connections: '3 000+ relations',
      about: ['Nous aidons les PME à réussir leur transformation digitale.', 'Notre agence propose des équipes React et Node en régie. Réservez une démo.'],
      posts: [{ age: '5d', text: 'Nos clients gagnent en moyenne 30 % de productivité après six mois. Parlons de votre projet.' }],
      experience: [{ title: 'Associé', company: 'Lefèvre Conseil', range: 'Jan 2015 - Aujourd\'hui · 10 ans 10 mois' }],
    }),
    model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.3, externalNeedProbability: 0.3, fit: 'STRONG', timing: 'CURRENT', access: 'INDIRECT' },
    expect: { buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], qualification: ['LOW', 'SKIP', 'MAYBE'] },
  },
  {
    id: 'fr-hiring-nous-recrutons',
    category: 'multilingual',
    notes: 'French company recruiting. Hiring verified, no buyer intent.',
    rawText: li({
      name: 'Inès Moreau', headline: 'CTO chez Kiosque Santé', location: 'Nantes, France', degree: '2nd', connections: '800+ relations',
      about: ['Kiosque Santé édite un logiciel de prise de rendez-vous pour les cliniques.'],
      posts: [{ age: '3d', text: 'Nous recrutons un développeur backend (Python, PostgreSQL) et un product designer. Postes à pourvoir à Nantes ou à distance. Candidatez via notre site.' }],
      experience: [{ title: 'CTO', company: 'Kiosque Santé', range: 'Jan 2019 - Aujourd\'hui · 6 ans 10 mois' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.2, externalNeedProbability: 0.2, needOwner: 'HIRING_NEED', fit: 'MEDIUM', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { buyerIntent: ['UNKNOWN'], verifiedHiring: true, currentIndustry: 'healthcare' },
  },
  // ── Spanish ──────────────────────────────────────────────────────────────
  {
    id: 'es-buyer-buscamos-agencia',
    category: 'multilingual',
    notes: 'Spanish operations director seeking an agency, budget stated. HIGH/MEDIUM intent.',
    rawText: li({
      name: 'Javier Morales', headline: 'Director de Operaciones en Rutas del Sur', location: 'Sevilla, España', degree: '2nd', connections: '2.000+ contactos',
      about: ['Rutas del Sur es una empresa de transporte con 180 empleados en Andalucía.'],
      posts: [{ age: '4d', text: 'Buscamos una agencia de desarrollo para construir nuestra app de conductores en Flutter. Presupuesto aprobado de 45.000 €. Inicio en 5 semanas. Escríbeme si tienes experiencia en logística.' }],
      experience: [{ title: 'Director de Operaciones', company: 'Rutas del Sur', range: 'Feb 2018 - Actualidad · 7 años 9 meses' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [55, 100], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], currentIndustry: 'logistics' },
  },
  {
    id: 'es-seller-ayudamos-a',
    category: 'multilingual',
    notes: 'Spanish dev shop selling. SELLER.',
    rawText: li({
      name: 'Lucía Fernández', headline: 'Fundadora en Código Sur | Desarrollo web y móvil', location: 'Buenos Aires, Argentina', degree: '2nd', connections: '4.000+ contactos',
      about: ['Ayudamos a startups a lanzar sus productos digitales en semanas.', 'Nuestra agencia desarrolla en React, Node y Flutter. Solicita una demo gratuita.'],
      posts: [{ age: '2d', text: 'Nuevo caso de éxito: construimos un marketplace para un cliente en 7 semanas. ¿Tu proyecto es el siguiente?' }],
      experience: [{ title: 'Fundadora', company: 'Código Sur', range: 'Mar 2016 - Actualidad · 9 años 8 meses' }],
    }),
    model: { relationship: 'BUYER', buyerRequestProbability: 0.65, externalNeedProbability: 0.6, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], qualification: ['LOW', 'SKIP', 'MAYBE'] },
    mustNotCredit: ['Explicit buyer request detected'],
  },
  {
    id: 'es-candidate-busco-empleo',
    category: 'multilingual',
    notes: 'Spanish engineer seeking a job. CANDIDATE.',
    rawText: li({
      name: 'Diego Ramírez', headline: 'Ingeniero de Software | Node.js | AWS | Abierto a nuevas oportunidades', location: 'Ciudad de México, México', degree: '3rd', connections: '700+ contactos',
      about: ['Busco un nuevo empleo como ingeniero backend, preferiblemente remoto.'],
      posts: [{ age: '6d', text: 'Después de 3 años en Pagos Rápidos, busco un nuevo reto. Abierto a oportunidades en LATAM y Europa.' }],
      experience: [{ title: 'Ingeniero de Software', company: 'Pagos Rápidos', range: 'Jan 2022 - Actualidad · 3 años 10 meses' }],
    }),
    model: NEUTRAL_MODEL,
    expect: { relationshipRole: ['CANDIDATE'], qualification: ['LOW', 'SKIP'] },
  },
  // ── Turkish ──────────────────────────────────────────────────────────────
  {
    id: 'tr-buyer-ajans-ariyoruz',
    category: 'multilingual',
    notes: 'Turkish founder looking for an agency. HIGH/MEDIUM intent.',
    rawText: li({
      name: 'Elif Yıldız', headline: 'Kurucu Ortak & CEO, Tarla Teknoloji', location: 'İstanbul, Türkiye', degree: '2nd', connections: '1.500+ bağlantı',
      about: ['Tarla, çiftçiler için tarla yönetimi uygulaması geliştiriyor. 12 kişilik bir ekibiz.'],
      posts: [{ age: '2d', text: 'Mobil uygulamamızı yeniden geliştirmek için bir yazılım ajansı arıyoruz (React Native, Node). Bütçe onaylandı. 3 hafta içinde başlamak istiyoruz. Referanslarınızla mesaj atın.' }],
      experience: [{ title: 'Kurucu Ortak & CEO', company: 'Tarla Teknoloji', range: 'Oca 2022 - Halen · 3 yıl 10 ay' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [50, 100], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'] },
  },
  {
    id: 'tr-seller-hizmetlerimiz',
    category: 'multilingual',
    notes: 'Turkish agency selling services. SELLER.',
    rawText: li({
      name: 'Mert Kaya', headline: 'Kurucu, Kaya Yazılım | Web ve mobil geliştirme', location: 'Ankara, Türkiye', degree: '2nd', connections: '3.000+ bağlantı',
      about: ['Şirketlere yardımcı oluyoruz: React, Node ve Flutter ile 8 haftada ürün çıkarıyoruz.', 'Hizmetlerimiz: web geliştirme, mobil uygulama, bakım. Demo talep et.'],
      posts: [{ age: '3d', text: 'Müşterilerimiz için bu ay 3 proje teslim ettik. Projeniz için bize yazın.' }],
      experience: [{ title: 'Kurucu', company: 'Kaya Yazılım', range: 'Oca 2018 - Halen · 7 yıl 10 ay' }],
    }),
    model: { relationship: 'SERVICE_PROVIDER', buyerRequestProbability: 0.3, externalNeedProbability: 0.3, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { buyerIntent: ['UNKNOWN'], relationshipRole: ['SELLER'], qualification: ['LOW', 'SKIP', 'MAYBE'] },
  },
  {
    id: 'tr-hiring-ise-aliyoruz',
    category: 'multilingual',
    notes: 'Turkish company hiring. Hiring verified, no buyer intent.',
    rawText: li({
      name: 'Zeynep Arslan', headline: 'CTO, Hızlı Kargo', location: 'İzmir, Türkiye', degree: '2nd', connections: '900+ bağlantı',
      about: ['Hızlı Kargo, e-ticaret için aynı gün teslimat altyapısı sunuyor.'],
      posts: [{ age: '5d', text: 'İşe alıyoruz: 2 backend geliştirici (Go, PostgreSQL). Ekibimize katıl — CV\'nizi gönderin.' }],
      experience: [{ title: 'CTO', company: 'Hızlı Kargo', range: 'Mar 2021 - Halen · 4 yıl 8 ay' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.2, externalNeedProbability: 0.2, needOwner: 'HIRING_NEED', fit: 'MEDIUM', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { buyerIntent: ['UNKNOWN'], verifiedHiring: true },
  },
  // ── Mixed ────────────────────────────────────────────────────────────────
  {
    id: 'mixed-de-en-buyer',
    category: 'multilingual',
    notes: 'German header, English post asking for a dev partner. HIGH/MEDIUM intent.',
    rawText: li({
      name: 'Anke Schulz', headline: 'Geschäftsführerin bei Schulz Medizintechnik', location: 'Stuttgart, Deutschland', degree: '2nd', connections: '1.100+ Kontakte',
      about: ['Schulz Medizintechnik entwickelt Geräte für die ambulante Diagnostik.'],
      posts: [{ age: '3d', text: 'We are looking for a development partner to build the companion app for our new device (React Native, Node, HL7/FHIR). Start in 6 weeks. Please message me with medical-device references.' }],
      experience: [{ title: 'Geschäftsführerin', company: 'Schulz Medizintechnik', range: 'Jan 2016 - Heute · 9 Jahre 10 Monate' }],
    }),
    model: BUYER_MODEL,
    expect: { scoreRange: [55, 100], buyerIntent: ['HIGH', 'MEDIUM'], relationshipRole: ['BUYER'], currentIndustry: 'healthcare' },
  },
  {
    id: 'mixed-es-en-founder-no-intent',
    category: 'multilingual',
    notes: 'Spanish founder, English product post, no request. UNKNOWN intent; builder.',
    rawText: li({
      name: 'Pablo Serrano', headline: 'Fundador y CTO en Nubia Analytics', location: 'Barcelona, España', degree: '2nd', connections: '2.300+ contactos',
      about: ['Nubia Analytics construye paneles de datos para retailers. Stack: Next.js, Python, BigQuery.'],
      posts: [{ age: '2d', text: 'We just shipped real-time inventory alerts. 60 stores live, more coming.' }],
      experience: [{ title: 'Fundador y CTO', company: 'Nubia Analytics', range: 'Jun 2023 - Actualidad · 2 años 5 meses' }],
    }),
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.2, externalNeedProbability: 0.3, fit: 'STRONG', timing: 'CURRENT', access: 'CONNECTION' },
    expect: { buyerIntent: ['UNKNOWN'], relationshipRole: ['BUILDER', 'UNKNOWN'], qualification: ['MAYBE', 'WORTH_PURSUING'] },
  },
  {
    id: 'ar-profile-no-crash',
    category: 'multilingual',
    notes: 'Arabic profile outside deterministic coverage. Must not crash; confidence LOW; no invented intent.',
    rawText: `محمد أحمد
مدير تقنية المعلومات في شركة نيكسا للبرمجيات

حول
أقود فريق الهندسة في نيكسا. نبني منصات للرعاية الصحية.

المشاريع
- منصة إدارة المرضى
- نظام المواعيد الطبية`,
    model: { relationship: 'UNKNOWN', buyerRequestProbability: 0.3, externalNeedProbability: 0.3, fit: 'MEDIUM', timing: 'WEAK', access: 'INDIRECT' },
    expect: { buyerIntent: ['UNKNOWN'], confidence: ['LOW', 'MEDIUM'], scoreRange: [0, 50] },
  },
]
