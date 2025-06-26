import type { ScryfallImageSize, ScryfallList } from '@scryfall/api-types'

export default defineEventHandler(async (event) => {
  const name = getQuery(event).q?.toString()

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name is required',
    })
  }

  const data = await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
    query: {
      q: `${name} is:commander`,
    },
    headers: {
      'User-Agent': 'Commander-Keepr/1.0.0',
      'Accept': 'application/json',
    },
  }).then((res) => {
    const mappedCards = res.data.map((card) => {
      const image = getCardImageUri(card, 'art_crop' as ScryfallImageSize)

      return {
        id: card.id,
        name: card.name,
        image,
      }
    })

    // Sort cards: exact matches first, then alphabetically
    return mappedCards.sort((a, b) => {
      const aStartsWithName = a.name.toLowerCase().startsWith(name.toLowerCase())
      const bStartsWithName = b.name.toLowerCase().startsWith(name.toLowerCase())

      if (aStartsWithName && !bStartsWithName)
        return -1
      if (!aStartsWithName && bStartsWithName)
        return 1
      return a.name.localeCompare(b.name)
    })
  }).catch((error) => {
    console.error(error)
    return []
  })

  return data
})
