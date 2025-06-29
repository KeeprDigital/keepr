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

const { commanders } = useCommanderWS()

// Register Chart.js components
ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const topCommanders = computed(() => commanders.value.slice(0, 10))

// Prepare chart data for horizontal bar
const chartData = computed<ChartData<'bar'>>(() => {
  return {
    labels: topCommanders.value.map(c => c.commander_name),
    datasets: [
      {
        label: 'Times Played',
        backgroundColor: '#3b82f6',
        borderColor: '#2563eb',
        borderWidth: 1,
        data: topCommanders.value.map(c => c.play_count),
        barThickness: 30,
      },
    ],
  }
})

// Chart options for horizontal layout
const chartOptions = computed<ChartOptions<'bar'>>(() => ({
  indexAxis: 'y', // This makes the bar chart horizontal
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
        label: (context) => {
          return `Played: ${context.parsed.x} times`
        },
      },
    },
  },
  scales: {
    x: {
      beginAtZero: true,
      ticks: {
        stepSize: 1,
      },
      grid: {
        color: 'rgba(0, 0, 0, 0.1)',
      },
    },
    y: {
      grid: {
        display: false,
      },
      ticks: {
        display: false, // Hide labels as we'll show custom ones with images
      },
    },
  },
  layout: {
    padding: {
      left: 200, // Space for images and names
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
        stepSize: 1,
        color: '#9ca3af',
      }
      chartOptions.value.scales.x.grid = {
        color: 'rgba(255, 255, 255, 0.1)',
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
        stepSize: 1,
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
  <div class="w-full h-full">
    <div class="relative h-full">
      <!-- Chart Container -->
      <div class="h-full min-h-[400px]">
        <Bar
          :data="chartData"
          :options="chartOptions"
        />
      </div>

      <!-- Commander Labels (Images + Names) -->
      <div
        class="absolute left-0 flex flex-col pointer-events-none"
        :style="{
          width: '190px',
          top: '70px', // Account for title and top padding
          bottom: '40px', // Account for x-axis and bottom padding
        }"
      >
        <div
          v-for="(commander, index) in topCommanders"
          :key="commander.commander_name"
          class="flex items-center space-x-3 pointer-events-auto"
          :style="{
            position: 'absolute',
            top: `${(index / topCommanders.length) * 100}%`,
            height: `${100 / topCommanders.length}%`,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
          }"
        >
          <img
            :src="commander.commander_image"
            :alt="commander.commander_name"
            class="w-10 h-10 rounded-lg object-cover border border-gray-300 dark:border-gray-600 shadow-sm"
          >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
              {{ commander.commander_name }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ commander.play_count }} plays
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
