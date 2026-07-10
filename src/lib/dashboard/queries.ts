import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from './types'

type DB = any

/**
 * Metric cards
 */
export async function loadMetrics(db: DB): Promise<MetricsBundle> {
  const res = await fetch('/api/dashboard?type=metrics')
  if (!res.ok) {
    throw new Error(`Failed to load metrics: ${res.status}`)
  }
  return await res.json()
}

/**
 * Conversations over time
 */
export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const res = await fetch(`/api/dashboard?type=series&range=${rangeDays}`)
  if (!res.ok) {
    throw new Error(`Failed to load series: ${res.status}`)
  }
  return await res.json()
}

/**
 * Pipeline donut
 */
export async function loadPipelineDonut(db: DB): Promise<PipelineDonutData> {
  const res = await fetch('/api/dashboard?type=donut')
  if (!res.ok) {
    throw new Error(`Failed to load donut: ${res.status}`)
  }
  return await res.json()
}

/**
 * Response time by day of week
 */
export async function loadResponseTime(db: DB): Promise<ResponseTimeSummary> {
  const res = await fetch('/api/dashboard?type=response')
  if (!res.ok) {
    throw new Error(`Failed to load response time: ${res.status}`)
  }
  return await res.json()
}

/**
 * Activity feed
 */
export async function loadActivity(db: DB, limit = 20): Promise<ActivityItem[]> {
  const res = await fetch(`/api/dashboard?type=activity&limit=${limit}`)
  if (!res.ok) {
    throw new Error(`Failed to load activity feed: ${res.status}`)
  }
  return await res.json()
}
