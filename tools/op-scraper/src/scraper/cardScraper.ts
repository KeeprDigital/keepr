import type { CheerioAPI } from 'cheerio'
import type { Card } from '../types'
import {
  CardAttribute,
  CardCategory,
  CardColor,
  CardParseError,
  CardRarity,
} from '../types'

export class CardScraper {
  static createCard($: CheerioAPI, cardId: string, packId: string, baseUrl: string): Card {
    const dlElement = $(`dl#${cardId}`)

    if (dlElement.length === 0) {
      throw new CardParseError(`Card element not found for ID: ${cardId}`)
    }

    const id = this.fetchId(dlElement)
    const name = this.fetchName($, dlElement)
    const rarity = this.fetchRarity($, dlElement)
    const category = this.fetchCategory($, dlElement)
    const imgUrl = this.fetchImgUrl($, dlElement, baseUrl)
    const colors = this.fetchColors($, dlElement)
    const cost = this.fetchCost($, dlElement)
    const attributes = this.fetchAttributes($, dlElement)
    const power = this.fetchPower($, dlElement)
    const counter = this.fetchCounter($, dlElement)
    const types = this.fetchTypes($, dlElement)
    const effect = this.fetchEffect($, dlElement)
    const trigger = this.fetchTrigger($, dlElement)

    return {
      id,
      packId,
      name,
      rarity,
      category,
      imgUrl,
      colors,
      cost,
      attributes,
      power,
      counter,
      types,
      effect,
      trigger,
    }
  }

  private static fetchId(element: any): string {
    const id = element.attr('id')
    if (!id) {
      throw new CardParseError('Expected to find id attr on <dl>')
    }
    return id
  }

  private static fetchName($: CheerioAPI, element: any): string {
    const nameElement = element.find('dt>div.cardName')
    if (nameElement.length === 0) {
      throw new CardParseError('Card name not found')
    }
    return nameElement.html() || ''
  }

  private static fetchRarity($: CheerioAPI, element: any): CardRarity {
    const rarityElement = element.find('dt>div.infoCol>span:nth-child(2)')
    if (rarityElement.length === 0) {
      throw new CardParseError('Card rarity not found')
    }

    const rawRarity = rarityElement.html() || ''

    switch (rawRarity.trim()) {
      case 'C': return CardRarity.Common
      case 'UC': return CardRarity.Uncommon
      case 'R': return CardRarity.Rare
      case 'SR': return CardRarity.SuperRare
      case 'SEC': return CardRarity.SecretRare
      case 'L': return CardRarity.Leader
      case 'SP CARD': return CardRarity.Special
      case 'TR': return CardRarity.TreasureRare
      case 'P': return CardRarity.Promo
      default:
        throw new CardParseError(`Failed to match rarity: ${rawRarity}`)
    }
  }

  private static fetchCategory($: CheerioAPI, element: any): CardCategory {
    const categoryElement = element.find('dt>div.infoCol>span:nth-child(3)')
    if (categoryElement.length === 0) {
      throw new CardParseError('Card category not found')
    }

    const rawCategory = categoryElement.html() || ''

    switch (rawCategory.trim()) {
      case 'LEADER': return CardCategory.Leader
      case 'CHARACTER': return CardCategory.Character
      case 'EVENT': return CardCategory.Event
      case 'STAGE': return CardCategory.Stage
      case 'DON': return CardCategory.Don
      default:
        throw new CardParseError(`Failed to match category: ${rawCategory}`)
    }
  }

  private static fetchImgUrl($: CheerioAPI, element: any, baseUrl: string): string {
    const imgElement = element.find('dd>div.frontCol>img')
    if (imgElement.length === 0) {
      throw new CardParseError('Card image not found')
    }

    const imgUrl = imgElement.attr('data-src')
    if (!imgUrl) {
      throw new CardParseError('No data-src attr found')
    }

    // Convert relative path to full URL immediately
    if (imgUrl.startsWith('../')) {
      const shortImgUrl = imgUrl.slice(3) // Remove '../'
      return `${baseUrl}/${shortImgUrl}`
    }

    // If it's already a full URL, return as-is
    return imgUrl
  }

