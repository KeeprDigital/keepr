import type { Card } from '../types'
import process from 'node:process'
import { OpScraper } from '../scraper/opScraper'
import { getD1Config } from '../storage/d1Config'
import { D1Store } from '../storage/d1Store'
import { DataStore } from '../storage/dataStore'
import { WranglerD1Client } from '../storage/wranglerD1Client'

export type CliOptions = {
  outputDir: string
  filter?: string
  delay?: number
  uploadToD1?: boolean
  downloadImages?: boolean
  verbose?: boolean
  packsOnly?: boolean
}

export class CLI {
  private scraper: OpScraper
  private verbose: boolean

  constructor(verbose = false) {
    this.scraper = new OpScraper()
    this.verbose = verbose
  }

  private log(message: string) {
    if (this.verbose) {
      console.error(`[DEBUG] ${message}`)
    }
  }

  private createProgressBar(percentage: number): string {
    const width = 30
    const filled = Math.round((percentage / 100) * width)
    const empty = width - filled
    return `[${'='.repeat(filled)}${' '.repeat(empty)}] ${percentage}%`
  }

  private async createD1Store(): Promise<D1Store> {
    const config = getD1Config()
    const client = new WranglerD1Client(config.databaseName)

    // Create store with progress callback
    return new D1Store(client, (progress) => {
      if (this.verbose) {
        const progressBar = this.createProgressBar(progress.percentage)
        process.stderr.write(`\r[D1 Upload] ${progressBar} ${progress.current}/${progress.total} (${progress.failed} failed)`)
      }
    })
  }

