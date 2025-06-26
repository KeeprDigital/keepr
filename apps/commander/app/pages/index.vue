<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod/v4'

const schema = z.object({
  email: z.email('Invalid email'),
  commander: z.object({
    id: z.string(),
    name: z.string(),
    image: z.string(),
  }),
})

type Schema = z.output<typeof schema>

const commanderQuery = ref('')
const commanderQueryDebounced = refDebounced(commanderQuery, 200)
const isSubmitting = ref(false)
const cooldownActive = ref(false)
const cooldownTimeLeft = ref(0)
const COOLDOWN_DURATION = 10 * 60 * 1000 // 10 minutes in milliseconds

// Initialize state with email from localStorage if available
const state = reactive<Partial<Schema>>({
  email: undefined,
  commander: undefined,
})

// Load email and check cooldown on component mount
onMounted(() => {
  if (import.meta.client) {
    const savedEmail = localStorage.getItem('userEmail')
    if (savedEmail) {
      state.email = savedEmail
    }

    // Load saved commander
    const savedCommander = localStorage.getItem('currentCommander')
    if (savedCommander) {
      try {
        state.commander = JSON.parse(savedCommander)
      }
      catch (error) {
        console.warn('Failed to parse saved commander:', error)
      }
    }

    // Check if cooldown is active
    const lastSubmissionTime = localStorage.getItem('lastSubmissionTime')
    if (lastSubmissionTime) {
      const elapsedTime = Date.now() - Number.parseInt(lastSubmissionTime)
      if (elapsedTime < COOLDOWN_DURATION) {
        cooldownActive.value = true
        cooldownTimeLeft.value = Math.ceil((COOLDOWN_DURATION - elapsedTime) / 1000)
        startCooldownTimer()
      }
    }
  }
})

const toast = useToast()
const { refresh: refreshWS } = useCommanderWS()

function startCooldownTimer() {
  const timer = setInterval(() => {
    cooldownTimeLeft.value -= 1
    if (cooldownTimeLeft.value <= 0) {
      clearInterval(timer)
      cooldownActive.value = false
      // Clear the currently playing commander when timeout expires
      state.commander = undefined
    }
  }, 1000)
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  // Check if cooldown is active
  if (cooldownActive.value) {
    const minutes = Math.floor(cooldownTimeLeft.value / 60)
    const seconds = cooldownTimeLeft.value % 60
    toast.add({
      title: 'Cooldown Active',
      description: `Please wait ${minutes}m ${seconds}s before submitting again.`,
      color: 'warning',
    })
    return
  }

  try {
    isSubmitting.value = true

    // Submit form data to API
    await $fetch('/api/submit', {
      method: 'POST',
      body: event.data,
    })

    // Save email to localStorage
    if (import.meta.client && event.data.email) {
      localStorage.setItem('userEmail', event.data.email)

      // Set cooldown
      localStorage.setItem('lastSubmissionTime', Date.now().toString())
      cooldownActive.value = true
      cooldownTimeLeft.value = COOLDOWN_DURATION / 1000
      startCooldownTimer()
    }

    toast.add({
      title: 'Success',
      description: 'The form has been submitted.',
      color: 'success',
    })

    // Trigger WebSocket refresh to update all connected clients
    refreshWS()
  }
  catch (error) {
    toast.add({
      title: 'Error',
      description: 'Failed to submit the form. Please try again.',
      color: 'error',
    })
    console.error('Form submission error:', error)
  }
  finally {
    isSubmitting.value = false
  }
}

async function fetchCommanders() {
  const data = await $fetch('/api/typeahead', {
    params: { q: commanderQueryDebounced.value },
    immediate: false,
  })
  if (data.length !== 0) {
    return data.map(commander => ({
      label: commander.name,
      id: String(commander.id),
      name: commander.name,
      image: commander.image,
      avatar: { src: commander.image },
    }))
  }

  return data
}

const { data: commanders, status, execute } = useLazyAsyncData(
  () => fetchCommanders(),
  { immediate: false },
)

watch(commanderQueryDebounced, (newQuery) => {
  if (newQuery.length >= 3) {
    execute()
  }
  else {
    commanders.value = []
  }
}, { immediate: true })

// Save commander to localStorage when it changes
watch(() => state.commander, (newCommander) => {
  if (import.meta.client) {
    if (newCommander) {
      localStorage.setItem('currentCommander', JSON.stringify(newCommander))
    }
    else {
      localStorage.removeItem('currentCommander')
    }
  }
}, { deep: true })

// Format remaining time for display
const formattedCooldownTime = computed(() => {
  const minutes = Math.floor(cooldownTimeLeft.value / 60)
  const seconds = cooldownTimeLeft.value % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
})
</script>

<template>
  <section class="flex flex-col items-center justify-center h-screen p-4">
    <!-- Currently Selected Commander Display -->
    <div v-if="state.commander" class="mb-8 p-6 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow-md max-w-sm w-full">
      <h3 class="text-lg font-semibold mb-4 text-center text-gray-900 dark:text-white">
        Currently Playing
      </h3>
      <div class="flex flex-col items-center space-y-3">
        <div class="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
          <img
            :src="state.commander.image"
            :alt="state.commander.name"
            class="w-full h-full object-cover"
          >
        </div>
        <div class="text-center">
          <p class="font-medium text-gray-900 dark:text-white">
            {{ state.commander.name }}
          </p>
        </div>
      </div>
    </div>

    <UForm
      :schema="schema"
      :state="state"
      class="space-y-4 max-w-sm w-full"
      :validate-on="['input']"
      @submit="onSubmit"
    >
      <UFormField
        label="Email"
        name="email"
        size="xl"
        class="w-full"
      >
        <UInput
          v-model="state.email"
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="Commander"
        name="commander"
        size="xl"
        class="w-full"
      >
        <UInputMenu
          v-model="state.commander"
          v-model:search-term="commanderQuery"
          :items="commanders"
          :loading="status === 'pending'"
          ignore-filter
          reset-search-term-on-blur
          reset-search-term-on-select
          trailing-icon=""
          class="w-full"
        />
      </UFormField>

      <div v-if="cooldownActive" class="text-sm text-amber-600 text-center mb-2">
        Cooldown active: {{ formattedCooldownTime }} remaining
      </div>

      <UButton
        type="submit"
        size="xl"
        block
        variant="outline"
        :loading="isSubmitting"
        :disabled="cooldownActive || isSubmitting"
      >
        Submit
      </UButton>

      <div class="mt-4 text-center">
        <UButton to="/stats" variant="link" size="sm">
          View Commander Statistics
        </UButton>
      </div>
    </UForm>
  </section>
</template>
