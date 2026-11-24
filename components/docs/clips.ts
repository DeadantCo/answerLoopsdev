import clipsData from '@/lib/docs/clips.generated.json'

export interface Clip {
  /** The looping WebM, under 1 MB. */
  src: string
  /** Still image of the same size, shown until the clip is near the viewport and instead of playback. */
  poster: string
  width: number
  height: number
  title: string
  /** What the clip shows, in prose. */
  description: string
}

const CLIPS = clipsData as Record<string, Clip>

/** A clip written by `pnpm docs:clips`. Fails loudly at build time if the id is wrong. */
export function getClip(id: string): Clip {
  const clip = CLIPS[id]
  if (!clip) {
    throw new Error(
      `Unknown clip "${id}". Known clips: ${Object.keys(CLIPS).join(', ') || '(none generated yet)'}. Run pnpm docs:clips to regenerate.`,
    )
  }
  return clip
}
