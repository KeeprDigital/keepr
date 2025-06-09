-- Create packs table
CREATE TABLE IF NOT EXISTS packs (
  id TEXT PRIMARY KEY,
  raw_title TEXT NOT NULL,
  title_parts TEXT NOT NULL, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create cards table
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  category TEXT NOT NULL,
  img_url TEXT NOT NULL,  -- Full URL directly
  colors TEXT, -- JSON array
  cost INTEGER,
  attributes TEXT, -- JSON array
  power INTEGER,
  counter INTEGER,
  types TEXT, -- JSON array
  effect TEXT NOT NULL DEFAULT '',
  trigger TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pack_id) REFERENCES packs(id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_cards_pack_id ON cards(pack_id);
CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
CREATE INDEX IF NOT EXISTS idx_packs_created_at ON packs(created_at);
CREATE INDEX IF NOT EXISTS idx_cards_created_at ON cards(created_at);
