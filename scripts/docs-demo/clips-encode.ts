/**
 * Pure helpers for turning a raw Playwright recording into the small looping
 * WebM that ships with the docs. Kept free of I/O so the settings that decide
 * file size and determinism can be unit tested.
 */

import { CLIP_FPS, CLIP_OUTPUT_WIDTH } from './clips.manifest'

/** Constant-quality values tried in order; a higher value means a smaller file. */
export const CRF_LADDER = [34, 38, 42, 46, 50, 54, 58] as const

/** Output size for a recording: the fixed clip width, with an even height (VP9 needs even sizes). */
export function outputSize(viewport: { width: number; height: number }): { width: number; height: number } {
  const height = Math.round(((viewport.height * CLIP_OUTPUT_WIDTH) / viewport.width) / 2) * 2
  return { width: CLIP_OUTPUT_WIDTH, height }
}

/**
 * ffmpeg arguments for one encode attempt. Fixed frame rate, no audio, no
 * metadata and bit-exact flags, so the same recording always gives the same
 * bytes. `startSeconds` drops the page-load time before the first step.
 */
export function ffmpegArgs(options: {
  input: string
  output: string
  crf: number
  startSeconds: number
  viewport: { width: number; height: number }
}): string[] {
  const { width, height } = outputSize(options.viewport)
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', options.startSeconds.toFixed(2),
    '-i', options.input,
    '-an',
    '-vf', `fps=${CLIP_FPS},scale=${width}:${height}:flags=lanczos`,
    '-c:v', 'libvpx-vp9',
    '-b:v', '0',
    '-crf', String(options.crf),
    '-deadline', 'good',
    '-cpu-used', '1',
    '-row-mt', '0',
    '-threads', '1',
    '-pix_fmt', 'yuv420p',
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-flags:v', '+bitexact',
    options.output,
  ]
}
