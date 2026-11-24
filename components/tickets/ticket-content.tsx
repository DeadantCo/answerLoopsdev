import Image from 'next/image'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'
import { parseSlackMrkdwn, type MrkdwnNode } from '@/lib/slack/mrkdwn'
import type { SourcePlatform } from '@/types'

function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// Keep Markdown renderers outside TicketContent to avoid recreating
// component definitions on every render.
const markdownComponents: Components = {
  a: ({ href, children }) =>
    isSafeExternalUrl(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline break-all hover:text-blue-800"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),

  img: ({ src, alt }) =>
    typeof src === 'string' && isSafeExternalUrl(src) ? (
      <Image
        src={src}
        alt={alt ?? ''}
        width={1200}
        height={800}
        unoptimized
        className="block max-w-full h-auto rounded"
      />
    ) : (
      <>{alt}</>
    ),
}

type MessageTreatment = 'markdown' | 'mrkdwn' | 'plain'

// How each channel's stored message text is displayed. Typed as a Record so a
// new channel has to pick a treatment.
//  - markdown: the channel stores Markdown (Discord; Discourse stores the post's
//    raw Markdown; GitHub; MCP agents write Markdown).
//  - mrkdwn: Slack and Google Chat store their own syntax, converted to elements.
//  - plain: Telegram stores text without its formatting entities, email is
//    already converted from HTML to text, and Circle is stored as received.
const MESSAGE_TREATMENT: Record<SourcePlatform, MessageTreatment> = {
  github: 'markdown',
  discord: 'markdown',
  discourse: 'markdown',
  mcp: 'markdown',
  slack: 'mrkdwn',
  google_chat: 'mrkdwn',
  telegram: 'plain',
  email: 'plain',
  circle: 'plain',
}

function renderMrkdwn(nodes: MrkdwnNode[]): React.ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text
      case 'bold':
        return <strong key={i}>{renderMrkdwn(node.children)}</strong>
      case 'italic':
        return <em key={i}>{renderMrkdwn(node.children)}</em>
      case 'strike':
        return <s key={i}>{renderMrkdwn(node.children)}</s>
      case 'code':
        return (
          <code key={i} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em]">
            {node.text}
          </code>
        )
      case 'codeblock':
        return (
          <pre key={i} className="my-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-100 p-2 font-mono text-xs">
            {node.text}
          </pre>
        )
      case 'link':
        return (
          <a
            key={i}
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline break-all hover:text-blue-800"
          >
            {renderMrkdwn(node.children)}
          </a>
        )
    }
  })
}

// Renders ticket/reply content, turning any [Attachment: name] — url
// lines into clickable links. The message body is formatted per channel
// (see MESSAGE_TREATMENT); raw HTML is never rendered.
export function TicketContent({
  content,
  className,
  sourcePlatform,
}: {
  content: string
  className?: string
  sourcePlatform?: SourcePlatform
}) {
  const { text, attachments } = parseAttachmentLines(content)
  const treatment = sourcePlatform ? MESSAGE_TREATMENT[sourcePlatform] : 'plain'

  return (
    <div className={className}>
      {text && treatment === 'markdown' && (
        <div className="text-sm text-gray-800 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      )}
      {text && treatment === 'mrkdwn' && (
        <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
          {renderMrkdwn(parseSlackMrkdwn(text))}
        </div>
      )}
      {text && treatment === 'plain' && <p className="text-sm text-gray-800 whitespace-pre-wrap">{text}</p>}

      {attachments.length > 0 && (
        <div className={text ? 'mt-2 flex flex-col gap-1' : 'flex flex-col gap-1'}>
          {attachments.map((a, i) => (
            <a
              key={i}
              href={a.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit max-w-full items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-gray-100 hover:text-blue-800"
            >
              <span aria-hidden="true">📎</span>
              <span className="min-w-0 break-all">{a.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
