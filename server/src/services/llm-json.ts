const fencedJson = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/

export const parseSingleJsonValue = (raw: string): unknown => {
  const trimmed = raw.trim().replace(/^\uFEFF/, '')
  const fenced = fencedJson.exec(trimmed)
  const payload = fenced ? fenced[1] ?? '' : trimmed
  return JSON.parse(payload)
}
