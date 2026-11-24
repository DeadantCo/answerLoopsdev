import type { SourcePlatform } from '@/types'

const LABELS: Record<SourcePlatform, string> = {
  discord: 'Discord',
  slack: 'Slack',
  google_chat: 'Google Chat',
  telegram: 'Telegram',
  email: 'Email',
  github: 'GitHub',
  discourse: 'Discourse',
  circle: 'Circle',
  mcp: 'Agent',
}

/** Every channel a ticket can come from, in the order the filter lists them. */
export const SOURCE_PLATFORMS = Object.keys(LABELS) as SourcePlatform[]

/** The channel a query-string value names, or undefined for anything unknown. */
export function parseSourcePlatform(value: string | null | undefined): SourcePlatform | undefined {
  return SOURCE_PLATFORMS.find((platform) => platform === value)
}

/** Customer-facing name of a ticket's source channel. */
export function platformLabel(platform: string | null | undefined): string {
  return (LABELS as Record<string, string>)[platform ?? 'discord'] ?? platform ?? 'Discord'
}
