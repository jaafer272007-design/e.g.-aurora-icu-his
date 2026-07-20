/* ==================== Print-time format engine (P2, document level) ====
   The Print Center Engine the contract recorded: the person printing
   sets PAPER SIZE, ORIENTATION, MARGINS, FONT SIZE and SECTION TOGGLES
   on the rendered document before window.print(). It wraps the layout
   knobs the templates already isolated (orientation in the registry;
   type sizes and section classes in print.css) — the templates
   themselves are untouched.

   🔴 THE SAFETY LINE: this is STYLING ONLY. Every control here maps to
   @page rules, a root font-size, or display:none on document CHROME
   (logo / signature write-ins / branding footer). No control touches
   the clinical content, which stays rendered from the persisted record
   and is not editable anywhere on the page — a formatted document says
   exactly what the unformatted one says.

   APPLY-AND-PRINT (the stated choice): settings live in component state
   for the document being printed and reset on the next open — contained
   and predictable. Per-hospital SAVED defaults (a small Configuration
   print-settings tenant on the existing pattern) are the recorded
   fast-follow, not built here. */

export interface PrintFormat {
  paper: 'A4' | 'Letter' | 'Legal'
  orientation: 'portrait' | 'landscape'
  margins: 'normal' | 'narrow' | 'wide'
  fontScale: 'small' | 'normal' | 'large'
  /** section toggles — document CHROME only, never clinical content */
  showLogo: boolean
  showSignature: boolean
  showBrandFooter: boolean
}

export const defaultFormat = (orientation: 'portrait' | 'landscape'): PrintFormat => ({
  paper: 'A4',
  orientation,
  margins: 'normal',
  fontScale: 'normal',
  showLogo: true,
  showSignature: true,
  showBrandFooter: true,
})

/* the presets — mm for @page (print), and the same numbers drive the
   on-screen preview sheet so what you see is what prints */
export const MARGIN_MM: Record<PrintFormat['margins'], string> = {
  normal: '16mm 14mm 18mm',
  narrow: '10mm 9mm 11mm',
  wide: '22mm 20mm 24mm',
}

export const FONT_PT: Record<PrintFormat['fontScale'], string> = {
  small: '9.5pt',
  normal: '10.5pt',
  large: '12pt',
}

/* the preview sheet's width per paper (print uses @page size directly) */
const PAPER_MM: Record<PrintFormat['paper'], { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 216, h: 279 },
  Legal: { w: 216, h: 356 },
}

export const previewWidthMm = (f: PrintFormat): number =>
  f.orientation === 'landscape' ? PAPER_MM[f.paper].h : PAPER_MM[f.paper].w

/** the injected per-document stylesheet — @page + root type size, plus
 *  the SCREEN-ONLY preview sheet metrics (width from the paper, padding
 *  from the margins) so the preview stays what-you-see-is-what-prints.
 *  The <style> element renders after the bundled CSS, so these win;
 *  print keeps width:auto/padding:0 (the @page rules own the paper). */
export function formatCss(f: PrintFormat): string {
  return [
    `@page { size: ${f.paper} ${f.orientation}; margin: ${MARGIN_MM[f.margins]}; }`,
    `.print-doc { font-size: ${FONT_PT[f.fontScale]}; }`,
    `@media screen { .print-page { width: ${previewWidthMm(f)}mm; padding: ${MARGIN_MM[f.margins]}; } }`,
  ].join('\n')
}

/** toggle classes on the sheet — print.css hides the matching chrome */
export function formatClasses(f: PrintFormat): string {
  const cls: string[] = []
  if (!f.showLogo) cls.push('fmt-nologo')
  if (!f.showSignature) cls.push('fmt-nosig')
  if (!f.showBrandFooter) cls.push('fmt-nobrand')
  return cls.join(' ')
}
