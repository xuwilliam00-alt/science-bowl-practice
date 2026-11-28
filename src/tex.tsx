import katex from 'katex'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c])
const MATH = /(\$\$[\s\S]+?\$\$|\$[^$]*\$)/g
/** Turns text containing $...$ (inline) and $$...$$ (display) LaTeX, including \ce{...} chemistry, into HTML. Everything outside the dollar signs is escaped plain text. */
export function texHtml(s: string): string {
  return String(s ?? '').split(MATH).map((p, i) => {
    if (i % 2 === 1) {
      const disp = p.startsWith('$$') && p.length > 4, src = disp ? p.slice(2, -2) : p.slice(1, -1)
      if (src.trim()) { try { return katex.renderToString(src, { throwOnError: false, strict: 'ignore', displayMode: disp }) } catch { return esc(p) } }
      return esc(p)
    }
    return esc(p).replace(/\*\*(.*?)\*\*/gs, '<strong>$1</strong>')
  }).join('')
}
/** For AI explanations: any maths the model left as plain text (x^2, sqrt(…), H2SO4) is wrapped in LaTeX so it renders readably. */
export function autoTex(s: string): string {
  s = String(s ?? '');
  // Convert common fully spoken math constructions only when their delimiters are unambiguous.
  s = s.replace(/integral from ([\w.+-]+) to ([\w.+-]+) of (.+?),?\s*dx/gi, (_m,a,b,c) => `$\\int_{${a}}^{${b}} ${c}\\,dx$`);
  s = s.replace(/\bthe square root of ([\w]+)\b/gi, (_m,a) => `$\\sqrt{${a}}$`).replace(/\b([a-z]) squared\b/gi, (_m,a) => `$${a}^{2}$`).replace(/\b([a-z]) cubed\b/gi, (_m,a) => `$${a}^{3}$');
  return String(s ?? '').split(MATH).map((p, i) => i % 2 ? p : p
    .replace(/\b([A-Za-z]\w*)\^(\{[^}]+\}|[-+]?\d+(?:\.\d+)?|[A-Za-z])/g, (_m, a, b) => `$${a}^${b.startsWith('{') ? b : '{' + b + '}'}$`)
    .replace(/\bsqrt\(([^()]+)\)/g, (_m, a) => `$\\sqrt{${a}}$`)
    .replace(/\b(?=[A-Za-z]*\d)((?:[A-Z][a-z]?\d*){2,})\b/g, m => `$\\ce{${m}}$`)).join('')
}
export function Tex({ s, className, auto }: { s: string; className?: string; auto?: boolean }) { const v=String(s??''); return <span className={className} dangerouslySetInnerHTML={{ __html: texHtml(auto ? autoTex(v) : v) }} /> }
