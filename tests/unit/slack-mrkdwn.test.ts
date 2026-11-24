import { describe, expect, it } from 'vitest'
import { parseSlackMrkdwn, type MrkdwnNode } from '@/lib/slack/mrkdwn'

const t = (text: string): MrkdwnNode => ({ type: 'text', text })

describe('parseSlackMrkdwn', () => {
  it('returns plain text unchanged', () => {
    expect(parseSlackMrkdwn('hello world')).toEqual([t('hello world')])
  })

  it('parses bold, italic and strike', () => {
    expect(parseSlackMrkdwn('*b* _i_ ~s~')).toEqual([
      { type: 'bold', children: [t('b')] },
      t(' '),
      { type: 'italic', children: [t('i')] },
      t(' '),
      { type: 'strike', children: [t('s')] },
    ])
  })

  it('nests emphasis', () => {
    expect(parseSlackMrkdwn('*bold _both_*')).toEqual([
      { type: 'bold', children: [t('bold '), { type: 'italic', children: [t('both')] }] },
    ])
  })

  it('leaves non-emphasis asterisks and underscores literal', () => {
    expect(parseSlackMrkdwn('2 * 3 * 4')).toEqual([t('2 * 3 * 4')])
    expect(parseSlackMrkdwn('snake_case_name')).toEqual([t('snake_case_name')])
    expect(parseSlackMrkdwn('**not slack bold**')).toEqual([t('**not slack bold**')])
    expect(parseSlackMrkdwn('*unclosed')).toEqual([t('*unclosed')])
  })

  it('does not apply emphasis across lines', () => {
    expect(parseSlackMrkdwn('*a\nb*')).toEqual([t('*a\nb*')])
  })

  it('parses inline code and code blocks without formatting their contents', () => {
    expect(parseSlackMrkdwn('run `*x*` now')).toEqual([t('run '), { type: 'code', text: '*x*' }, t(' now')])
    expect(parseSlackMrkdwn('```\nconst a = 1 &lt; 2\n```')).toEqual([{ type: 'codeblock', text: 'const a = 1 < 2' }])
  })

  it('parses links with and without labels and decodes entities', () => {
    expect(parseSlackMrkdwn('<https://example.com|label>')).toEqual([
      { type: 'link', url: 'https://example.com', children: [t('label')] },
    ])
    expect(parseSlackMrkdwn('<https://example.com/?a=1&amp;b=2>')).toEqual([
      { type: 'link', url: 'https://example.com/?a=1&b=2', children: [t('https://example.com/?a=1&b=2')] },
    ])
  })

  it('shows non-http links as text, never as links', () => {
    expect(parseSlackMrkdwn('<javascript:alert(1)|click>')).toEqual([t('click')])
    expect(parseSlackMrkdwn('<mailto:a@example.com|mail>')).toEqual([t('mail')])
    expect(parseSlackMrkdwn('<mailto:a@example.com>')).toEqual([t('a@example.com')])
  })

  it('turns mentions, channels and special mentions into readable text', () => {
    expect(parseSlackMrkdwn('<@U123>')).toEqual([t('@U123')])
    expect(parseSlackMrkdwn('<@U123|ada>')).toEqual([t('@ada')])
    expect(parseSlackMrkdwn('<#C1|general>')).toEqual([t('#general')])
    expect(parseSlackMrkdwn('<#C1>')).toEqual([t('#C1')])
    expect(parseSlackMrkdwn('<!here>')).toEqual([t('@here')])
    expect(parseSlackMrkdwn('<!channel>')).toEqual([t('@channel')])
    expect(parseSlackMrkdwn('<!subteam^S1|@support>')).toEqual([t('@support')])
    expect(parseSlackMrkdwn('<!date^1700000000^{date}|Nov 14>')).toEqual([t('Nov 14')])
  })

  it('turns Google Chat user mentions into readable text', () => {
    expect(parseSlackMrkdwn('<users/123> hi')).toEqual([t('@user'), t(' hi')])
    expect(parseSlackMrkdwn('<users/all>')).toEqual([t('@all')])
  })

  it('decodes escaped characters and keeps escaped angle brackets from forming tokens', () => {
    expect(parseSlackMrkdwn('a &amp; b &lt;b&gt;x&lt;/b&gt;')).toEqual([t('a & b <b>x</b>')])
    expect(parseSlackMrkdwn('&lt;@U123&gt;')).toEqual([t('<@U123>')])
  })

  it('keeps a stray angle bracket literal', () => {
    expect(parseSlackMrkdwn('1 < 2 and 3 > 2')).toEqual([t('1 < 2 and 3 > 2')])
  })
})
