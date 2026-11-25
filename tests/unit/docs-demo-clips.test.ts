import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { assertLocalAppUrl, checkLocalAppUrl } from '@/scripts/docs-demo/guard'
import {
  CLIPS,
  CLIP_FPS,
  CLIP_OUTPUT_WIDTH,
  CLIP_VIEWPORT,
  MAX_CLIP_BYTES,
  validateClips,
  type Clip,
} from '@/scripts/docs-demo/clips.manifest'
import { CRF_LADDER, ffmpegArgs, outputSize } from '@/scripts/docs-demo/clips-encode'

const root = path.resolve(__dirname, '..', '..')

function argAfter(args: string[], flag: string): string {
  return args[args.indexOf(flag) + 1]
}

describe('checkLocalAppUrl', () => {
  it.each(['http://localhost:3112', 'http://127.0.0.1:3000/', 'http://[::1]:3112', 'http://LOCALHOST:3112'])(
    'allows %s',
    (url) => {
      expect(checkLocalAppUrl(url).ok).toBe(true)
    },
  )

  it.each([
    ['', 'not set'],
    ['not a url', 'not a valid URL'],
    ['https://answerloops.com', 'not local'],
    ['http://localhost.example.net:3112', 'not local'],
    ['http://localhost@evil.example.net/', 'not local'],
    ['http://postgres:3112', 'not local'],
    ['ftp://localhost/', 'unsupported protocol'],
  ])('refuses %s', (url, reason) => {
    const result = checkLocalAppUrl(url)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(reason)
  })

  it('throws a message that names the recorder', () => {
    expect(() => assertLocalAppUrl('https://answerloops.com')).toThrow(/Refusing to record docs clips/)
    expect(() => assertLocalAppUrl('http://localhost:3112')).not.toThrow()
  })
})

describe('clip manifest', () => {
  it('is valid and starts with the review-queue and connect-a-channel clips', () => {
    expect(() => validateClips()).not.toThrow()
    expect(CLIPS.map((c) => c.id)).toEqual(['approve-draft', 'connect-channel'])
  })

  it('gives every clip a title, a text description and a single still-image step', () => {
    for (const clip of CLIPS) {
      expect(clip.title.length).toBeGreaterThan(0)
      expect(clip.description.length).toBeGreaterThanOrEqual(40)
      expect(clip.steps.filter((s) => 'poster' in s)).toHaveLength(1)
    }
  })

  const base: Clip = {
    id: 'ok-clip',
    route: '/tickets',
    waitFor: ['h1'],
    steps: [{ poster: true }],
    title: 'A clip',
    description: 'A description that is long enough to say what the clip shows.',
  }

  it.each<[string, Partial<Clip>, RegExp]>([
    ['a non-kebab id', { id: 'Bad_Id' }, /kebab-case/],
    ['a route without a slash', { route: 'tickets' }, /start with "\/"/],
    ['no description', { description: 'short' }, /text description/],
    ['no waitFor', { waitFor: [] }, /waitFor/],
    ['no still image', { steps: [{ pause: 500 }] }, /exactly one/],
    ['two still images', { steps: [{ poster: true }, { poster: true }] }, /exactly one/],
    ['a huge pause', { steps: [{ poster: true }, { pause: 60_000 }] }, /pause must be/],
  ])('rejects %s', (_name, patch, message) => {
    expect(() => validateClips([{ ...base, ...patch }])).toThrow(message)
  })

  it('rejects duplicate ids', () => {
    expect(() => validateClips([base, base])).toThrow(/duplicate clip id/)
  })
})

describe('clip encoding', () => {
  it('scales to a fixed width with an even height', () => {
    expect(outputSize(CLIP_VIEWPORT)).toEqual({ width: CLIP_OUTPUT_WIDTH, height: 450 })
    expect(outputSize({ width: 1000, height: 333 }).height % 2).toBe(0)
  })

  it('builds reproducible, silent, metadata-free ffmpeg arguments', () => {
    const args = ffmpegArgs({ input: 'in.webm', output: 'out.webm', crf: 38, startSeconds: 1.234, viewport: CLIP_VIEWPORT })
    expect(args).toContain('-an')
    expect(argAfter(args, '-vf')).toBe(`fps=${CLIP_FPS},scale=800:450:flags=lanczos`)
    expect(argAfter(args, '-ss')).toBe('1.23')
    expect(argAfter(args, '-crf')).toBe('38')
    expect(argAfter(args, '-map_metadata')).toBe('-1')
    expect(argAfter(args, '-threads')).toBe('1')
    expect(args).toContain('+bitexact')
    expect(args.at(-1)).toBe('out.webm')
  })

  it('steps quality down monotonically, within a size budget under 1 MB', () => {
    expect([...CRF_LADDER]).toEqual([...CRF_LADDER].sort((a, b) => a - b))
    expect(MAX_CLIP_BYTES).toBeLessThanOrEqual(1_000_000)
  })
})

describe('clip recorder wiring', () => {
  it('applies every local-only guard before it launches the browser', async () => {
    const source = await readFile(path.join(root, 'scripts/docs-demo/clips.ts'), 'utf8')
    const main = source.slice(source.indexOf('async function main()'))
    const launch = main.indexOf('launchBrowser(')
    expect(launch).toBeGreaterThan(-1)
    for (const guard of [
      'assertLocalEnvironment()',
      'assertLocalDatabaseUrl(process.env.DATABASE_URL)',
      'assertLocalAppUrl(BASE_URL)',
    ]) {
      expect(main.indexOf(guard), guard).toBeGreaterThan(-1)
      expect(main.indexOf(guard), guard).toBeLessThan(launch)
    }
  })

  it('exposes pnpm docs:clips', async () => {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['docs:clips']).toBe('tsx scripts/docs-demo/clips.ts')
  })

  it('keeps every generated clip under the size budget, with a still image and a description', async () => {
    const data = JSON.parse(await readFile(path.join(root, 'lib/docs/clips.generated.json'), 'utf8')) as Record<
      string,
      { src: string; poster: string; description: string }
    >
    for (const [id, clip] of Object.entries(data)) {
      expect(clip.description.length, id).toBeGreaterThan(0)
      expect((await stat(path.join(root, 'public', clip.src))).size, id).toBeLessThan(MAX_CLIP_BYTES)
      await stat(path.join(root, 'public', clip.poster))
    }
  })
})
