// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DemoClip } from '@/components/docs/demo-clip'
import { DemoClipPlayer } from '@/components/docs/demo-clip-player'

vi.mock('@/components/docs/clips', () => ({
  getClip: (id: string) => {
    if (id !== 'demo') throw new Error(`Unknown clip "${id}"`)
    return {
      src: '/docs/clips/demo.webm',
      poster: '/docs/clips/demo.webp',
      width: 800,
      height: 450,
      title: 'Approving a draft',
      description: 'A reviewer approves the drafted answer and it is marked Approved.',
    }
  },
}))

let reducedMotion = false
let observers: Array<{
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  disconnect: ReturnType<typeof vi.fn>
}>
let play: ReturnType<typeof vi.fn>
let pause: ReturnType<typeof vi.fn>

function scrollNearViewport() {
  act(() => {
    for (const observer of observers) {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
}

beforeEach(() => {
  reducedMotion = false
  observers = []
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  HTMLMediaElement.prototype.play = play as unknown as () => Promise<void>
  HTMLMediaElement.prototype.pause = pause as unknown as () => void
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') && reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn()
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, disconnect: this.disconnect })
      }
      observe() {}
      unobserve() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function video(container: HTMLElement): HTMLVideoElement {
  const el = container.querySelector('video')
  if (!el) throw new Error('no video element')
  return el
}

describe('DemoClip', () => {
  it('takes the still image, size and description from the generated clip data', () => {
    const { container } = render(<DemoClip clip="demo" />)
    expect(video(container)).toHaveAttribute('poster', '/docs/clips/demo.webp')
    expect(video(container)).toHaveAttribute('width', '800')
    expect(video(container)).toHaveAttribute('height', '450')
    expect(screen.getByText('A reviewer approves the drafted answer and it is marked Approved.').tagName).toBe('FIGCAPTION')
  })

  it('lets a page override the description', () => {
    render(<DemoClip clip="demo" description="Just the approve step" />)
    expect(screen.getByText('Just the approve step').tagName).toBe('FIGCAPTION')
  })

  it('fails loudly for an unknown clip id', () => {
    expect(() => render(<DemoClip clip="nope" />)).toThrow(/Unknown clip "nope"/)
  })
})

describe('DemoClipPlayer', () => {
  const props = {
    src: '/docs/clips/demo.webm',
    poster: '/docs/clips/demo.webp',
    width: 800,
    height: 450,
    title: 'Approving a draft',
    description: 'A reviewer approves the drafted answer.',
  }

  it('is muted, looped and inline, and is described by its text description', () => {
    const { container } = render(<DemoClipPlayer {...props} />)
    const el = video(container)
    expect(el.muted).toBe(true)
    expect(el).toHaveAttribute('loop')
    expect(el).toHaveAttribute('playsinline')
    expect(el).toHaveAttribute('preload', 'none')
    expect(el).toHaveAttribute('aria-label', 'Approving a draft')
    const description = screen.getByText('A reviewer approves the drafted answer.')
    expect(el.getAttribute('aria-describedby')).toBe(description.id)
  })

  it('loads no video until the clip is near the viewport', () => {
    const { container } = render(<DemoClipPlayer {...props} />)
    expect(video(container)).not.toHaveAttribute('src')
    expect(play).not.toHaveBeenCalled()
    expect(observers[0].options?.rootMargin).toBe('200px')

    scrollNearViewport()
    expect(video(container)).toHaveAttribute('src', '/docs/clips/demo.webm')
    expect(play).toHaveBeenCalledTimes(1)
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('shows a pause button while playing and holds the frame when paused', () => {
    const { container } = render(<DemoClipPlayer {...props} />)
    scrollNearViewport()
    fireEvent.click(screen.getByRole('button', { name: 'Pause clip: Approving a draft' }))
    expect(pause).toHaveBeenCalled()
    expect(video(container)).toHaveAttribute('src', '/docs/clips/demo.webm')
    expect(screen.getByRole('button', { name: 'Play clip: Approving a draft' })).toBeInTheDocument()
  })

  it('does not autoplay for readers who prefer reduced motion, and plays on request', () => {
    reducedMotion = true
    const { container } = render(<DemoClipPlayer {...props} />)
    scrollNearViewport()
    expect(video(container)).not.toHaveAttribute('src')
    expect(play).not.toHaveBeenCalled()
    expect(video(container)).toHaveAttribute('poster', '/docs/clips/demo.webp')

    fireEvent.click(screen.getByRole('button', { name: 'Play clip: Approving a draft' }))
    expect(video(container)).toHaveAttribute('src', '/docs/clips/demo.webm')
    expect(play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Pause clip: Approving a draft' })).toBeInTheDocument()
  })

  it('offers play again if the browser blocks playback', async () => {
    play.mockRejectedValue(new Error('NotAllowedError'))
    render(<DemoClipPlayer {...props} />)
    scrollNearViewport()
    expect(await screen.findByRole('button', { name: 'Play clip: Approving a draft' })).toBeInTheDocument()
  })

  it('starts loading when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { container } = render(<DemoClipPlayer {...props} />)
    expect(video(container)).toHaveAttribute('src', '/docs/clips/demo.webm')
  })
})
