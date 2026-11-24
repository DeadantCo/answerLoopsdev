/**
 * Browser helpers shared by the screenshot capture (capture.ts) and the clip
 * recorder (clips.ts): launching Chrome, hiding dev-only chrome, masking seeded
 * credentials and refusing to proceed if anything non-fictional is on screen.
 */

import { chromium, type Browser, type Page } from '@playwright/test'
import type { ShotMask, TextMaskRule } from './shots.manifest'

export async function launchBrowser(logPrefix: string): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch (err) {
    console.warn(
      `[${logPrefix}] Chrome unavailable (${(err as Error).message.split('\n')[0]}); falling back to bundled chromium`,
    )
    return await chromium.launch()
  }
}

// Hide dev-only chrome, the product feedback widget, toasts and animations.
export function pageStyles(): string {
  return `
    nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], [data-next-badge-root],
    [data-sonner-toaster], [role="alert"][data-toast], .Toastify { display: none !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  `
}

export async function applyMasks(page: Page, masks: ShotMask[], rules: TextMaskRule[]): Promise<void> {
  for (const mask of masks) {
    const count = await page.locator(mask.selector).count()
    if (count === 0) throw new Error(`mask selector matched nothing: ${mask.selector}`)
    await page.locator(mask.selector).evaluateAll(
      (els, m) => {
        for (const el of els as HTMLElement[]) {
          if (m.mode === 'blur') el.style.filter = 'blur(6px)'
          else el.textContent = m.text ?? '••••••••'
        }
      },
      { mode: mask.mode, text: mask.text },
    )
  }
  await page.evaluate((list) => {
    const compiled = list.map((r) => ({ re: r.pattern, to: r.replacement }))
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    for (const node of nodes) {
      let value = node.nodeValue ?? ''
      for (const { re, to } of compiled) value = value.replace(re, to)
      if (value !== node.nodeValue) node.nodeValue = value
    }
    // Inputs and the embed snippet textarea carry values, not text nodes.
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>) {
      let value = el.value
      for (const { re, to } of compiled) value = value.replace(re, to)
      if (value !== el.value) el.value = value
    }
  }, rules)
}

// Last line of defence: nothing secret-looking or non-fictional may remain.
export async function assertSafe(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const text = document.body.innerText + '\n' + Array.from(document.querySelectorAll('input, textarea')).map((e) => (e as HTMLInputElement).value).join('\n')
    const found: string[] = []
    if (/[•·]{2,}\s?[A-Za-z0-9]{4}\b/.test(text)) found.push('a masked-token tail (last four characters)')
    if (/\b[0-9a-f]{24,}\b/.test(text)) found.push('a long hex value')
    if (/\bal_live_[0-9a-f]{4,}/.test(text)) found.push('an API key prefix')
    if (/\beyJ[A-Za-z0-9_-]{10,}/.test(text)) found.push('a token-shaped string')
    for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
      if (!/@([a-z0-9-]+\.)*example\.(com|org)$/i.test(m)) found.push(`a non-fictional email address (${m.replace(/^[^@]*/, '***')})`)
    }
    return found
  })
  if (problems.length) throw new Error(`[${label}] unsafe content on screen: ${problems.join('; ')}`)
}
