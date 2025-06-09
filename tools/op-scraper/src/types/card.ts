export enum CardAttribute {
  Slash = 'slash',
  Strike = 'strike',
  Ranged = 'ranged',
  Special = 'special',
  Wisdom = 'wisdom',
}

export enum CardCategory {
  Leader = 'leader',
  Character = 'character',
  Event = 'event',
  Stage = 'stage',
  Don = 'don',
}

export enum CardColor {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
  Purple = 'purple',
  Black = 'black',
  Yellow = 'yellow',
}

export enum CardRarity {
  Common = 'common',
  Uncommon = 'uncommon',
  Rare = 'rare',
  SuperRare = 'super_rare',
  SecretRare = 'secret_rare',
  Leader = 'leader',
  Special = 'special',
  TreasureRare = 'treasure_rare',
  Promo = 'promo',
}

export type Card = {
  id: string
  packId: string
  name: string
  rarity: CardRarity
  category: CardCategory
  imgUrl: string
  colors: CardColor[]
  cost?: number
  attributes: CardAttribute[]
  power?: number
  counter?: number
  types: string[]
  effect: string
  trigger?: string
}

export class CardParseError extends Error {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'CardParseError'
  }
}
