import type { AddAckToActions } from './ack'

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

// Server events (what the server can emit to clients)
export type CommanderServerEvents = {
  // When a new commander is submitted
  newSubmission: (data: CommanderSubmission) => void
  // When stats are updated
  statsUpdated: (data: StatsUpdate[]) => void
  // Recent submissions history
  recentSubmissions: (data: CommanderSubmission[]) => void
}

// Client events (what clients can emit to server)
export type CommanderClientEvents = {
  // Subscribe to real-time updates
  subscribe: () => void
  // Unsubscribe from updates
  unsubscribe: () => void
  // Request recent submissions
  getRecentSubmissions: () => void
}

// Enhanced client events with acknowledgments
export type CommanderClientEventsWithAck = AddAckToActions<CommanderClientEvents>
