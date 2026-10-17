/**
 * Documents and emails Danya writes.
 *
 * PDF: she writes the document between [[PDF]] markers (first line the title,
 * then paragraphs, "# " headings and "- " bullets); this lays it out on A4 with
 * jsPDF, loaded only when a PDF is actually made. The result can be downloaded
 * or handed to the iOS share sheet — which is how it gets attached to an email,
 * a WhatsApp message, or saved to Files.
 *
 * Email: she writes "To:", "Subject:" and the body between [[EMAIL]] markers;
 * this turns it into links that open the draft in Mail or Gmail. She never
 * sends anything — the user does, from their own mail app.
 */

import { showCard } from './actions'

export type MadePdf = { blob: Blob; url: string; name: string; title: string }

const MARGIN = 56
const PAGE_BOTTOM = 790

/** jsPDF's built-in fonts cover Latin-1/Windows-1252; swap what they can't draw. */
function printable(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
}

export async function makePdf(raw: string): Promise<MadePdf> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2
  const lines = raw.replace(/\r/g, '').split('\n')
  const title = printable((lines.shift() ?? 'Document').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()) || 'Document'
  let y = 72

  const ensure = (height: number) => {
    if (y + height > PAGE_BOTTOM) {
      doc.addPage()
      y = 64
    }
  }
  const write = (text: string, size: number, bold: boolean, indent = 0, gap = 4) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const wrapped = doc.splitTextToSize(text, width - indent) as string[]
    for (const line of wrapped) {
      ensure(size * 1.35)
      doc.text(line, MARGIN + indent, y)
      y += size * 1.35
    }
    y += gap
  }

  write(title, 20, true, 0, 6)
  doc.setDrawColor(40, 170, 200)
  doc.setLineWidth(1.2)
  doc.line(MARGIN, y - 4, MARGIN + width, y - 4)
  y += 14

  for (const rawLine of lines) {
    const line = printable(rawLine.replace(/\*\*(.+?)\*\*/g, '$1')).trimEnd()
    if (!line.trim()) {
      y += 6
      continue
    }
    const heading = /^#{1,3}\s+(.+)$/.exec(line.trim())
    const bullet = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line)
    if (heading) {
      y += 4
      write(heading[1], 14, true, 0, 2)
    } else if (bullet) {
      const marker = /^\s*\d+[.)]/.test(line) ? `${line.trim().split(/\s/)[0]} ` : '- '
      write(marker + bullet[1], 11, false, 14, 2)
    } else {
      write(line.trim(), 11, false, 0, 4)
    }
  }

  const blob = doc.output('blob')
  const name = `${title.replace(/[^\w\- ]+/g, '').trim().replace(/[\s-]+/g, '-').slice(0, 60) || 'document'}.pdf`
  return { blob, url: URL.createObjectURL(blob), name, title }
}

/** The iOS share sheet with the PDF attached, where it can go to Mail,
 *  WhatsApp or Files. Must run from a tap. Returns false if sharing files is
 *  not supported here (then the download button is the way). */
export async function sharePdf(pdf: MadePdf, text?: string): Promise<boolean> {
  const file = new File([pdf.blob], pdf.name, { type: 'application/pdf' })
  if (!navigator.canShare?.({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: pdf.title, ...(text ? { text } : {}) })
  } catch {
    /* the user closed the share sheet */
  }
  return true
}

function canShareFiles(): boolean {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }))
  } catch {
    return false
  }
}

let lastUrl: string | null = null

/** Makes the PDF and puts it on screen with Save and Share buttons. When she
 *  also drafted an email to go with it, Share carries that text along, so
 *  Share → Mail gives the email with the PDF attached. Never throws. */
export async function offerPdf(raw: string, mail?: EmailDraft | null): Promise<void> {
  try {
    const pdf = await makePdf(raw)
    if (lastUrl) URL.revokeObjectURL(lastUrl)
    lastUrl = pdf.url
    const share = canShareFiles()
    showCard({
      title: `📄 ${pdf.title}`,
      detail: !share
        ? 'PDF ready to save.'
        : mail
          ? `PDF ready. Tap Share → Mail to send it with the email${mail.to ? ` to ${mail.to}` : ''}.`
          : 'PDF ready. Save it to Files, or Share it to Mail, WhatsApp or print.',
      href: pdf.url,
      download: pdf.name,
      button: 'Save PDF',
      extra: share
        ? {
            label: 'Share',
            onClick: () => void sharePdf(pdf, mail ? [mail.subject, mail.body].filter(Boolean).join('\n\n') : undefined),
          }
        : undefined,
      keep: true,
    })
  } catch (err) {
    console.error(err)
    showCard({ title: "Couldn't make the PDF", detail: 'Check the internet connection and ask again.' })
  }
}

/** Puts an email draft on screen: open it in Mail or Gmail, check it, send it. */
export function offerEmail(mail: EmailDraft): void {
  showCard({
    title: `✉️ ${mail.subject || 'Email draft'}`,
    detail: `${mail.to ? `To: ${mail.to}\n\n` : ''}${mail.body}`,
    href: mail.mailto,
    button: 'Open in Mail',
    extra: { label: 'Gmail', href: mail.gmail },
    keep: true,
  })
}

export type EmailDraft = { to: string; subject: string; body: string; mailto: string; gmail: string }

/** "To: …\nSubject: …\n\nbody" → links that open the draft in Mail or Gmail. */
export function parseEmail(raw: string): EmailDraft | null {
  if (!raw.trim()) return null
  const lines = raw.replace(/\r/g, '').split('\n')
  let to = ''
  let subject = ''
  const body: string[] = []
  let inBody = false
  for (const line of lines) {
    const header = !inBody && /^(to|subject):\s*(.*)$/i.exec(line.trim())
    if (header) {
      if (header[1].toLowerCase() === 'to') to = header[2].trim()
      else subject = header[2].trim()
      continue
    }
    if (!inBody && !line.trim()) {
      if (to || subject) inBody = true
      continue
    }
    inBody = true
    body.push(line)
  }
  const text = body.join('\n').trim()
  if (!text && !subject) return null
  const enc = encodeURIComponent
  const mailto = `mailto:${enc(to).replace(/%40/g, '@').replace(/%2C/gi, ',')}?subject=${enc(subject)}&body=${enc(text)}`
  const gmail = `googlegmail://co?to=${enc(to)}&subject=${enc(subject)}&body=${enc(text)}`
  return { to, subject, body: text, mailto, gmail }
}
