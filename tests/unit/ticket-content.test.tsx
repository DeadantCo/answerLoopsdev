// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TicketContent } from '@/components/tickets/ticket-content'

afterEach(cleanup)

describe('TicketContent', () => {
  it('renders GitHub Markdown formatting', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content={'## Release notes\n\n**Important update**\n\n- First item\n- Second item\n\n`npm test`'}
      />
    )

    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument()
    expect(screen.getByText('Important update').tagName).toBe('STRONG')
    expect(screen.getByText('First item')).toBeInTheDocument()
    expect(screen.getByText('Second item')).toBeInTheDocument()
    expect(screen.getByText('npm test').tagName).toBe('CODE')
  })

  it('does not render raw HTML as executable elements', () => {
    const { container } = render(
      <TicketContent
        sourcePlatform="github"
        content={'<script>alert("unsafe")</script>\n<img src=x onerror=alert(1) />'}
      />
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>')
  })

  it('renders safe external links in a new tab with safe rel attributes', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content="[Open docs](https://example.com/docs)"
      />
    )

    expect(screen.getByRole('link', { name: 'Open docs' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByRole('link', { name: 'Open docs' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Open docs' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render unsafe link protocols as clickable links', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content="[Unsafe link](javascript:alert%281%29)"
      />
    )

    expect(screen.queryByRole('link', { name: 'Unsafe link' })).not.toBeInTheDocument()
    expect(screen.getByText('Unsafe link')).toBeInTheDocument()
  })

  it('renders safe images responsively', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content="![Architecture diagram](https://example.com/architecture.png)"
      />
    )

    const image = screen.getByRole('img', { name: 'Architecture diagram' })
    expect(image).toHaveAttribute('src', 'https://example.com/architecture.png')
    expect(image).toHaveClass('max-w-full', 'h-auto')
  })

  it('preserves attachment links in GitHub messages', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content={'See the screenshot.\n[Attachment: shot.png] — https://files.example/shot.png'}
      />
    )

    expect(screen.getByText('See the screenshot.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /shot\.png/ })).toHaveAttribute(
      'href',
      'https://files.example/shot.png'
    )
  })

  it.each(['telegram', 'email', 'circle'] as const)('keeps %s messages as plain text', (platform) => {
    render(
      <TicketContent
        sourcePlatform={platform}
        content="**This should remain literal Markdown** and [a](https://example.com)"
      />
    )

    expect(
      screen.getByText('**This should remain literal Markdown** and [a](https://example.com)')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('keeps messages with no known platform as plain text', () => {
    render(<TicketContent content="**literal**" />)
    expect(screen.getByText('**literal**')).toBeInTheDocument()
  })

  it.each(['discord', 'discourse', 'mcp'] as const)('renders %s messages as Markdown', (platform) => {
    const { container } = render(
      <TicketContent
        sourcePlatform={platform}
        content={'# Title\n\n**bold** and *italic* with `code`\n\n- one\n- two\n\n[docs](https://example.com/docs)'}
      />
    )

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.textContent).not.toContain('**')
  })

  it('shows dashboard-relative Markdown links as text for Discord', () => {
    render(<TicketContent sourcePlatform="discord" content="See [the ticket](/tickets/5)" />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/the ticket/)).toBeInTheDocument()
  })

  it('does not render raw HTML in Discord messages', () => {
    const { container } = render(
      <TicketContent sourcePlatform="discord" content={'<script>alert(1)</script> <b>hi</b>'} />
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it.each(['slack', 'google_chat'] as const)('renders %s formatting without raw syntax', (platform) => {
    const { container } = render(
      <TicketContent
        sourcePlatform={platform}
        content={'*bold* _italic_ `code` <https://example.com/a?x=1&amp;y=2|the docs> <@U123> <#C1|general>'}
      />
    )

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
    const link = screen.getByRole('link', { name: 'the docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/a?x=1&y=2')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.textContent).toContain('@U123')
    expect(container.textContent).toContain('#general')
    expect(container.textContent).not.toContain('<')
  })

  it('does not render raw HTML or unsafe links in Slack messages', () => {
    const { container } = render(
      <TicketContent
        sourcePlatform="slack"
        content={'&lt;script&gt;alert(1)&lt;/script&gt; <javascript:alert(1)|click me> <mailto:a@example.com|mail us>'}
      />
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('click me')
    expect(container.textContent).toContain('mail us')
  })

  it('keeps attachment links in Slack messages', () => {
    render(
      <TicketContent
        sourcePlatform="slack"
        content={'*see* this\n[Attachment: shot.png] — https://files.example/shot.png'}
      />
    )

    expect(screen.getByText('see').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: /shot\.png/ })).toHaveAttribute('href', 'https://files.example/shot.png')
  })

  it('renders GitHub tables', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content={'| A | B |\n| - | - |\n| 1 | 2 |'}
      />
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('renders GitHub task lists as checkboxes', () => {
    render(
      <TicketContent
        sourcePlatform="github"
        content={'- [x] done\n- [ ] todo'}
      />
    )

    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('does not render images with unsafe protocols', () => {
    const { container } = render(
      <TicketContent
        sourcePlatform="github"
        content="![Unsafe image](javascript:alert%281%29)"
      />
    )

    expect(container.querySelector('img')).toBeNull()
  })
})