  async run(options: CliOptions): Promise<void> {
    console.log('🚀 Starting One Piece TCG data scraper...\n')

    const startTime = Date.now()

    // Initialize file store
    const fileStore = new DataStore(options.outputDir)
    const d1Store = options.uploadToD1 ? await this.createD1Store() : null

    if (d1Store) {
      console.log(`💾 Will upload to D1 database`)
    }
    console.log(`📁 Will save files to: ${options.outputDir}`)
    if (options.packsOnly) {
      console.log(`📦 Will only fetch pack information`)
    }
    else if (options.downloadImages) {
      console.log(`🖼️  Will download card images`)
    }
    console.log('')

    // Step 1: Get all packs
    this.log('Fetching all packs...')
    const allPacks = await this.scraper.fetchAllPacks()

    // Filter packs if requested
    const packs = options.filter
      ? allPacks.filter(pack => pack.id.includes(options.filter!))
      : allPacks

    console.log(`📦 Found ${packs.length} packs`)
    if (options.filter) {
      console.log(`🔍 Filtered to packs matching: ${options.filter}`)
    }

    // Save packs list
    await fileStore.writePacks(packs)
    console.log(`💾 Saved packs list to ${options.outputDir}`)

    // Upload packs to D1 if enabled
    if (d1Store) {
      console.log('\n💾 Uploading packs to D1...')
      try {
        const result = await d1Store.batchInsertPacks(packs)

        if (result.success) {
          console.log(`✅ Successfully uploaded all ${result.successfulUploads} packs to D1`)
        }
        else {
          console.log(`⚠️  Uploaded ${result.successfulUploads}/${result.totalAttempted} packs to D1`)
          console.log(`   Failed: ${result.failedUploads} packs`)
        }

        console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`)
      }
      catch (error) {
        console.error(`❌ Failed to upload packs to D1: ${error}`)
      }
    }

    // If packs only mode, stop here
    if (options.packsOnly) {
      const endTime = Date.now()
      const duration = Math.round((endTime - startTime) / 1000)

      console.log('\n🎉 Pack fetching complete!\n')
      console.log('📊 Summary:')
      console.log(`  • Fetched: ${packs.length} packs`)
      console.log(`  • Duration: ${duration}s`)
      console.log(`  • Data saved to: ${options.outputDir}`)
      console.log('\n✨ All done!')
      return
    }

    // Check for existing data to prevent unnecessary work
    let existingCardIds = new Set<string>()

    if (d1Store) {
      console.log('\n📊 Checking for existing data in D1...')
      try {
        existingCardIds = await d1Store.getExistingCardIds()
        console.log(`   Found ${existingCardIds.size} existing cards in D1`)

        if (existingCardIds.size === 0) {
          // Double-check with a count query
          const count = await d1Store.getCardCount()
          if (count > 0) {
            console.log(`   ⚠️  Warning: D1 has ${count} cards but getExistingCardIds returned empty set`)
            console.log(`   This may indicate a query issue - cards won't be skipped`)
          }
        }
        else {
          // Show sample of existing IDs for debugging
          const sampleIds = Array.from(existingCardIds).slice(0, 5)
          this.log(`Sample existing IDs: ${sampleIds.join(', ')}`)
        }
      }
      catch (error) {
        console.log(`   ❌ Could not check existing D1 data: ${error}`)
        console.log(`   Proceeding without skip detection`)
      }
    }

    console.log('')

    // Step 2: Process each pack
    let totalCards = 0
    let totalImages = 0
    let newCards = 0
    let skippedCards = 0
    const errors: Array<{ pack: string, error: string }> = []
    const allCards: Card[] = []
    const allCardIds = new Set<string>()
    const cardIdToPack = new Map<string, string>() // Track first pack for each card ID
    const duplicateIds = new Map<string, string[]>() // id -> [all packIds that have it]

    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i]
      const progress = `[${i + 1}/${packs.length}]`

      try {
        console.log(`${progress} Processing pack: ${pack.id} - ${pack.titleParts.title}`)

        // Get cards for this pack
        this.log(`Fetching cards for ${pack.id}...`)
        const cards = await this.scraper.fetchAllCards(pack.id)

        if (cards.length === 0) {
          console.log(`  ⚠️  No cards found for ${pack.id}`)
          continue
        }

        // Check for duplicate IDs
        for (const card of cards) {
          if (allCardIds.has(card.id)) {
            // This is a duplicate
            if (!duplicateIds.has(card.id)) {
              // First time seeing this duplicate
              const firstPack = cardIdToPack.get(card.id)!
              duplicateIds.set(card.id, [firstPack, pack.id])
            }
            else {
              // Already tracking this duplicate
              duplicateIds.get(card.id)!.push(pack.id)
            }
          }
          else {
            allCardIds.add(card.id)
            cardIdToPack.set(card.id, pack.id)
          }
        }

        // Filter out existing cards to avoid unnecessary uploads
        const cardsToProcess = d1Store
          ? cards.filter(card => !existingCardIds.has(card.id))
          : cards

        const skippedInPack = cards.length - cardsToProcess.length
        if (d1Store && skippedInPack > 0) {
          console.log(`  📊 Skipping ${skippedInPack} existing cards`)
          skippedCards += skippedInPack
        }

        // Save to files
        await fileStore.writeCards(pack, cards)

        // Upload to D1 if enabled
        if (d1Store && cardsToProcess.length > 0) {
          this.log(`Uploading ${cardsToProcess.length} new cards to D1...`)

          try {
            const uploadResult = await d1Store.batchInsertCards(cardsToProcess)

            if (this.verbose) {
              console.log('') // New line after progress bar
            }

            if (uploadResult.success) {
              console.log(`  ✅ Successfully uploaded all ${uploadResult.successfulUploads} cards`)
              newCards += uploadResult.successfulUploads
            }
            else {
              console.log(`  ⚠️  Uploaded ${uploadResult.successfulUploads}/${uploadResult.totalAttempted} cards`)
              newCards += uploadResult.successfulUploads

              if (uploadResult.failedItems.length > 0 && uploadResult.failedItems.length <= 5) {
                console.log('  ❌ Failed cards:')
                uploadResult.failedItems.forEach(({ item, error }) => {
                  const cardItem = item as Card
                  console.log(`     - ${cardItem.id} (${cardItem.name}): ${error}`)
                })
              }
              else if (uploadResult.failedItems.length > 5) {
                console.log(`  ❌ ${uploadResult.failedItems.length} cards failed to upload`)
              }

              errors.push({
                pack: pack.id,
                error: `Failed to upload ${uploadResult.failedItems.length} cards`,
              })
            }

            console.log(`  ⏱️  Upload duration: ${(uploadResult.duration / 1000).toFixed(2)}s`)
          }
          catch (error) {
            console.error(`  ❌ Failed to upload cards for ${pack.id} to D1: ${error}`)
            errors.push({ pack: pack.id, error: `D1 upload failed: ${error}` })
          }
        }
        else if (d1Store && cardsToProcess.length === 0) {
          console.log(`  ✅ All ${cards.length} cards already exist in D1`)
        }

        allCards.push(...cards)
        totalCards += cards.length

        const statusMsg = d1Store && skippedInPack > 0
          ? `${cards.length} cards (${cardsToProcess.length} new, ${skippedInPack} existing)`
          : `${cards.length} cards`

        console.log(`  ✅ Processed ${statusMsg}`)

        // Download images if requested
        if (options.downloadImages) {
          console.log(`  🖼️  Downloading ${cards.length} images...`)

          for (let j = 0; j < cards.length; j++) {
            const card = cards[j]

            try {
              const imageData = await this.scraper.downloadCardImage(card)
              await fileStore.writeImage(card, imageData)
              totalImages++

              if (this.verbose) {
                console.log(`    📸 Downloaded ${card.id} (${j + 1}/${cards.length})`)
              }
            }
            catch (imgError) {
              console.error(`    ❌ Failed to download image for ${card.id}: ${imgError}`)
            }
          }

          console.log(`  ✅ Downloaded ${totalImages} images`)
        }
      }
      catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`  ❌ Failed to process ${pack.id}: ${errorMsg}`)
        errors.push({ pack: pack.id, error: errorMsg })
      }

      // Rate limiting delay
      if (i < packs.length - 1) {
        const delay = options.delay || 1000
        this.log(`Waiting ${delay}ms before next pack...`)
        await this.sleep(delay)
      }

      console.log('')
    }

    // Save combined cards file
    console.log('💾 Saving combined cards file...')
    await fileStore.writeCombinedCards(allCards)
    console.log(`✅ Saved ${allCards.length} cards to combined file\n`)

    // Report duplicate IDs if found
    if (duplicateIds.size > 0) {
      console.log('\n⚠️  Found duplicate card IDs across packs:')
      duplicateIds.forEach((packIds, cardId) => {
        console.log(`  • Card ${cardId} appears in packs: ${packIds.join(', ')}`)
      })
      console.log(`  This explains why D1 has fewer rows than total cards`)
    }

    // Summary
    const endTime = Date.now()
    const duration = Math.round((endTime - startTime) / 1000)

    console.log('\n🎉 Scraping complete!\n')
    console.log('📊 Summary:')
    console.log(`  • Processed: ${packs.length} packs`)
    console.log(`  • Total cards: ${totalCards}`)
    console.log(`  • Unique card IDs: ${allCardIds.size}`)

    if (d1Store) {
      console.log(`  • New cards uploaded to D1: ${newCards}`)
      console.log(`  • Existing cards skipped: ${skippedCards}`)

      // Get final counts to verify
      try {
        const finalCardCount = await d1Store.getCardCount()
        console.log(`  • Total cards in D1: ${finalCardCount}`)
      }
      catch (error) {
        this.log(`Could not get final D1 count: ${error}`)
      }
    }

    if (options.downloadImages) {
      console.log(`  • Total images downloaded: ${totalImages}`)
    }

    console.log(`  • Errors: ${errors.length}`)
    console.log(`  • Duration: ${duration}s`)
    console.log(`  • Data saved to: ${options.outputDir}`)

    console.log('')

    if (errors.length > 0) {
      console.log('❌ Errors encountered:')
      for (const error of errors) {
        console.log(`  • ${error.pack}: ${error.error}`)
      }
      console.log('')
    }

    console.log('✨ All done! Enjoy your One Piece TCG data!')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
