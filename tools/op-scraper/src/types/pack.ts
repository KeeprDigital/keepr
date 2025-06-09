export type TitleParts = {
  prefix?: string
  title: string
  label?: string
}

export type Pack = {
  id: string
  rawTitle: string
  titleParts: TitleParts
}

export class PackParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackParseError'
  }
}

export function processTitleParts(rawTitle: string): TitleParts {
  let processedTitle = rawTitle

  // Extract label [LABEL]
  const label = getLabelFromTitle(rawTitle)
  if (label) {
    processedTitle = removeLabelFromTitle(processedTitle, label).trim()
  }

  // Extract prefix
  const prefix = getPrefixFromTitle(rawTitle)
  if (prefix) {
    processedTitle = processedTitle.replace(prefix, '')
  }

  const cleanPrefix = prefix?.trim() || undefined

  // Clean up dashes
  if (processedTitle.startsWith('-')) {
    processedTitle = processedTitle.slice(1)
  }
  if (processedTitle.endsWith('-')) {
    processedTitle = processedTitle.slice(0, -1)
  }

  return {
    prefix: cleanPrefix,
    title: processedTitle.trim(),
    label,
  }
}

function removeLabelFromTitle(title: string, label: string): string {
  const fullLabel = `[${label}]`
  return title.replace(fullLabel, '')
}

function getLabelFromTitle(title: string): string | undefined {
  const match = title.match(/\[(.*?)\]/)
  return match?.[1] || undefined
}

function getPrefixFromTitle(title: string): string | undefined {
  const match = title.match(/^(.*?)-.*?-/)
  const prefix = match?.[1]
  return prefix && prefix.length > 0 ? prefix : undefined
}

export function flattenTitle(innerHtml: string): string {
  return innerHtml.replace(/&lt;.*?&gt;/g, '')
}
