import { getClip } from './clips'
import { DemoClipPlayer } from './demo-clip-player'

/**
 * A short looping clip of a flow in the product, recorded from the demo
 * workspace. `clip` is an id from lib/docs/clips.generated.json; the files, the
 * size, the title and the text description all come from there, so a
 * re-recording updates every page.
 */
export function DemoClip({
  clip,
  description,
}: {
  clip: string
  /** Overrides the generated description when a page uses the clip for a narrower point. */
  description?: string
}) {
  const data = getClip(clip)
  return (
    <DemoClipPlayer
      src={data.src}
      poster={data.poster}
      width={data.width}
      height={data.height}
      title={data.title}
      description={description ?? data.description}
    />
  )
}
