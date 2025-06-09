import type { Card, Pack } from '../types'
import { load } from 'cheerio'
import { EN_CONFIG } from '../config'
import { flattenTitle, processTitleParts } from '../types'
import { CardScraper } from './cardScraper'

export class OpScraper {
  private baseUrl: string

  constructor() {
    this.baseUrl = EN_CONFIG.hostname
  }

  private cardlistEndpoint(): string {
    return `${this.baseUrl}/cardlist`
  }

  async fetchAllPacks(): Promise<Pack[]> {
    const url = this.cardlistEndpoint()
    console.log(`GET ${url}`)

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch packs: ${response.statusText}`)
    }

    const html = await response.text()
    const $ = load(html)

    const packs: Pack[] = []
    $('div.seriesCol>select#series>option').each((_, element) => {
      const $element = $(element)
      const id = $element.attr('value')

      if (id && id.length > 0) {
        const rawTitle = flattenTitle($element.html() || '')
        const titleParts = processTitleParts(rawTitle)

        packs.push({
          id,
          rawTitle,
          titleParts,
        })
      }
    })

    return packs
  }

  async fetchAllCards(packId: string): Promise<Card[]> {
    const url = new URL(this.cardlistEndpoint())
    url.searchParams.set('series', packId)

    console.log(`GET ${url}`)

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch cards: ${response.statusText}`)
    }

    const html = await response.text()
    const $ = load(html)

    const cards: Card[] = []
    $('div.resultCol>a').each((_, element) => {
      const $element = $(element)
      const cardIdWithHash = $element.attr('data-src')

      if (cardIdWithHash) {
        const cardId = cardIdWithHash.slice(1) // Remove leading #

        try {
          // Pass baseUrl to CardScraper so it can create full URLs
          const card = CardScraper.createCard($, cardId, packId, this.baseUrl)
          cards.push(card)
        }
        catch (error) {
          console.error(`Failed to scrape card ${cardId}:`, error)
        }
      }
    })

    return cards
  }

  async downloadCardImage(card: Card): Promise<ArrayBuffer> {
    // imgUrl is already a full URL, use it directly
    console.log(`Downloading image: ${card.imgUrl}`)
    const response = await fetch(card.imgUrl)

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`)
    }

    return response.arrayBuffer()
  }
}
