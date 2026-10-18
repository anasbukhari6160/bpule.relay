import type { ObjectionCategory, ObjectionRecord } from './reply-intelligence'

export interface ObjectionSummary {
  category: ObjectionCategory
  count: number
  resolved: number
  sampleLeads: string[]
}

export interface ObjectionInsight {
  type: 'pattern' | 'resolution' | 'warning'
  title: string
  detail: string
  count?: number
}

/**
 * Aggregate objection records into summaries.
 * Pure function — no I/O.
 */
export function summarizeObjections(records: ObjectionRecord[]): ObjectionSummary[] {
  const byCategory = new Map<ObjectionCategory, ObjectionRecord[]>()

  for (const record of records) {
    const arr = byCategory.get(record.category) ?? []
    arr.push(record)
    byCategory.set(record.category, arr)
  }

  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      count: items.length,
      resolved: items.filter(r => r.resolved).length,
      sampleLeads: [...new Set(items.map(r => r.leadId))].slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Generate insights from objection patterns.
 */
export function generateObjectionInsights(records: ObjectionRecord[]): ObjectionInsight[] {
  const insights: ObjectionInsight[] = []
  const summaries = summarizeObjections(records)

  for (const summary of summaries) {
    if (summary.count >= 3) {
      insights.push({
        type: 'pattern',
        title: `Common ${summary.category.toLowerCase()} objections`,
        detail: `${summary.count} prospects raised ${summary.category.toLowerCase()} concerns`,
        count: summary.count,
      })
    }
    if (summary.count > 0 && summary.resolved / summary.count > 0.5) {
      insights.push({
        type: 'resolution',
        title: `${summary.category} objections resolving well`,
        detail: `${summary.resolved}/${summary.count} resolved — proof/sender working`,
        count: summary.resolved,
      })
    }
    if (summary.count > 5 && summary.resolved / summary.count < 0.2) {
      insights.push({
        type: 'warning',
        title: `${summary.category} objections not resolving`,
        detail: `Only ${summary.resolved}/${summary.count} resolved — review messaging`,
        count: summary.resolved,
      })
    }
  }

  return insights
}
