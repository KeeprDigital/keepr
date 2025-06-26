import type { ScryfallCard, ScryfallImageUris } from '@scryfall/api-types'

/**
 * Type-safe utility to get image URIs from any Scryfall card.
 * For double-faced cards, returns the front face image URIs.
 */
export function getCardImageUris(card: ScryfallCard.Any) {
  // Single-faced cards and single-sided split cards have image_uris at root level
  if ('image_uris' in card && card.image_uris) {
    return card.image_uris
  }

  // Multi-faced cards (double-sided splits and reversible cards)
  if ('card_faces' in card && card.card_faces?.length > 0) {
    // Return the first face (front) image URIs
    const frontFace = card.card_faces[0]
    if ('image_uris' in frontFace && frontFace.image_uris) {
      return frontFace.image_uris
    }
  }

  return undefined
}

/**
 * Type guard to check if a card has image URIs available
 */
export function hasImageUris(card: ScryfallCard.Any) {
  return getCardImageUris(card) !== undefined
}

/**
 * Get a specific image size URI from a card
 */
export function getCardImageUri(
  card: ScryfallCard.Any,
  size: keyof ScryfallImageUris,
): string | undefined {
  const imageUris = getCardImageUris(card)
  return imageUris?.[size]
}

/**
 * Get multiple image size URIs from a card
 */
export function getCardImageUrisForSizes<T extends keyof ScryfallImageUris>(
  card: ScryfallCard.Any,
  sizes: T[],
): Partial<Pick<ScryfallImageUris, T>> {
  const imageUris = getCardImageUris(card)
  if (!imageUris)
    return {}

  return sizes.reduce((acc, size) => {
    if (imageUris[size]) {
      acc[size] = imageUris[size]
    }
    return acc
  }, {} as Partial<Pick<ScryfallImageUris, T>>)
}
