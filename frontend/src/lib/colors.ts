/**
 * Literal colour values, mirroring the tokens in index.css.
 *
 * The log sheet SVG cannot use `var(--color-…)`: svg2pdf.js resolves paint
 * attributes itself and never runs the cascade, so a CSS variable would export
 * as black. Keep these in sync with index.css.
 */
export const ACCENT = '#0066cc'
export const INK = '#1d1d1f'
export const INK_MUTED = '#6e6e73'
export const HAIRLINE = '#b9b9bd'
export const ROW_TINT = '#fafafc'
export const DANGER = '#b00020'

export const SVG_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif"
