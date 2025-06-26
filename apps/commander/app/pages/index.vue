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

// Initialize state with email from localStorage if available
const state = reactive<Partial<Schema>>({
  email: undefined,
  commander: undefined,
})

// Load email from localStorage on component mount
onMounted(() => {
  if (import.meta.client) {
    const savedEmail = localStorage.getItem('userEmail')
    if (savedEmail) {
      state.email = savedEmail
    }
  }
})

const toast = useToast()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  // Save email to localStorage when form is submitted
  if (import.meta.client && event.data.email) {
    localStorage.setItem('userEmail', event.data.email)
  }

  toast.add({ title: 'Success', description: 'The form has been submitted.', color: 'success' })
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
</script>

<template>
  <section class="flex flex-col items-center justify-center h-screen">
    <UForm
      :schema="schema"
      :state="state"
      class="space-y-4 w-80"
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
      <UButton
        type="submit"
        size="xl"
        block
        variant="outline"
      >
        Submit
      </UButton>
    </UForm>
  </section>
</template>
