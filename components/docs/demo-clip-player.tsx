'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play } from 'lucide-react'

// Start fetching shortly before the clip scrolls into view, so it is already
// playing when the reader gets there.
const NEAR_VIEWPORT_MARGIN = '200px'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function getReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getObserverUnsupported(): boolean {
  return typeof IntersectionObserver === 'undefined'
}

function subscribeNever(): () => void {
  return () => undefined
}

/**
 * Plays a clip muted, looped and inline. Until the clip is near the viewport
 * the page loads only the still image; for readers who prefer reduced motion it
 * stays on the still image until they press play.
 */
export function DemoClipPlayer({
  src,
  poster,
  width,
  height,
  title,
  description,
}: {
  src: string
  poster: string
  width: number
  height: number
  title: string
  description: string
}) {
  const descriptionId = useId()
  const figureRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [observedNear, setObservedNear] = useState(false)
  // null until the reader presses the button (or the browser blocks playback); then that choice wins.
  const [userPlay, setUserPlay] = useState<boolean | null>(null)
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false)
  const observerUnsupported = useSyncExternalStore(subscribeNever, getObserverUnsupported, () => false)
  const near = observedNear || observerUnsupported

  useEffect(() => {
    const figure = figureRef.current
    if (!figure || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setObservedNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    )
    observer.observe(figure)
    return () => observer.disconnect()
  }, [])

  const playing = near && (userPlay ?? !reducedMotion)
  // Showing only the still because the reader asked for less motion or paused it: offer play.
  const waiting = !playing && (userPlay === false || (userPlay === null && reducedMotion))
  // Once the file has been requested keep it attached, so pausing holds the frame.
  const attached = near && (userPlay !== null || !reducedMotion)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      const result = video.play?.()
      if (result && typeof result.catch === 'function') result.catch(() => setUserPlay(false))
    } else {
      video.pause?.()
    }
  }, [playing])

  const toggle = () => {
    setObservedNear(true)
    setUserPlay(!playing)
  }

  return (
    <figure ref={figureRef} className="not-prose my-8">
      <div className="relative overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-md">
        <div className="flex items-center gap-1.5 border-b border-fd-border bg-fd-muted px-3 py-2" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
        </div>
        <div className="relative">
          <video
            ref={videoRef}
            src={attached ? src : undefined}
            poster={poster}
            width={width}
            height={height}
            muted
            loop
            playsInline
            preload="none"
            aria-label={title}
            aria-describedby={descriptionId}
            className="block h-auto w-full"
          />
          {(playing || waiting) && (
            <button
              type="button"
              onClick={toggle}
              aria-label={`${playing ? 'Pause' : 'Play'} clip: ${title}`}
              className={
                playing
                  ? 'absolute bottom-3 right-3 inline-flex size-9 items-center justify-center rounded-full bg-fd-background/90 text-fd-foreground shadow ring-1 ring-fd-border transition-opacity hover:bg-fd-background focus-visible:opacity-100 sm:opacity-60 sm:hover:opacity-100'
                  : 'absolute inset-0 m-auto inline-flex size-14 items-center justify-center rounded-full bg-fd-background/90 text-fd-foreground shadow-lg ring-1 ring-fd-border hover:bg-fd-background'
              }
            >
              {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-6" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
      <figcaption id={descriptionId} className="mt-2 text-center text-sm text-fd-muted-foreground">
        {description}
      </figcaption>
    </figure>
  )
}
