import { useCountdown, useStorage } from '@vueuse/core'

export const useOpCardStore = defineStore('OpCard', () => {
  const toast = useToast()
  const configStore = useConfigStore()
  const timeout = useCountdown(0)
  const selectionHistory = useStorage<OpCard[]>('opCard-history', [])

  const previewCard = ref<OpCard | null>(null)
  const previewCardPrintings = ref<OpCard[]>([])

  const activeCard = ref<OpCard | null>(null)

  const searching = ref(false)
  const searchResults = ref<OpCard[]>([])
  const selectedColour = ref('any')
  const selectedCost = ref<number | null>(null)

  const { optimisticEmit } = useWS({
    topic: 'opCard',
    serverEvents: {
      connected: (data) => {
        activeCard.value = data
        updateTimeout(data)
      },
      sync: (data) => {
        activeCard.value = data
        updateTimeout(data)
      },
    },
  })

  function updateTimeout(cardData: OpCard | null) {
    if (!cardData || !cardData.timeoutData) {
      timeout.reset()
      return
    }

    const { timeoutStartTimestamp, timeoutDuration } = cardData.timeoutData

    const elapsedMs = Date.now() - timeoutStartTimestamp
    const remainingMs = (timeoutDuration) - elapsedMs

    if (remainingMs <= 0) {
      timeout.reset()
      return
    }

    const remainingSeconds = Math.round(remainingMs / 1000)

    timeout.start(remainingSeconds)
  }

  async function searchFuzzyCardName(name: string) {
    searching.value = true
    if (name.length < 3) {
      clearSearch()
      return
    }

    await $fetch<OpCardAPIData>('https://api.keepr.digital/op/cards', {
      query: {
        name,
        cost: selectedCost.value ?? undefined,
        color: selectedColour.value === 'any' ? undefined : selectedColour.value,
      },
    }).then((data) => {
      if (!data) {
        searchResults.value = []
        return
      }
      searchResults.value = data.data
    }).catch((error) => {
      console.error(error)
      searchResults.value = []
    }).finally(() => {
      searching.value = false
    })
  }

  async function selectPreviewCard(cardData: OpCard) {
    previewCard.value = cardData
    previewCardPrintings.value = []
    pushToHistory(cardData)
  }

  function controlPreviewCard(action: OpPreviewCardAction) {
    if (!previewCard.value)
      return

    if (action === 'show') {
      const action = activeCard.value ? 'replaced' : 'set'
      const cardData = previewCard.value

      cardData.timeoutData = {
        timeoutDuration: configStore.overlay.cardTimeout,
        timeoutStartTimestamp: Date.now(),
      }

      optimisticEmit('set', {
        initialState: activeCard.value,
        action: () => {
          activeCard.value = JSON.parse(JSON.stringify(previewCard.value))

          if (configStore.overlay.clearPreviewOnShow)
            previewCard.value = null

          updateTimeout(activeCard.value)

          return previewCard.value
        },
        onSuccess: () => {
          toast.add({
            title: `Card ${action}`,
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: `Card could not be ${action}`,
            color: 'error',
          })
        },
        rollback: (initialState, previousCard) => {
          activeCard.value = initialState
          if (configStore.overlay.clearPreviewOnShow && previousCard)
            previewCard.value = previousCard
        },
      }, cardData)
    }
  }

  function controlActiveCard(action: OpActiveCardAction) {
    switch (action) {
      case 'clear':
        optimisticEmit('control', {
          initialState: activeCard.value,
          action: () => activeCard.value = null,
          onSuccess: () => {
            toast.add({
              title: 'Card cleared',
              color: 'success',
            })
          },
          onError: () => {
            toast.add({
              title: 'Error',
              description: 'The card could not be cleared',
              color: 'error',
            })
          },
          rollback: initialState => activeCard.value = initialState,
        }, action)
        break
    }
  }

  function pushToHistory(cardData: OpCard) {
    const existingIndex = selectionHistory.value.findIndex(card => card.id === cardData.id)
    if (existingIndex !== -1) {
      selectionHistory.value.splice(existingIndex, 1)
    }
    const cardCopy = JSON.parse(JSON.stringify(cardData))
    selectionHistory.value.unshift(cardCopy)
  }

  function clearSearch() {
    selectedColour.value = 'any'
    selectedCost.value = null
  }

  function clearHistory() {
    selectionHistory.value = []
  }

  return {
    searchFuzzyCardName,
    selectPreviewCard,
    clearSearch,
    pushToHistory,
    clearHistory,
    controlPreviewCard,
    controlActiveCard,
    selectedColour,
    selectedCost,
    previewCard,
    previewCardPrintings,
    activeCard,
    searching,
    searchResults,
    timeout,
    selectionHistory,
  }
})
