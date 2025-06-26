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

  watch(wsInstance.data, async (data) => {
    if (data) {
      const message = JSON.parse(data as string)

      if (message.type === 'connected') {
        // Fetch initial data when connected
        await fetchData()
      }
      else if (message.type === 'refresh') {
        // Fetch fresh data when refresh signal received
        await fetchData()
      }
    }
  })

  // Fetch data from API endpoints
  async function fetchData() {
    try {
      const [submissionsRes, statsRes] = await Promise.all([
        $fetch('/api/stats/recent-submissions'),
        $fetch<{ data: any[] }>('/api/stats/commanders'),
      ])

      submissions.value = submissionsRes as any[]
      stats.value = statsRes.data || []
    }
    catch (error) {
      console.error('[ws] Failed to fetch data:', error)
    }
  }

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
