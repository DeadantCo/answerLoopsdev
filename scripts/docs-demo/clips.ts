/**
 * Records short looping documentation clips of scripted flows in the real app,
 * running against the seeded demo workspace, and writes a manifest for the
 * DemoClip docs component.
 *
 * Usage (app and database running as described in README.md):
 *   pnpm docs:clips                       all clips
 *   pnpm docs:clips approve-draft         only these clip ids
 *
 * Environment:
 *   DATABASE_URL    must point at the local demo database (the clips click
 *                   through the app, e.g. approving a draft, which writes to it)
 *   DOCS_BASE_URL   defaults to http://localhost:3112, and must be a local URL
 *   FFMPEG_PATH     ffmpeg with the libvpx-vp9 encoder; defaults to `ffmpeg` on PATH
 *
 * Outputs:
 *   public/docs/clips/<id>.webm   muted, under 1 MB
 *   public/docs/clips/<id>.webp   the still image shown before and instead of playback
 *   lib/docs/clips.generated.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { assertLocalAppUrl, assertLocalDatabaseUrl, assertLocalEnvironment } from './guard'
import { applyMasks, assertSafe, launchBrowser, pageStyles } from './page-safety'
import { DEFAULT_TEXT_MASKS, type TextMaskRule } from './shots.manifest'
import {
  CLIPS,
  CLIP_VIEWPORT,
  MAX_CLIP_BYTES,
  MAX_CLIP_SECONDS,
  STEP_SETTLE_MS,
  validateClips,
  type Clip,
} from './clips.manifest'
import { CRF_LADDER, ffmpegArgs, outputSize } from './clips-encode'

const ROOT = path.resolve(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'public', 'docs', 'clips')
const JSON_PATH = path.join(ROOT, 'lib', 'docs', 'clips.generated.json')
const RAW_DIR = path.join(__dirname, '.tmp', 'clips-raw')
const STORAGE_STATE_PATH = path.join(__dirname, '.tmp', 'storage-state.json') // written by session.ts
const BASE_URL = (process.env.DOCS_BASE_URL ?? 'http://localhost:3112').replace(/\/$/, '')
const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'

const NAV_TIMEOUT_MS = 120_000
const SELECTOR_TIMEOUT_MS = 20_000
const POSTER_QUALITY = 80

// `sharp` ships with Next.js but is not a direct dependency; see capture.ts.
interface SharpImage {
  resize(options: { width: number; height: number }): SharpImage
  webp(options: { quality: number; effort: number }): SharpImage
  toBuffer(): Promise<Buffer>
}
type Sharp = (input: Buffer) => SharpImage

function loadSharp(): Sharp {
  const fromNext = createRequire(require.resolve('next/package.json'))
  return fromNext('sharp') as Sharp
}

interface ClipOut {
  src: string
  poster: string
  width: number
  height: number
  title: string
  description: string
}

function requireFfmpeg(): void {
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `ffmpeg not found (tried "${FFMPEG}"). Install ffmpeg, or set FFMPEG_PATH to a build with the libvpx-vp9 encoder.`,
    )
  }
  if (!probe.stdout.includes('libvpx-vp9')) {
    throw new Error(`"${FFMPEG}" has no libvpx-vp9 encoder. Install a full ffmpeg build, or set FFMPEG_PATH to one.`)
  }
}

// Frames are recorded continuously, so masking after a step would leave a
// frame with the real text. This rewrites text as the page renders, and draws
// a cursor dot because recorded video does not include the mouse pointer.
async function installRecordingHelpers(page: Page, rules: TextMaskRule[]): Promise<void> {
  await page.addInitScript((list: TextMaskRule[]) => {
    const maskTree = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (walker.nextNode()) nodes.push(walker.currentNode as Text)
      for (const node of nodes) {
        let value = node.nodeValue ?? ''
        for (const { pattern, replacement } of list) value = value.replace(pattern, replacement)
        if (value !== node.nodeValue) node.nodeValue = value
      }
    }
    window.addEventListener('DOMContentLoaded', () => {
      maskTree(document.body)
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') maskTree(record.target.parentNode ?? document.body)
          for (const added of Array.from(record.addedNodes)) maskTree(added)
        }
      }).observe(document.body, { childList: true, characterData: true, subtree: true })

      const dot = document.createElement('div')
      dot.setAttribute('aria-hidden', 'true')
      dot.style.cssText =
        'position:fixed;z-index:2147483647;pointer-events:none;width:18px;height:18px;margin:-9px 0 0 -9px;' +
        'border-radius:9999px;background:rgba(225,29,72,.35);border:2px solid #e11d48;display:none;'
      document.body.appendChild(dot)
      window.addEventListener(
        'mousemove',
        (event) => {
          dot.style.display = 'block'
          dot.style.left = `${event.clientX}px`
          dot.style.top = `${event.clientY}px`
        },
        true,
      )
    })
  }, rules)
}

async function recordClip(browser: Browser, clip: Clip, sharp: Sharp): Promise<ClipOut> {
  const viewport = clip.viewport ?? CLIP_VIEWPORT
  const rawDir = path.join(RAW_DIR, clip.id)
  fs.rmSync(rawDir, { recursive: true, force: true })
  fs.mkdirSync(rawDir, { recursive: true })

  const rules = [...DEFAULT_TEXT_MASKS, ...(clip.textMask ?? [])]
  const recordingStart = Date.now()
  const context: BrowserContext = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    recordVideo: { dir: rawDir, size: viewport },
  })

  let posterPng: Buffer | null = null
  let startSeconds = 0
  let endSeconds = 0
  let rawVideo = ''
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(SELECTOR_TIMEOUT_MS)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().split('\n')[0].slice(0, 200))
    })
    page.on('pageerror', (e) => consoleErrors.push(`uncaught: ${e.message.slice(0, 200)}`))
    await installRecordingHelpers(page, rules)

    const response = await page.goto(`${BASE_URL}${clip.route}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS })
    const status = response?.status() ?? 0
    if (status === 404) throw new Error(`[${clip.id}] ${clip.route} returned 404`)
    if (status >= 400) throw new Error(`[${clip.id}] ${clip.route} returned HTTP ${status}`)
    if (new URL(page.url()).pathname.startsWith('/login')) {
      throw new Error(`[${clip.id}] redirected to /login: the session is missing or expired. Run \`pnpm docs:session\` again.`)
    }

    await page.addStyleTag({ content: pageStyles() })
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('button')) as HTMLElement[]) {
        if (getComputedStyle(el).position === 'fixed' && /feedback/i.test(el.textContent ?? '')) el.style.display = 'none'
      }
    })
    for (const selector of clip.waitFor) await page.locator(selector).first().waitFor({ state: 'visible' })
    await page.evaluate(() => document.fonts.ready)
    await applyMasks(page, [], rules)
    await assertSafe(page, clip.id)
    if ((await page.locator('[class*="animate-pulse"], [aria-busy="true"]').count()) > 0) {
      throw new Error(`[${clip.id}] loading skeletons still on screen`)
    }

    // Everything before this point is page loading; the clip starts here.
    startSeconds = (Date.now() - recordingStart) / 1000
    await page.waitForTimeout(STEP_SETTLE_MS)

    for (const step of clip.steps) {
      if ('click' in step) await page.locator(step.click).first().click()
      else if ('waitFor' in step) await page.locator(step.waitFor).first().waitFor({ state: 'visible', timeout: 60_000 })
      else if ('pause' in step) await page.waitForTimeout(step.pause)
      else posterPng = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', fullPage: false })

      await page.waitForLoadState('networkidle')
      await applyMasks(page, [], rules)
      await assertSafe(page, clip.id)
      await page.waitForTimeout(STEP_SETTLE_MS)
    }
    endSeconds = (Date.now() - recordingStart) / 1000

    if (consoleErrors.length) {
      throw new Error(`[${clip.id}] console errors on ${clip.route}:\n  ${consoleErrors.join('\n  ')}`)
    }
    const video = page.video()
    if (!video) throw new Error(`[${clip.id}] the browser did not record a video`)
    await context.close()
    rawVideo = await video.path()
  } finally {
    await context.close().catch(() => undefined)
  }

  if (!posterPng) throw new Error(`[${clip.id}] no still image was captured`)
  const durationSeconds = endSeconds - startSeconds
  if (durationSeconds > MAX_CLIP_SECONDS) {
    throw new Error(`[${clip.id}] the clip runs ${durationSeconds.toFixed(1)}s; keep clips under ${MAX_CLIP_SECONDS}s`)
  }

  const size = outputSize(viewport)
  const encoded = path.join(rawDir, `${clip.id}.webm`)
  let bytes = Infinity
  for (const crf of CRF_LADDER) {
    const run = spawnSync(FFMPEG, ffmpegArgs({ input: rawVideo, output: encoded, crf, startSeconds, viewport }), { encoding: 'utf8' })
    if (run.status !== 0) throw new Error(`[${clip.id}] ffmpeg failed:\n${run.stderr.split('\n').slice(0, 5).join('\n')}`)
    bytes = fs.statSync(encoded).size
    if (bytes < MAX_CLIP_BYTES) break
  }
  if (bytes >= MAX_CLIP_BYTES) {
    throw new Error(`[${clip.id}] the encoded clip is ${(bytes / 1024).toFixed(0)} KB at the lowest quality; shorten the clip or reduce the motion`)
  }

  const poster = await sharp(posterPng)
    .resize({ width: size.width, height: size.height })
    .webp({ quality: POSTER_QUALITY, effort: 6 })
    .toBuffer()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.copyFileSync(encoded, path.join(OUT_DIR, `${clip.id}.webm`))
  fs.writeFileSync(path.join(OUT_DIR, `${clip.id}.webp`), poster)

  console.log(`[docs-clips] ${clip.id}: ${size.width}x${size.height}, ${durationSeconds.toFixed(1)}s, ${(bytes / 1024).toFixed(0)} KB`)
  return {
    src: `/docs/clips/${clip.id}.webm`,
    poster: `/docs/clips/${clip.id}.webp`,
    width: size.width,
    height: size.height,
    title: clip.title,
    description: clip.description,
  }
}

async function main() {
  assertLocalEnvironment()
  assertLocalDatabaseUrl(process.env.DATABASE_URL)
  assertLocalAppUrl(BASE_URL)

  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  validateClips()
  const unknown = ids.filter((id) => !CLIPS.some((c) => c.id === id))
  if (unknown.length) {
    throw new Error(`unknown clip id(s): ${unknown.join(', ')}. Known: ${CLIPS.map((c) => c.id).join(', ')}`)
  }
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error('No saved session. Run `pnpm docs:session` first (see scripts/docs-demo/README.md).')
  }
  requireFfmpeg()

  const selected = ids.length ? CLIPS.filter((c) => ids.includes(c.id)) : CLIPS
  const sharp = loadSharp()
  const browser = await launchBrowser('docs-clips')
  const results: Record<string, ClipOut> = {}
  const failures: string[] = []
  try {
    for (const clip of selected) {
      // The dev server compiles a route on first visit, so a failure must
      // repeat to count. A clip that changes data (approving a draft) cannot
      // be retried once it got that far: reseed with `pnpm docs:seed`, rerun.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          results[clip.id] = await recordClip(browser, clip, sharp)
          break
        } catch (err) {
          const raw = (err as Error).message
          const message = raw.startsWith('[') ? raw : `[${clip.id}] ${raw.split('\n')[0]}`
          if (attempt === 1) {
            console.warn(`[docs-clips] retrying after: ${message}`)
            continue
          }
          failures.push(message)
          console.error(`[docs-clips] FAILED ${message}`)
        }
      }
    }
  } finally {
    await browser.close()
  }

  let existing: Record<string, ClipOut> = {}
  if (fs.existsSync(JSON_PATH)) existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  const known = new Set(CLIPS.map((c) => c.id))
  const merged: Record<string, ClipOut> = {}
  for (const id of [...Object.keys({ ...existing, ...results })].filter((key) => known.has(key)).sort()) {
    merged[id] = results[id] ?? existing[id]
  }
  fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true })
  fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + '\n')

  if (failures.length) {
    console.error(`\n[docs-clips] ${failures.length} clip(s) failed.`)
    process.exit(1)
  }
  console.log(`[docs-clips] wrote ${Object.keys(results).length} clip(s); manifest at lib/docs/clips.generated.json`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
