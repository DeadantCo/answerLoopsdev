/**
 * Short looping documentation clips of scripted flows in the real app, recorded
 * against the seeded demo workspace by `pnpm docs:clips` (see clips.ts and
 * README.md, "Clips").
 *
 * A clip is a route plus a handful of steps. The recorder refuses to finish if
 * a step cannot run, if anything non-fictional is on screen after any step, or
 * if the encoded file does not fit the size budget, so a UI refactor or a
 * changed seed is caught instead of producing a broken or unsafe clip.
 */

import type { TextMaskRule, ViewportSize } from './shots.manifest'

/** One scripted step. Keep clips to a few steps: they are meant to be skimmed. */
export type ClipStep =
  | { click: string }
  | { waitFor: string }
  /** Hold still for a moment so the viewer can read the screen. */
  | { pause: number }
  /** Use the screen as it is at this step as the still image. Exactly one per clip. */
  | { poster: true }

export interface Clip {
  /** kebab-case; becomes public/docs/clips/<id>.webm, <id>.webp and the JSON key */
  id: string
  route: string
  /** Defaults to CLIP_VIEWPORT. */
  viewport?: ViewportSize
  /** Selectors that must be visible before recording starts. */
  waitFor: string[]
  steps: ClipStep[]
  /** Short title, used as the accessible name of the clip. */
  title: string
  /** What the clip shows, in prose. Shown under the clip and read by screen readers. */
  description: string
  /** Extra text rules for this clip, on top of DEFAULT_TEXT_MASKS. */
  textMask?: TextMaskRule[]
}

export const CLIP_VIEWPORT: ViewportSize = { width: 1280, height: 720 }

/** Width of the encoded clip and its still image, in pixels. */
export const CLIP_OUTPUT_WIDTH = 800
export const CLIP_FPS = 12
export const MAX_CLIP_BYTES = 1_000_000
/** Clips longer than this are no longer "short". */
export const MAX_CLIP_SECONDS = 20

/** Pause inserted after every step so each change is on screen long enough to read. */
export const STEP_SETTLE_MS = 900
export const MAX_PAUSE_MS = 5_000

export const CLIPS: Clip[] = [
  {
    id: 'approve-draft',
    // The seeded ticket "Scout-L2 wiring diagram" has a low-confidence draft waiting for a person.
    route: '/tickets/73',
    waitFor: ['h1:has-text("Scout-L2 wiring diagram")', 'text=AI needs review', 'button:text-is("Approve")'],
    steps: [
      { pause: 1800 },
      { poster: true },
      { click: 'button:text-is("Approve")' },
      { waitFor: 'span:text-is("Approved")' },
      { pause: 2200 },
    ],
    title: 'Approving an AI draft',
    description:
      'A ticket flagged "AI needs review" is open with its drafted answer and a low confidence score. The reviewer reads the draft, selects Approve, and the draft is marked Approved.',
  },
  {
    id: 'connect-channel',
    route: '/integrations?tab=discord',
    // Nothing is submitted: the clip shows where each channel is connected, using the seeded workspace.
    waitFor: ['h1:has-text("Integrations")', 'text=Add answerLoops to Discord'],
    steps: [
      { pause: 1800 },
      { poster: true },
      { click: '.dashboard-tabs button:text-is("Telegram")' },
      { waitFor: 'button:text-is("Edit")' },
      { pause: 1500 },
      { click: 'button:text-is("Edit")' },
      { waitFor: 'input[type="password"]' },
      { pause: 2500 },
    ],
    title: 'Connecting a channel',
    description:
      'On the Integrations page there is one tab for each channel. The Discord tab offers one-click setup. Opening the Telegram tab and selecting Edit shows the connection form, which asks for a bot token and the chats to monitor.',
  },
]

export function validateClips(clips: Clip[] = CLIPS): void {
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/
  const seen = new Set<string>()
  for (const clip of clips) {
    if (!kebab.test(clip.id)) throw new Error(`clip id is not kebab-case: ${clip.id}`)
    if (seen.has(clip.id)) throw new Error(`duplicate clip id: ${clip.id}`)
    seen.add(clip.id)
    if (!clip.route.startsWith('/')) throw new Error(`[${clip.id}] route must start with "/": ${clip.route}`)
    if (!clip.title.trim()) throw new Error(`[${clip.id}] a clip needs a title`)
    if (clip.description.trim().length < 40) {
      throw new Error(`[${clip.id}] a clip needs a text description of what it shows (at least 40 characters)`)
    }
    if (clip.waitFor.length === 0) throw new Error(`[${clip.id}] waitFor needs at least one selector`)
    if (clip.steps.length === 0) throw new Error(`[${clip.id}] a clip needs at least one step`)
    const posters = clip.steps.filter((step) => 'poster' in step).length
    if (posters !== 1) throw new Error(`[${clip.id}] a clip needs exactly one { poster: true } step (found ${posters})`)
    for (const step of clip.steps) {
      if ('pause' in step && !(step.pause > 0 && step.pause <= MAX_PAUSE_MS)) {
        throw new Error(`[${clip.id}] pause must be between 1 and ${MAX_PAUSE_MS} ms`)
      }
    }
  }
}
