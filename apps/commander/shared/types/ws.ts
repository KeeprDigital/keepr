// Commander submission data
export type CommanderSubmission = {
  id: number
  email: string
  commander_id: string
  commander_name: string
  commander_image: string
  submitted_at: number
}

// Stats update data
export type StatsUpdate = {
  commander_id: string
  commander_name: string
  commander_image: string
  play_count: number
  unique_players: number
  last_played: number
}

// WebSocket message types
export type WSMessage
  = | { type: 'recentSubmissions', data: CommanderSubmission[] }
    | { type: 'newSubmission', data: CommanderSubmission }
    | { type: 'statsUpdated', data: StatsUpdate[] }
    | { type: 'getRecentSubmissions' }
