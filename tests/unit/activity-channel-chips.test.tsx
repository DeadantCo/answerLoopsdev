// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ActivityPanel } from '@/components/dashboard/activity-panel'
import { ActivityChannelChips, type ActivityChannelCount } from '@/components/dashboard/activity-channel-chips'
import type { Ticket } from '@/types'

vi.mock('@/lib/actions/notifications', () => ({ markAllTicketsSeenAction: vi.fn() }))

afterEach(cleanup)

const counts = (...entries: [ActivityChannelCount['platform'], number][]): ActivityChannelCount[] =>
  entries.map(([platform, count]) => ({ platform, count }))

function chips() {
  return within(screen.getByRole('list', { name: 'New replies by channel' })).getAllByRole('link')
}

describe('ActivityChannelChips', () => {
  it('shows a chip per channel in the order given, each linking to that channel’s unseen replies', () => {
    render(<ActivityChannelChips channels={counts(['github', 8], ['discord', 3], ['email', 1])} />)
    const links = chips()
    expect(links.map((link) => link.textContent)).toEqual(['GitHub8', 'Discord3', 'Email1'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/tickets?newActivity=1&sort=activity&platform=github',
      '/tickets?newActivity=1&sort=activity&platform=discord',
      '/tickets?newActivity=1&sort=activity&platform=email',
    ])
  })

  it('gives each chip an accessible name with the exact count', () => {
    render(<ActivityChannelChips channels={counts(['github', 8], ['slack', 1])} />)
    expect(screen.getByRole('link', { name: 'GitHub, 8 tickets with new replies' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Slack, 1 ticket with new replies' })).toBeVisible()
  })

  it('shows 99+ above 99 but keeps the exact number in the accessible name', () => {
    render(<ActivityChannelChips channels={counts(['github', 99], ['slack', 100], ['email', 250])} />)
    expect(chips().map((link) => link.textContent)).toEqual(['GitHub99', 'Slack99+', 'Email99+'])
    expect(screen.getByRole('link', { name: 'Slack, 100 tickets with new replies' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Email, 250 tickets with new replies' })).toBeVisible()
  })

  it('shows all four chips when there are exactly four channels', () => {
    render(<ActivityChannelChips channels={counts(['github', 4], ['slack', 3], ['email', 2], ['discord', 1])} />)
    expect(chips().map((link) => link.textContent)).toEqual(['GitHub4', 'Slack3', 'Email2', 'Discord1'])
  })

  it('folds channels beyond the cap into an Other chip that links to the unfiltered list', () => {
    render(<ActivityChannelChips channels={counts(['github', 9], ['slack', 8], ['email', 7], ['discord', 3], ['telegram', 2], ['circle', 1])} />)
    const links = chips()
    expect(links.map((link) => link.textContent)).toEqual(['GitHub9', 'Slack8', 'Email7', 'Other6'])
    expect(links[3]).toHaveAttribute('href', '/tickets?newActivity=1&sort=activity')
    expect(screen.getByRole('link', { name: 'Other, 6 tickets with new replies' })).toBeVisible()
  })

  it.each([[[]], [[['github', 12]]], [[['github', 0], ['slack', 5]]]] as [[ActivityChannelCount['platform'], number][]][])(
    'shows no chips when at most one channel has unseen replies (%j)',
    (entries) => {
      const { container } = render(<ActivityChannelChips channels={counts(...entries)} />)
      expect(container).toBeEmptyDOMElement()
    }
  )

  it('lets the chips wrap instead of scrolling sideways', () => {
    render(<ActivityChannelChips channels={counts(['github', 8], ['slack', 1])} />)
    const list = screen.getByRole('list', { name: 'New replies by channel' })
    expect(list).toHaveClass('flex', 'flex-wrap')
    expect(list.className).not.toMatch(/overflow|nowrap/)
  })
})

describe('ActivityPanel channel chips', () => {
  const ticket = { id: 1, org_ticket_number: 5, content: 'raw', ai_summary: 'Login fails', source_platform: 'slack', source_author_name: 'alice', last_activity_at: '2026-10-02T00:00:00.000Z', last_customer_reply_at: '2026-10-02T00:00:00.000Z', last_seen_at: null } as Ticket

  it('shows the chips in the header while the panel is collapsed', () => {
    render(<ActivityPanel tickets={[ticket]} total={11} channels={counts(['github', 8], ['discord', 3])} />)
    const toggle = screen.getByRole('button', { name: /^Activity,/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(chips()).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'View all 11 →' })).toBeVisible()
  })

  it('shows no chips when the panel gets no channel breakdown or only one channel', () => {
    const { rerender } = render(<ActivityPanel tickets={[ticket]} total={8} />)
    expect(screen.queryByRole('list', { name: 'New replies by channel' })).toBeNull()
    rerender(<ActivityPanel tickets={[ticket]} total={8} channels={counts(['github', 8])} />)
    expect(screen.queryByRole('list', { name: 'New replies by channel' })).toBeNull()
  })
})
