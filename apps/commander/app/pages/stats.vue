<script setup lang="ts">
</script>

<template>
  <section class="p-4">
    <h1 class="text-3xl font-bold mb-8 text-center">
      Commander Play Statistics
    </h1>

    <div class="grid gap-8 lg:grid-cols-2">
      <!-- Recent Submissions Section -->
      <RecentSubmissions />

      <!-- Bar Chart Section -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <CommanderBarChart />
      </div>
    </div>

    <div class="mt-8 text-center">
      <UButton to="/" variant="outline">
        Back to Form
      </UButton>
    </div>
  </section>
</template>
