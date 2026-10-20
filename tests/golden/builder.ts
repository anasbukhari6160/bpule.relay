/**
 * Deterministic LinkedIn-paste builder for golden fixtures. Produces the
 * same text every run, in the shape a rep's paste has (header chrome,
 * About, Activity with relative ages, Experience with date ranges).
 */

export interface PostSpec { age: string; text: string }
export interface ExperienceSpec { title: string; company: string; range: string; desc?: string[]; location?: string }

export interface ProfileSpec {
  name: string
  headline: string
  location?: string
  degree?: '1st' | '2nd' | '3rd'
  connections?: string
  message?: boolean
  mutual?: string
  about?: string[]
  posts?: PostSpec[]
  experience?: ExperienceSpec[]
  education?: string[]
  skills?: string[]
  url?: string
  extra?: string[]
}

export function li(p: ProfileSpec): string {
  const out: string[] = []
  out.push(p.name)
  out.push(p.headline)
  if (p.location) out.push(`${p.location} · Contact info`)
  if (p.degree) out.push(`· ${p.degree}`)
  if (p.connections) out.push(p.connections)
  if (p.mutual) out.push(p.mutual)
  if (p.message !== false) out.push('Message')
  out.push(p.degree === '1st' ? 'More' : 'Connect')
  if (p.url) out.push(p.url)
  out.push('')
  if (p.about && p.about.length > 0) {
    out.push('About')
    out.push(...p.about)
    out.push('')
  }
  if (p.posts && p.posts.length > 0) {
    out.push('Activity')
    for (const post of p.posts) {
      out.push(`${p.name} posted this • ${post.age}`)
      out.push(`${post.age} •`)
      out.push(post.text)
      out.push('')
    }
  }
  if (p.experience && p.experience.length > 0) {
    out.push('Experience')
    for (const e of p.experience) {
      out.push(e.title)
      out.push(`${e.company} · Full-time`)
      out.push(e.range)
      if (e.location) out.push(e.location)
      if (e.desc) out.push(...e.desc)
      out.push('')
    }
  }
  if (p.education && p.education.length > 0) {
    out.push('Education')
    out.push(...p.education)
    out.push('')
  }
  if (p.skills && p.skills.length > 0) {
    out.push('Skills')
    out.push(p.skills.join(' · '))
  }
  if (p.extra) out.push(...p.extra)
  return out.join('\n')
}
