const SKILL_ALIASES: Record<string, string> = {
  'react': 'React',
  'reactjs': 'React',
  'react.js': 'React',
  'node': 'Node.js',
  'nodejs': 'Node.js',
  'node.js': 'Node.js',
  'typescript': 'TypeScript',
  'ts': 'TypeScript',
  'javascript': 'JavaScript',
  'js': 'JavaScript',
  'python': 'Python',
  'nextjs': 'Next.js',
  'next.js': 'Next.js',
  'postgresql': 'PostgreSQL',
  'postgres': 'PostgreSQL',
  'mongodb': 'MongoDB',
  'mysql': 'MySQL',
  'redis': 'Redis',
  'aws': 'AWS',
  'gcp': 'Google Cloud',
  'google cloud platform': 'Google Cloud',
  'azure': 'Azure',
  'docker': 'Docker',
  'kubernetes': 'Kubernetes',
  'k8s': 'Kubernetes',
  'terraform': 'Terraform',
  'ci/cd': 'CI/CD',
  'ci cd': 'CI/CD',
  'rest': 'REST APIs',
  'rest api': 'REST APIs',
  'restful': 'REST APIs',
  'graphql': 'GraphQL',
  'machine learning': 'Machine Learning',
  'ml': 'Machine Learning',
  'ai': 'AI',
  'artificial intelligence': 'AI',
  'devops': 'DevOps',
  'agile': 'Agile',
  'scrum': 'Scrum',
  'figma': 'Figma',
  'tailwind': 'Tailwind CSS',
  'tailwindcss': 'Tailwind CSS',
  'css': 'CSS',
  'html': 'HTML',
  'sass': 'Sass',
  'less': 'Less',
  'webpack': 'Webpack',
  'vite': 'Vite',
  'jest': 'Jest',
  'cypress': 'Cypress',
  'playwright': 'Playwright',
  'vitest': 'Vitest',
  'rails': 'Ruby on Rails',
  'ruby on rails': 'Ruby on Rails',
  'django': 'Django',
  'flask': 'Flask',
  'fastapi': 'FastAPI',
  'spring': 'Spring Boot',
  'spring boot': 'Spring Boot',
  'laravel': 'Laravel',
  'php': 'PHP',
  'go': 'Go',
  'golang': 'Go',
  'rust': 'Rust',
  'swift': 'Swift',
  'kotlin': 'Kotlin',
  'flutter': 'Flutter',
  'react native': 'React Native',
  'firebase': 'Firebase',
  'supabase': 'Supabase',
  'prisma': 'Prisma',
  'drizzle': 'Drizzle ORM',
  'sql': 'SQL',
  'nosql': 'NoSQL',
  'oauth': 'OAuth',
  'jwt': 'JWT',
  'grpc': 'gRPC',
  'microservices': 'Microservices',
  'monorepo': 'Monorepo',
  'tdd': 'TDD',
  'bdd': 'BDD',
  'system design': 'System Design',
  'architecture': 'Software Architecture',
  'data engineering': 'Data Engineering',
  'etl': 'ETL',
  'data pipeline': 'Data Pipelines',
  'pipelines': 'Data Pipelines',
}

export function normalizeSkill(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  const lower = raw.toLowerCase().trim()
  if (SKILL_ALIASES[lower]) return SKILL_ALIASES[lower]
  return titleCase(raw.trim())
}

export function normalizeSkills(raw: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'string') continue
    const norm = normalizeSkill(s)
    const key = norm.toLowerCase()
    if (!seen.has(key) && norm.length > 1) {
      seen.add(key)
      result.push(norm)
    }
  }
  return result
}

export function mergeSkillLists(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.filter((s) => typeof s === 'string').map((s) => s.toLowerCase()))
  const result = [...existing]
  for (const s of incoming) {
    if (!s || typeof s !== 'string') continue
    const norm = normalizeSkill(s)
    if (!seen.has(norm.toLowerCase())) {
      seen.add(norm.toLowerCase())
      result.push(norm)
    }
  }
  return result
}

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase()
      if (SKILL_ALIASES[lower]) return SKILL_ALIASES[lower]
      if (word.length <= 3 && /^[a-z]+$/.test(lower)) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function extractYearsExperience(text: string): number | null {
  const patterns = [
    /(\d+)\+?\s*years?\s*(of\s*)?experience/i,
    /experience[:\s]*(\d+)\+?\s*years?/i,
    /(\d+)\+?\s*yrs?\s*(of\s*)?(exp|experience)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const years = parseInt(match[1], 10)
      if (years >= 0 && years <= 50) return years
    }
  }
  return null
}

export function inferSeniority(yearsExp: number | null, title: string | null): string | null {
  if (yearsExp !== null) {
    if (yearsExp <= 2) return 'junior'
    if (yearsExp <= 5) return 'mid'
    if (yearsExp <= 8) return 'senior'
    if (yearsExp <= 12) return 'lead'
    return 'principal'
  }
  if (title) {
    const lower = title.toLowerCase()
    if (/chief|cto|ceo|cxo|vp|director|head of|partner/.test(lower)) return 'executive'
    if (/principal|staff|distinguished|fellow/.test(lower)) return 'principal'
    if (/lead|senior|sr\.?/.test(lower)) return 'lead'
    if (/junior|jr\.?|intern|graduate|trainee/.test(lower)) return 'junior'
    if (/mid|intermediate/.test(lower)) return 'mid'
  }
  return null
}
