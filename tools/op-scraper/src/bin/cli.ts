#!/usr/bin/env node
import process from 'node:process'
import { CLI } from '../cli/cli'

type ParsedArgs = {
  outputDir?: string
  verbose?: boolean
  downloadImages?: boolean
  filter?: string
  delay?: number
  uploadToD1?: boolean
  help?: boolean
  packsOnly?: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '-h':
      case '--help':
        parsed.help = true
        break
      case '-v':
      case '--verbose':
        parsed.verbose = true
        break
      case '-o':
      case '--output':
      case '--output-dir':
        parsed.outputDir = args[++i]
        break
      case '--images':
      case '--download-images':
        parsed.downloadImages = true
        break
      case '--filter':
        parsed.filter = args[++i]
        break
      case '--delay':
        parsed.delay = Number.parseInt(args[++i], 10)
        break
      case '--d1':
      case '--upload-to-d1':
        parsed.uploadToD1 = true
        break
      case '--packs-only':
        parsed.packsOnly = true
        break
      default:
        if (!arg.startsWith('-') && !parsed.outputDir) {
          parsed.outputDir = arg
        }
        break
    }
  }

  return parsed
}

function showHelp() {
  console.log(`
Usage: op-scraper [output-dir] [options]

Scrape One Piece TCG data and optionally upload to Cloudflare D1.

Arguments:
  [output-dir]             Directory to save data (default: ./data)

Options:
  --packs-only             Only fetch pack information (skip cards)
  --filter <pattern>       Only process packs matching pattern
  --images                 Download card images
  --d1                     Upload data to Cloudflare D1
  --delay <ms>             Delay between pack requests (default: 1000ms)
  -v, --verbose            Enable verbose logging
  -h, --help               Show this help

Examples:
  op-scraper                           # Scrape to ./data
  op-scraper --packs-only              # Only fetch pack list
  op-scraper ./my-data                 # Custom output directory
  op-scraper --images                  # Include card images
  op-scraper --d1                      # Also upload to D1
  op-scraper --filter "OP01"           # Only process OP01 pack
  op-scraper --filter "OP" --d1        # Process all OP packs and upload
  op-scraper ./data --images --d1      # Everything: files, images, and D1

The scraper will:
  • Download all pack and card data as JSON files
  • Create a combined all-cards.json file
  • Skip existing cards when uploading to D1
  • Show progress and detailed error reporting
`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(args.length === 0 ? 1 : 0)
  }

  const parsed = parseArgs(args)
  const outputDir = parsed.outputDir || './data'

  try {
    const cli = new CLI(parsed.verbose)

    await cli.run({
      outputDir,
      filter: parsed.filter,
      delay: parsed.delay,
      uploadToD1: parsed.uploadToD1,
      downloadImages: parsed.downloadImages,
      verbose: parsed.verbose,
      packsOnly: parsed.packsOnly,
    })
  }
  catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    if (parsed.verbose && error instanceof Error) {
      console.error('Stack trace:', error.stack)
    }
    process.exit(1)
  }
}

main().catch(console.error)
