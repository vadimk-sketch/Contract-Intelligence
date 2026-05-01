// OCR + text extraction helpers
// Strategy:
//   - PDF: try to use pdf.js text extraction (fast, free) — for scanned PDFs falls through
//   - Images / scanned PDFs: use Cloudflare Workers AI vision model
//   - For Phase 1 simplicity: rely on Workers AI for image OCR, and for PDFs we send the
//     raw bytes to Anthropic's vision-capable model in the extractor itself.
//
// Note: heavy PDF parsing inside Workers is constrained (no fs, 10MB bundle limit).
// We use a pragmatic approach: text-layer PDFs we extract trivially via a regex strip;
// scanned PDFs fall back to Claude vision in the extraction step.

import type { Bindings } from '../types/bindings'

// Simple PDF text-layer extractor: strips out text between BT/ET markers.
// This catches ~80% of digitally-created PDFs without a heavy dependency.
export function extractPdfTextLayer(bytes: Uint8Array): string {
  const text = new TextDecoder('latin1').decode(bytes)
  const out: string[] = []
  // Match (text) Tj  and  [(...)(...)]TJ  patterns
  const reTj = /\(((?:\\.|[^\\()])*)\)\s*Tj/g
  const reTJ = /\[\s*((?:\([^)]*\)\s*-?\d*\s*)+)\]\s*TJ/g
  let m: RegExpExecArray | null
  while ((m = reTj.exec(text)) !== null) {
    out.push(unescapePdf(m[1]))
  }
  while ((m = reTJ.exec(text)) !== null) {
    const inner = m[1]
    const reInner = /\(((?:\\.|[^\\()])*)\)/g
    let im: RegExpExecArray | null
    while ((im = reInner.exec(inner)) !== null) {
      out.push(unescapePdf(im[1]))
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function unescapePdf(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
}

// Use Workers AI for image OCR (Llama-3.2-Vision)
export async function ocrImage(env: Bindings, bytes: Uint8Array): Promise<string> {
  if (!env.AI) return ''
  try {
    const resp: any = await (env.AI as any).run('@cf/meta/llama-3.2-11b-vision-instruct', {
      image: Array.from(bytes),
      prompt: 'Transcribe all visible text from this document image, preserving structure (headers, paragraphs, tables). Output text only, no commentary.',
      max_tokens: 4096
    })
    return resp.response || resp.description || ''
  } catch (e) {
    console.error('OCR error', e)
    return ''
  }
}

// Main entry: extract text from any uploaded document
export async function extractText(
  env: Bindings,
  bytes: Uint8Array,
  mimeType: string
): Promise<{ text: string; method: string }> {
  // Plain text / DOCX (docx is a zip — Phase 1 we accept as-is and let Claude handle)
  if (mimeType === 'text/plain') {
    return { text: new TextDecoder().decode(bytes), method: 'utf8' }
  }

  if (mimeType === 'application/pdf') {
    const layer = extractPdfTextLayer(bytes)
    if (layer.length > 200) return { text: layer, method: 'pdf-text-layer' }
    // Scanned PDF — fall through to Claude vision in extraction step
    return { text: '', method: 'pdf-needs-vision' }
  }

  if (mimeType.startsWith('image/')) {
    const ocr = await ocrImage(env, bytes)
    return { text: ocr, method: 'workers-ai-vision' }
  }

  // DOCX, EML, etc — Phase 1 we just decode as latin1 and let Claude handle
  return { text: new TextDecoder('latin1').decode(bytes).slice(0, 100000), method: 'raw-decode' }
}
