import * as pdfjs from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = worker
/** Extract text from a text-based PDF. Scanned/image PDFs return '' (no OCR). */
export async function pdfText(f: File): Promise<string> {
  const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise
  let out = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    out += c.items.map((x: any) => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n'
  }
  return out
}
