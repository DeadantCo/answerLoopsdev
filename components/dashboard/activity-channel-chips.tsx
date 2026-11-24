import Link from 'next/link'
import { platformLabel } from '@/lib/tickets/platform-label'
import type { SourcePlatform } from '@/types'

export interface ActivityChannelCount {
  platform: SourcePlatform
  count: number
}

export const MAX_CHANNEL_CHIPS = 4

const ACTIVITY_HREF = '/tickets?newActivity=1&sort=activity'

const chipClass =
  'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-h-8'

function Chip({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <li className="max-w-full">
      <Link
        href={href}
        prefetch={false}
        aria-label={`${label}, ${count} ${count === 1 ? 'ticket' : 'tickets'} with new replies`}
        className={chipClass}
      >
        <span className="break-words">{label}</span>
        <span className="font-semibold text-blue-700">{count > 99 ? '99+' : count}</span>
      </Link>
    </li>
  )
}

/**
 * Where the unseen replies come from, largest channel first. Hidden when one
 * channel holds them all, since a single chip would only repeat the total.
 * Past the cap, the last slot sums the remaining channels into "Other" and
 * links to the unfiltered list.
 */
export function ActivityChannelChips({ channels }: { channels: ActivityChannelCount[] }) {
  const present = channels.filter((channel) => channel.count > 0)
  if (present.length < 2) return null
  const overflow = present.length > MAX_CHANNEL_CHIPS
  const shown = overflow ? present.slice(0, MAX_CHANNEL_CHIPS - 1) : present
  const otherCount = overflow
    ? present.slice(MAX_CHANNEL_CHIPS - 1).reduce((sum, channel) => sum + channel.count, 0)
    : 0
  return (
    <ul aria-label="New replies by channel" className="mt-2 flex flex-wrap gap-2">
      {shown.map(({ platform, count }) => (
        <Chip key={platform} href={`${ACTIVITY_HREF}&platform=${platform}`} label={platformLabel(platform)} count={count} />
      ))}
      {overflow && <Chip href={ACTIVITY_HREF} label="Other" count={otherCount} />}
    </ul>
  )
}
