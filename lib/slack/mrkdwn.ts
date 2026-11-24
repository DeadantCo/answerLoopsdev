// Slack stores messages in its own "mrkdwn" syntax, which is not Markdown:
// `*bold*`, `_italic_`, `~strike~`, `<url|label>` links, `<@U123>` mentions and
// `<#C123|name>` channels, with `&`, `<` and `>` escaped as HTML entities.
// Google Chat sends the same formatting characters (plus `<users/123>` mentions),
// so it shares this parser. The output is a small node tree, never HTML, so the
// UI renders it through React elements and nothing in a message can inject markup.

export type MrkdwnNode =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: MrkdwnNode[] }
  | { type: 'code' | 'codeblock'; text: string }
  | { type: 'link'; url: string; children: MrkdwnNode[] }

const EMPHASIS: Record<string, 'bold' | 'italic' | 'strike'> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
}

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt);/g, (_, name: string) => (name === 'amp' ? '&' : name === 'lt' ? '<' : '>'))
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char)
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function text(value: string): MrkdwnNode[] {
  return [{ type: 'text', text: value }]
}

// Handles the contents of an `<...>` token. Returns null when it is not one of
// Slack's tokens, so a stray `<` stays literal text.
function parseAngleToken(inner: string): MrkdwnNode[] | null {
  const pipe = inner.indexOf('|')
  const target = pipe === -1 ? inner : inner.slice(0, pipe)
  const label = pipe === -1 ? '' : decodeEntities(inner.slice(pipe + 1))

  if (target.startsWith('@')) return text(`@${label || target.slice(1)}`)
  if (target.startsWith('#')) return text(`#${label || target.slice(1)}`)

  if (target.startsWith('!')) {
    const name = target.slice(1)
    if (label) return text(label)
    if (name.startsWith('subteam^')) return text('@group')
    return text(`@${name.split('^')[0]}`)
  }

  const chatUser = /^users\/(.+)$/.exec(target)
  if (chatUser) return text(label ? `@${label}` : chatUser[1] === 'all' ? '@all' : '@user')

  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) return null

  const url = decodeEntities(target)
  if (isHttpUrl(url)) {
    return [{ type: 'link', url, children: text(label || url) }]
  }
  return text(label || url.replace(/^mailto:/i, ''))
}

function findClosingEmphasis(src: string, start: number, marker: string): number {
  for (let j = start + 2; j < src.length; j++) {
    if (src[j] === '\n') return -1
    if (src[j] === marker && !isSpace(src[j - 1]) && src[j + 1] !== marker && !isWordChar(src[j + 1])) return j
  }
  return -1
}

export function parseSlackMrkdwn(src: string): MrkdwnNode[] {
  const nodes: MrkdwnNode[] = []
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', text: decodeEntities(buffer) })
      buffer = ''
    }
  }

  while (i < src.length) {
    const char = src[i]

    if (src.startsWith('```', i)) {
      const end = src.indexOf('```', i + 3)
      if (end > i + 3) {
        flush()
        const body = src.slice(i + 3, end).replace(/^\n/, '').replace(/\n$/, '')
        nodes.push({ type: 'codeblock', text: decodeEntities(body) })
        i = end + 3
        continue
      }
    }

    if (char === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1 && !src.slice(i + 1, end).includes('\n')) {
        flush()
        nodes.push({ type: 'code', text: decodeEntities(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    if (char === '<') {
      const end = src.indexOf('>', i + 1)
      if (end > i + 1 && !src.slice(i + 1, end).includes('\n')) {
        const token = parseAngleToken(src.slice(i + 1, end))
        if (token) {
          flush()
          nodes.push(...token)
          i = end + 1
          continue
        }
      }
    }

    const emphasis = EMPHASIS[char]
    if (emphasis && !isWordChar(src[i - 1]) && src[i - 1] !== char && !isSpace(src[i + 1]) && src[i + 1] !== char) {
      const end = findClosingEmphasis(src, i, char)
      if (end !== -1) {
        flush()
        nodes.push({ type: emphasis, children: parseSlackMrkdwn(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    buffer += char
    i++
  }

  flush()
  return nodes
}
