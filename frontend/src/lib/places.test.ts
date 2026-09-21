import { describe, expect, it } from 'vitest'

import { shortPlace } from './places'

describe('shortPlace', () => {
  it('abbreviates the state, as the log form expects', () => {
    expect(shortPlace('Springfield, Illinois')).toBe('Springfield, IL')
    expect(shortPlace('Washington, District of Columbia')).toBe('Washington, DC')
  })

  it('reduces an exact address to city and state', () => {
    expect(shortPlace('123 Main Street, Springfield, Illinois')).toBe('Springfield, IL')
  })

  it('leaves gazetteer labels that are already abbreviated alone', () => {
    expect(shortPlace('Topeka, KS')).toBe('Topeka, KS')
  })

  it('shortens only the city, never dropping the state', () => {
    const short = shortPlace('Rancho Santa Margarita, California', 16)
    expect(short.endsWith(', CA')).toBe(true)
    expect(short.length).toBeLessThanOrEqual(16)
  })
})
