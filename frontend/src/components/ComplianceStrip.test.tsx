import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TRIP } from '../test/fixtures'
import { ComplianceStrip } from './ComplianceStrip'

describe('the compliance strip', () => {
  it('shows all four binding limits with their CFR citations', () => {
    render(<ComplianceStrip compliance={TRIP.compliance} />)

    for (const label of ['Driving', 'Duty window', 'Since break', 'Cycle left']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('§395.3(a)(3)')).toBeInTheDocument()
    expect(screen.getByText('§395.3(a)(3)(ii)')).toBeInTheDocument()
  })

  it('reports the worst shift, not the trip total', () => {
    render(<ComplianceStrip compliance={TRIP.compliance} />)
    // 11.00 driving in the hardest shift, even though the trip drives 20.92.
    expect(screen.getByText('11.00')).toBeInTheDocument()
    expect(screen.getByText('worst of 2 shifts')).toBeInTheDocument()
  })

  it('counts the cycle down rather than up', () => {
    render(<ComplianceStrip compliance={TRIP.compliance} />)
    expect(screen.getByText('26.53')).toBeInTheDocument()
    expect(screen.getByText('43.47 h used of 70')).toBeInTheDocument()
  })

  it('renders nothing rather than zeroes for a trip stored before compliance existed', () => {
    const { container } = render(<ComplianceStrip compliance={{} as never} />)
    expect(container).toBeEmptyDOMElement()
  })
})
