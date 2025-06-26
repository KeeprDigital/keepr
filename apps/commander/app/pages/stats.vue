<script setup lang="ts">
type Commander = {
  commander_id: string
  commander_name: string
  commander_image: string
  play_count: number
  unique_players: number
  last_played?: number
}

type StatsResponse = {
  success: boolean
  data: Commander[]
  pagination: {
    limit: number
    offset: number
    total: number
  }
}

const { data: stats, pending, error, refresh } = await useFetch<StatsResponse>('/api/stats/commanders', {
  query: {
    limit: 20,
  },
})

const { $ws } = useNuxtApp() as any

// Subscribe to real-time stats updates
onMounted(async () => {
  try {
    const socket = $ws.getCommanderSocket()
    await $ws.subscribe()

    // Listen for stats updates
    socket.on('statsUpdated', (updatedStats: StatsUpdate[]) => {
      if (stats.value) {
        stats.value.data = updatedStats
      }
    })
  }
  catch (error) {
    console.error('Failed to subscribe to updates:', error)
  }
})

// Unsubscribe on unmount
onUnmounted(async () => {
  try {
    const socket = $ws.getCommanderSocket()
    socket.off('statsUpdated')
    await $ws.unsubscribe()
  }
  catch (error) {
    console.error('Failed to unsubscribe:', error)
  }
})
</script>

<template>
  <section class="p-4">
    <h1 class="text-3xl font-bold mb-8 text-center">
      Commander Play Statistics
    </h1>

    <div v-if="pending" class="flex justify-center">
      <UIcon name="i-heroicons-arrow-path" class="animate-spin h-8 w-8" />
    </div>

    <div v-else-if="error" class="text-center text-red-500">
      <p>Failed to load statistics</p>
      <UButton class="mt-4" @click="() => refresh()">
        Retry
      </UButton>
    </div>

    <div v-else-if="stats?.data && stats.data.length > 0" class="grid gap-8 lg:grid-cols-2">
      <!-- Recent Submissions Section -->
      <RecentSubmissions />

      <!-- Bar Chart Section -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <CommanderBarChart :commanders="stats.data" />
      </div>
    </div>

    <div v-else class="text-center text-gray-500">
      <p>No commander statistics available yet.</p>
      <p class="mt-2">
        Start playing to see statistics!
      </p>
    </div>

    <div class="mt-8 text-center">
      <UButton to="/" variant="outline">
        Back to Form
      </UButton>
    </div>
  </section>
</template>
