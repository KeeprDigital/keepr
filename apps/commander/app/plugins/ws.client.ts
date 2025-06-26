import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

export default defineNuxtPlugin(() => {
  let mainSocket: Socket | null = null
  let commanderSocket: Socket<CommanderServerEvents, CommanderClientEventsWithAck> | null = null

  function connect() {
    if (mainSocket && mainSocket.connected) {
      return
    }

    mainSocket = io()

    mainSocket.on('connect', () => {
      console.warn('Main socket connected')
      connectToCommanderNamespace()
    })

    mainSocket.on('disconnect', () => {
      console.warn('Main socket disconnected')
    })

    mainSocket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error)
    })
  }

  function connectToCommanderNamespace() {
    if (commanderSocket && commanderSocket.connected) {
      return
    }

    commanderSocket = io('/commander')

    commanderSocket.on('connect', () => {
      console.warn('Connected to commander namespace')
    })

    commanderSocket.on('connect_error', (error) => {
      console.error('Commander namespace connection error:', error)
    })
  }

  function disconnect() {
    if (commanderSocket) {
      commanderSocket.disconnect()
      commanderSocket = null
    }

    if (mainSocket) {
      mainSocket.disconnect()
      mainSocket = null
    }
  }

  function getCommanderSocket() {
    if (!commanderSocket || !commanderSocket.connected) {
      throw new Error('Commander socket not connected')
    }
    return commanderSocket
  }

  // Auto-connect on plugin initialization
  connect()

  const wsService = {
    connect,
    disconnect,
    getCommanderSocket,

    // Helper method to subscribe to updates
    async subscribe() {
      const socket = getCommanderSocket()
      return new Promise<boolean>((resolve) => {
        socket.emit('subscribe', (response) => {
          resolve(response.success)
        })
      })
    },

    // Helper method to unsubscribe from updates
    async unsubscribe() {
      const socket = getCommanderSocket()
      return new Promise<boolean>((resolve) => {
        socket.emit('unsubscribe', (response) => {
          resolve(response.success)
        })
      })
    },

    // Helper method to get recent submissions
    async getRecentSubmissions() {
      const socket = getCommanderSocket()
      return new Promise((resolve, reject) => {
        socket.emit('getRecentSubmissions', (response) => {
          if (response.success && 'submissions' in response) {
            resolve(response.submissions)
          }
          else {
            reject(new Error('error' in response ? response.error : 'Failed to get submissions'))
          }
        })
      })
    },
  }

  return {
    provide: {
      ws: wsService,
    },
  }
})
