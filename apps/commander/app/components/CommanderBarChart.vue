<script setup lang="ts">
import {
  BarElement,
  CategoryScale,
  type ChartData,
  Chart as ChartJS,
  type ChartOptions,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from 'chart.js'
import { Bar } from 'vue-chartjs'

const props = defineProps<{
  commanders: Commander[]
}>()

// Register Chart.js components
ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

type Commander = {
  commander_name: string
  commander_image: string
  play_count: number
}

// Get top 10 commanders
const topCommanders = computed(() => props.commanders.slice(0, 10))

// Prepare chart data
const chartData = computed<ChartData<'bar'>>(() => {
  return {
    labels: topCommanders.value.map((_, index) => `${index + 1}`),
    datasets: [
      {
        label: 'Times Played',
        backgroundColor: '#3b82f6',
        borderColor: '#2563eb',
        borderWidth: 1,
        data: topCommanders.value.map(c => c.play_count),
      },
    ],
  }
})

// Chart options
const chartOptions = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    title: {
      display: true,
      text: 'Top 10 Most Played Commanders',
      font: {
        size: 18,
        weight: 'bold',
      },
      padding: {
        bottom: 20,
      },
    },
    tooltip: {
      callbacks: {
        title: (tooltipItems) => {
          if (!tooltipItems.length || !tooltipItems[0])
            return ''
          const index = tooltipItems[0].dataIndex
          return topCommanders.value[index]?.commander_name || ''
        },
        label: (context) => {
          return `Played: ${context.parsed.y} times`
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        display: false, // Hide the x-axis labels since we'll show images
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        stepSize: 1,
      },
      grid: {
        color: 'rgba(0, 0, 0, 0.1)',
      },
    },
  },
  layout: {
    padding: {
      bottom: 80, // Add padding for the images
    },
  },
}))

// Handle dark mode
const colorMode = useColorMode()

watchEffect(() => {
  if (colorMode.value === 'dark') {
    // Update colors for dark mode
    if (chartOptions.value.plugins?.title) {
      chartOptions.value.plugins.title.color = '#ffffff'
    }
    if (chartOptions.value.scales?.x) {
      chartOptions.value.scales.x.ticks = {
        ...chartOptions.value.scales.x.ticks,
        display: false,
        color: '#9ca3af',
      }
    }
    if (chartOptions.value.scales?.y) {
      chartOptions.value.scales.y.ticks = {
        ...chartOptions.value.scales.y.ticks,
        color: '#9ca3af',
      }
      chartOptions.value.scales.y.grid = {
        color: 'rgba(255, 255, 255, 0.1)',
      }
    }
  }
  else {
    // Light mode colors
    if (chartOptions.value.plugins?.title) {
      chartOptions.value.plugins.title.color = '#000000'
    }
    if (chartOptions.value.scales?.x) {
      chartOptions.value.scales.x.ticks = {
        ...chartOptions.value.scales.x.ticks,
        display: false,
        color: '#4b5563',
      }
    }
    if (chartOptions.value.scales?.y) {
      chartOptions.value.scales.y.ticks = {
        ...chartOptions.value.scales.y.ticks,
        color: '#4b5563',
      }
      chartOptions.value.scales.y.grid = {
        color: 'rgba(0, 0, 0, 0.1)',
      }
    }
  }
})
</script>

<template>
  <div class="w-full">
    <div class="relative">
      <!-- Chart Container -->
      <div class="h-[400px]">
        <Bar
          :data="chartData"
          :options="chartOptions"
        />
      </div>

      <!-- Commander Images Row -->
      <div class="absolute bottom-0 left-0 right-0 flex items-end pointer-events-none" style="padding-left: 50px; padding-right: 12px; padding-bottom: 20px;">
        <div
          v-for="commander in topCommanders"
          :key="commander.commander_name"
          class="flex flex-col items-center justify-center"
          :style="{
            width: `${100 / topCommanders.length}%`,
          }"
        >
          <div class="relative group pointer-events-auto">
            <img
              :src="commander.commander_image"
              :alt="commander.commander_name"
              class="w-12 h-12 rounded-lg object-cover border-2 border-gray-300 dark:border-gray-600 shadow-md hover:scale-110 transition-transform cursor-pointer"
              :title="commander.commander_name"
              @error="(e) => { if (e.target && 'src' in e.target) (e.target as any).src = '/empty.png' }"
            >
            <!-- Hover tooltip -->
            <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
              {{ commander.commander_name }}
              <div class="text-xs opacity-75">
                {{ commander.play_count }} plays
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
