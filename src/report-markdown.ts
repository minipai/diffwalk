import { Marked, type RendererObject, type Tokens } from 'marked'

const renderer: RendererObject = {
  // Authored text is trusted, so inline HTML passes through: that is how a diagram
  // reaches the page. The report origin's Content Security Policy is what contains it.
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return text
  },
  link({ href, title, tokens }: Tokens.Link) {
    const label = this.parser.parseInline(tokens)
    if (!isSafeLinkHref(href)) return label
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
    return `<a href="${escapeHtml(href)}"${titleAttribute}>${label}</a>`
  },
  image({ href, title, tokens }: Tokens.Image) {
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
    const alt = this.parser.parseInline(tokens)
    return `<img src="${escapeHtml(href)}" alt="${alt}"${titleAttribute}>`
  },
}

const parser = new Marked({ gfm: true, async: false, renderer })

export function renderMarkdown(markdown: string): string {
  return parser.parse(markdown, { async: false })
}

function isSafeLinkHref(href: string): boolean {
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(href)?.[0]?.toLowerCase()
  return (
    scheme === undefined || scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:'
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => entities[char]!)
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}