<script setup lang="ts">
import type { CommanderSubmission } from '../../shared/types/ws'

const { $ws } = useNuxtApp() as any
const submissions = ref<CommanderSubmission[]>([])
const isSubscribed = ref(false)

// Format timestamp to relative time
function formatRelativeTime(timestamp: number) {
  const now = Date.now() / 1000
  const diff = now - timestamp

  if (diff < 60)
    return 'just now'
  if (diff < 3600)
    return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)
    return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Subscribe to real-time updates
async function subscribe() {
  try {
    const socket = $ws.getCommanderSocket()

    // Subscribe to updates
    const success = await $ws.subscribe()
    if (success) {
      isSubscribed.value = true

      // Get initial recent submissions
      const recentSubmissions = await $ws.getRecentSubmissions()
      submissions.value = recentSubmissions

      // Listen for new submissions
      socket.on('newSubmission', (submission: CommanderSubmission) => {
        // Add to beginning and keep only 10
        submissions.value = [submission, ...submissions.value].slice(0, 10)
      })
    }
  }
  catch (error) {
    console.error('Failed to subscribe:', error)
  }
}

// Unsubscribe from updates
async function unsubscribe() {
  try {
    const socket = $ws.getCommanderSocket()

    await $ws.unsubscribe()
    isSubscribed.value = false

    // Remove event listeners
    socket.off('newSubmission')
  }
  catch (error) {
    console.error('Failed to unsubscribe:', error)
  }
}

onMounted(() => {
  subscribe()
})

onUnmounted(() => {
  if (isSubscribed.value) {
    unsubscribe()
  }
})
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
    <h3 class="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
      Recent Submissions
    </h3>

    <div v-if="submissions.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
      <p>No recent submissions yet</p>
    </div>

    <div v-else class="space-y-3">
      <TransitionGroup name="list" tag="div">
        <div
          v-for="submission in submissions"
          :key="submission.id"
          class="flex items-center space-x-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <img
            :src="submission.commander_image"
            :alt="submission.commander_name"
            class="w-12 h-12 rounded-lg object-cover"
            @error="(e) => { if (e.target && 'src' in e.target) (e.target as any).src = '/empty.png' }"
          >
          <div class="flex-1">
            <p class="font-medium text-gray-900 dark:text-white">
              {{ submission.commander_name }}
            </p>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ formatRelativeTime(submission.submitted_at) }}
            </p>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}
.list-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}
.list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
.list-move {
  transition: transform 0.3s ease;
}
</style>
