/**
 * Place names as the log form wants them: "City, ST".
 *
 * FMCSA's guide asks for the city or town and the state abbreviation at each
 * change of duty status. Geocoded labels arrive as "Springfield, Illinois" or,
 * for an exact address, "123 Main St, Springfield, Illinois"; the gazetteer
 * already says "Topeka, KS". All three become "City, ST", and only the city is
 * ever shortened, so the state -- the part the regulation requires -- survives.
 */

const STATE_CODES: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'Puerto Rico': 'PR',
}

export function shortPlace(label: string, maxLength = 32): string {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return label
  const stateName = parts.at(-1)!
  const state = STATE_CODES[stateName] ?? stateName
  let city = parts.at(-2)!
  const room = maxLength - state.length - 2
  if (city.length > room) city = `${city.slice(0, Math.max(1, room - 1)).trimEnd()}…`
  return `${city}, ${state}`
}
