import { jsPDF } from 'jspdf'
import 'svg2pdf.js'

/**
 * Export the rendered log sheets to a vector PDF, entirely client side.
 *
 * Doing this in the browser keeps a headless browser off the backend, and the
 * sheets are already SVG, so the output is vector rather than a screenshot.
 */

const A4_LANDSCAPE_WIDTH = 841.89
const A4_LANDSCAPE_HEIGHT = 595.28
const MARGIN = 24

/** Build the document. Separated from saving so it can be exercised headlessly. */
export async function buildLogSheetsPdf(dayNumbers: number[]): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const availableWidth = A4_LANDSCAPE_WIDTH - MARGIN * 2
  const availableHeight = A4_LANDSCAPE_HEIGHT - MARGIN * 2

  let pageIndex = 0
  for (const dayNumber of dayNumbers) {
    const source = document.getElementById(`log-sheet-${dayNumber}`)
    if (!(source instanceof SVGSVGElement)) continue

    if (pageIndex > 0) pdf.addPage()
    pageIndex += 1

    // svg2pdf reads geometry off a live element, so the clone is sized in
    // points and mounted offscreen rather than measured in place.
    const [, , viewWidth, viewHeight] = (source.getAttribute('viewBox') ?? '0 0 1000 660')
      .split(/\s+/)
      .map(Number)
    // A day with many duty changes has a taller remarks list, so the sheet is
    // fitted to the page in both directions rather than only by width.
    const scale = Math.min(availableWidth / viewWidth, availableHeight / viewHeight)
    const width = viewWidth * scale
    const height = viewHeight * scale

    const clone = source.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))

    const holder = document.createElement('div')
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;'
    holder.appendChild(clone)
    document.body.appendChild(holder)

    try {
      await pdf.svg(clone, {
        x: (A4_LANDSCAPE_WIDTH - width) / 2,
        y: (A4_LANDSCAPE_HEIGHT - height) / 2,
        width,
        height,
      })
    } finally {
      holder.remove()
    }
  }

  if (pageIndex === 0) throw new Error('No log sheets were rendered.')
  return pdf
}

export async function exportLogSheetsToPdf(dayNumbers: number[], filename: string): Promise<void> {
  const pdf = await buildLogSheetsPdf(dayNumbers)
  pdf.save(filename)
}
