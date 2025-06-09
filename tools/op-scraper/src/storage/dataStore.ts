import type { Card, Pack } from '../types'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class DataStore {
  constructor(private rootDir: string) { }

  private async ensureDirectoryExists(path: string): Promise<void> {
    if (!existsSync(path)) {
      await mkdir(path, { recursive: true })
      console.log(`📁 Created directory: ${path}`)
    }
  }

  private sanitizeFilename(filename: string): string {
    // Remove or replace invalid filename characters
    return filename
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim()
      .substring(0, 100) // Limit length
  }

  private generatePackFilename(pack: Pack): string {
    // Use format: "ID - Title" for uniqueness and readability
    const title = pack.titleParts.title || pack.rawTitle
    const safeName = this.sanitizeFilename(`${pack.id} - ${title}`)
    return `cards_${safeName}.json`
  }

  async writePacks(packs: Pack[]): Promise<void> {
    const jsonDir = join(this.rootDir, 'json')
    await this.ensureDirectoryExists(jsonDir)

    const packsPath = join(jsonDir, 'packs.json')
    const json = JSON.stringify(packs, null, 2)

    await writeFile(packsPath, json, 'utf-8')
    console.log(`💾 Wrote ${packs.length} packs to ${packsPath}`)
  }

  async writeCards(pack: Pack, cards: Card[]): Promise<void> {
    const jsonDir = join(this.rootDir, 'json')
    await this.ensureDirectoryExists(jsonDir)

    const filename = this.generatePackFilename(pack)
    const cardsPath = join(jsonDir, filename)
    const json = JSON.stringify(cards, null, 2)

    await writeFile(cardsPath, json, 'utf-8')
    console.log(`💾 Wrote ${cards.length} cards for pack ${pack.id} to ${filename}`)
  }

  async writeCombinedCards(allCards: Card[]): Promise<void> {
    const jsonDir = join(this.rootDir, 'json')
    await this.ensureDirectoryExists(jsonDir)

    const combinedPath = join(jsonDir, 'all-cards.json')
    const json = JSON.stringify(allCards, null, 2)

    await writeFile(combinedPath, json, 'utf-8')
    console.log(`💾 Wrote ${allCards.length} cards to combined file: ${combinedPath}`)
  }

  async writeImage(card: Card, imageData: ArrayBuffer): Promise<void> {
    // Organize images by pack
    const packImagesDir = join(this.rootDir, 'images', card.packId)
    await this.ensureDirectoryExists(packImagesDir)

    const filename = this.getImageFilename(card)
    const imagePath = join(packImagesDir, filename)

    await writeFile(imagePath, Buffer.from(imageData))
  }

  private getImageFilename(card: Card): string {
    const lastSlashPos = card.imgUrl.lastIndexOf('/')
    if (lastSlashPos === -1) {
      throw new Error(`Invalid image URL: ${card.imgUrl}`)
    }

    let filename = card.imgUrl.slice(lastSlashPos + 1)

    // Remove query parameters
    const questionMarkPos = filename.indexOf('?')
    if (questionMarkPos !== -1) {
      filename = filename.slice(0, questionMarkPos)
    }

    return filename
  }
}