  private static fetchColors($: CheerioAPI, element: any): CardColor[] {
    const colorsElement = element.find('dd>div.backCol div.color')
    if (colorsElement.length === 0) {
      return []
    }

    const rawColors = this.stripHtmlTags(colorsElement.html() || '')
    const colorStrings = rawColors.split('/')

    const colors = []
    for (const colorString of colorStrings) {
      const trimmed = colorString.trim()

      switch (trimmed) {
        case 'Red': colors.push(CardColor.Red)
          break
        case 'Green': colors.push(CardColor.Green)
          break
        case 'Blue': colors.push(CardColor.Blue)
          break
        case 'Purple': colors.push(CardColor.Purple)
          break
        case 'Black': colors.push(CardColor.Black)
          break
        case 'Yellow': colors.push(CardColor.Yellow)
          break
        default:
          console.log(`Unknown color: ${trimmed}`)
      }
    }

    return colors
  }

  private static fetchCost($: CheerioAPI, element: any): number | undefined {
    const costElement = element.find('dd>div.backCol>div.col2>div.cost')
    if (costElement.length === 0) {
      return undefined
    }

    const rawCost = this.stripHtmlTags(costElement.html() || '')

    if (rawCost === '-') {
      return undefined
    }

    const cost = Number.parseInt(rawCost, 10)
    if (Number.isNaN(cost)) {
      throw new CardParseError(`Failed to parse cost: ${rawCost}`)
    }

    return cost
  }

  private static fetchAttributes($: CheerioAPI, element: any): CardAttribute[] {
    const attrImgElement = element.find('dd>div.backCol>div.col2>div.attribute>img')
    if (attrImgElement.length === 0) {
      return []
    }

    const rawAttributes = attrImgElement.attr('alt') || ''
    if (!rawAttributes) {
      return []
    }

    const attributeStrings = rawAttributes.split('/')
    const attributes = []

    for (const attrString of attributeStrings) {
      const trimmed = attrString.trim()

      switch (trimmed) {
        case 'Slash': attributes.push(CardAttribute.Slash)
          break
        case 'Strike': attributes.push(CardAttribute.Strike)
          break
        case 'Ranged': attributes.push(CardAttribute.Ranged)
          break
        case 'Special': attributes.push(CardAttribute.Special)
          break
        case 'Wisdom': attributes.push(CardAttribute.Wisdom)
          break
        default:
          console.log(`Unknown attribute: ${trimmed}`)
      }
    }

    return attributes
  }

  private static fetchPower($: CheerioAPI, element: any): number | undefined {
    const powerElement = element.find('dd>div.backCol>div.col2>div.power')
    if (powerElement.length === 0) {
      return undefined
    }

    const rawPower = this.stripHtmlTags(powerElement.html() || '')

    if (rawPower === '-') {
      return undefined
    }

    const power = Number.parseInt(rawPower, 10)
    if (Number.isNaN(power)) {
      throw new CardParseError(`Failed to parse power: ${rawPower}`)
    }

    return power
  }

  private static fetchCounter($: CheerioAPI, element: any): number | undefined {
    const counterElement = element.find('dd>div.backCol>div.col2>div.counter')
    if (counterElement.length === 0) {
      return undefined
    }

    const rawCounter = this.stripHtmlTags(counterElement.html() || '')

    if (rawCounter === '-') {
      return undefined
    }

    const counter = Number.parseInt(rawCounter, 10)
    if (Number.isNaN(counter)) {
      throw new CardParseError(`Failed to parse counter: ${rawCounter}`)
    }

    return counter
  }

  private static fetchTypes($: CheerioAPI, element: any): string[] {
    const typesElement = element.find('dd>div.backCol>div.feature')
    if (typesElement.length === 0) {
      return []
    }

    const rawTypes = this.stripHtmlTags(typesElement.html() || '')
    return rawTypes.split('/').map(type => type.trim()).filter(type => type.length > 0)
  }

  private static fetchEffect($: CheerioAPI, element: any): string {
    const effectElement = element.find('dd>div.backCol>div.text')
    if (effectElement.length === 0) {
      return ''
    }

    return this.stripHtmlTags(effectElement.html() || '')
  }

  private static fetchTrigger($: CheerioAPI, element: any): string | undefined {
    const triggerElement = element.find('dd>div.backCol>div.trigger')
    if (triggerElement.length === 0) {
      return undefined
    }

    const trigger = this.stripHtmlTags(triggerElement.html() || '')
    return trigger || undefined
  }

  private static stripHtmlTags(value: string): string {
    return value.replace(/<[^>]*>.*?<\/[^>]*>/g, '').trim()
  }
}
