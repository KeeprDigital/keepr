<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod/v4'

const schema = z.object({
  email: z.email('Invalid email'),
  commander: z.string().min(1, 'Commander name is required'),
})

type Schema = z.output<typeof schema>

const commanderQuery = ref('')
const commanderQueryDebounced = refDebounced(commanderQuery, 200)

const state = reactive<Partial<Schema>>({
  email: undefined,
  commander: undefined,
})

const toast = useToast()

async function onSubmit(_event: FormSubmitEvent<Schema>) {
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
      class="space-y-4"
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

      <UFormField label="Commander" name="commander" size="xl">
        <UInputMenu
          v-model="state.commander"
          v-model:search-term="commanderQuery"
          :items="commanders"
          :loading="status === 'pending'"
          ignore-filter
          reset-search-term-on-blur
          reset-search-term-on-select
          value-key="id"
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
