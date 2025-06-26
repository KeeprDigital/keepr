import { useWebSocket } from '@vueuse/core'

const submissions = ref<any[]>([])
const stats = ref<any[]>([])
let wsInstance: ReturnType<typeof useWebSocket> | null = null

export function useCommanderWS() {
  const wsUrl = computed(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws/commander`
  })

  if (!wsInstance) {
    wsInstance = useWebSocket(wsUrl, {
      autoReconnect: {
        retries: 3,
        delay: 1000,
        onFailed() {
          console.error('Failed to connect to WebSocket after 3 retries')
        },
      },
      immediate: true,
    })
  }

  watch(wsInstance.data, (data) => {
    if (data) {
      const message = JSON.parse(data as string)
      if (message.type === 'update') {
        submissions.value = message.submissions
        stats.value = message.stats
      }
    }
  })

  const refresh = () => {
    wsInstance?.send(JSON.stringify({ type: 'refresh' }))
  }

  return {
    status: wsInstance.status,
    submissions: readonly(submissions),
    commanders: readonly(stats),
    connect: wsInstance.open,
    disconnect: wsInstance.close,
    refresh,
  }
}
