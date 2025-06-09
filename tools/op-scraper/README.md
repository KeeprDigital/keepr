# OP Scraper

A streamlined scraper for One Piece Trading Card Game data with optional Cloudflare D1 upload support.

## Features

- 🎴 **Complete Card Data**: Scrape all One Piece TCG cards with full details
- 📦 **Pack Information**: Fetch all available packs/sets
- 🖼️ **Image Downloads**: Optionally download card images
- 🔍 **Filtering**: Process only specific packs using pattern matching
- 💾 **D1 Integration**: Optional upload to Cloudflare D1 database
- 📊 **Smart Updates**: Skip existing cards when uploading to D1
- ❌ **Error Recovery**: Detailed error reporting with automatic retry

## Usage

```bash
# Basic usage - scrape everything to ./data
op-scraper

# Only fetch pack list (no card data)
op-scraper --packs-only

# Custom output directory
op-scraper ./my-cards

# Download card images too
op-scraper --images

# Upload to Cloudflare D1
op-scraper --d1

# Filter specific packs
op-scraper --filter "OP01"       # Only OP01
op-scraper --filter "OP"         # All OP packs
op-scraper --filter "ST"         # All starter decks

# Combine options
op-scraper ./cards --filter "OP" --images --d1
```

### Options

| Option               | Description                         | Default   |
| -------------------- | ----------------------------------- | --------- |
| `[output-dir]`       | Directory to save data              | `./data`  |
| `--packs-only`       | Only fetch pack information         | `false`   |
| `--filter <pattern>` | Only process packs matching pattern | All packs |
| `--images`           | Download card images                | `false`   |
| `--d1`               | Upload to Cloudflare D1             | `false`   |
| `--delay <ms>`       | Delay between pack requests         | `1000`    |
| `-v, --verbose`      | Show detailed progress              | `false`   |

## Output Structure

When using `--packs-only`:

```
output-dir/
└── packs.json          # List of all packs
```

Full scrape:

```
output-dir/
├── packs.json          # List of all packs
├── packs/              # Individual pack data
│   ├── OP01.json       # Cards for pack OP01
│   ├── OP02.json       # Cards for pack OP02
│   └── ...
├── images/             # Card images (if --images)
│   ├── OP01-001.png
│   ├── OP01-002.png
│   └── ...
└── all-cards.json      # Combined file with all cards
```

## D1 Setup (Optional)

If you want to upload data to Cloudflare D1:

### 1. Configure Wrangler

Create `wrangler.toml`:

```toml
name = "op-scraper"
compatibility_date = "2024-06-09"

[[d1_databases]]
binding = "DB"
database_name = "op-tcg-cards"
database_id = "your-database-id"
migrations_dir = "./migrations"
```

### 2. Create Database

```bash
# Create D1 database
npm run d1:create

# Apply migrations
npm run d1:migrate
```

### 3. Use with Scraper

```bash
# Upload everything
op-scraper --d1

# Upload specific packs
op-scraper --filter "OP01" --d1
```

## Data Formats

### Pack Object

```json
{
  "id": "OP01",
  "rawTitle": "ROMANCE DAWN [OP-01]",
  "titleParts": {
    "title": "ROMANCE DAWN",
    "label": "OP-01"
  }
}
```

### Card Object

```json
{
  "id": "OP01-001",
  "packId": "OP01",
  "name": "Monkey.D.Luffy",
  "rarity": "L",
  "category": "LEADER",
  "imgUrl": "https://en.onepiece-cardgame.com/images/cardlist/...",
  "colors": ["red"],
  "cost": 0,
  "attributes": {
    "life": "5000",
    "power": "5000"
  },
  "power": 5000,
  "counter": null,
  "types": ["Supernovas", "Straw Hat Crew"],
  "effect": "[Activate: Main] [Once Per Turn] Give up to 1 of your opponent's Characters -2000 power during this turn.",
  "trigger": null
}
```

## Example Workflows

### Download Everything

```bash
op-scraper ./data --images
```

### Update D1 with New Packs

```bash
# Check what's new
op-scraper --filter "OP05" --d1

# Upload all new packs
op-scraper --d1
```

### Incremental Updates

```bash
# Day 1: Get first series
op-scraper --filter "OP01"

# Day 2: Add second series
op-scraper --filter "OP02"

# Later: Upload everything to D1
op-scraper --d1
```

## Performance

- Downloads are rate-limited to avoid overwhelming the source
- D1 uploads use batching for efficiency (100 cards per batch)
- Smart duplicate detection skips existing cards
- Progress bars show real-time status with `--verbose`

## Troubleshooting

### D1 Upload Issues

1. Ensure wrangler is authenticated: `wrangler login`
2. Check database exists: `wrangler d1 list`
3. Verify migrations: `npm run d1:migrate`

### Common Errors

- **No cards found**: Pack ID might be incorrect
- **D1 upload failed**: Check wrangler authentication
- **Rate limiting**: Increase `--delay` value

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode
npm run dev

# Type checking
npm run type-check
```

## License

MIT
