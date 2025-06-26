<script setup lang="ts">
const { data: stats, pending, error, refresh } = await useFetch('/api/stats/commanders', {
  query: {
    limit: 20,
  },
})

// Format the last played date
function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString()
}
</script>

<template>
  <section class="container mx-auto p-4 max-w-6xl">
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

    <div v-else-if="stats?.data && stats.data.length > 0" class="space-y-4">
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <UCard
          v-for="commander in stats.data"
          :key="commander.commander_id"
          class="hover:shadow-lg transition-shadow"
        >
          <div class="flex items-start space-x-4">
            <img
              :src="commander.commander_image"
              :alt="commander.commander_name"
              class="w-16 h-16 rounded-lg object-cover"
              @error="(e) => { if (e.target && 'src' in e.target) (e.target as any).src = '/empty.png' }"
            >
            <div class="flex-1">
              <h3 class="font-semibold text-lg">
                {{ commander.commander_name }}
              </h3>
              <div class="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  <UIcon name="i-heroicons-play" class="inline mr-1" />
                  Played {{ commander.play_count }} times
                </p>
                <p>
                  <UIcon name="i-heroicons-users" class="inline mr-1" />
                  {{ commander.unique_players }} unique players
                </p>
                <p v-if="commander.last_played" class="text-xs">
                  Last played: {{ formatDate(commander.last_played) }}
                </p>
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <div class="text-center mt-8">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Showing top {{ stats.data.length }} commanders
        </p>
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
