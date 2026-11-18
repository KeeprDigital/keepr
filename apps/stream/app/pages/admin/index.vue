<script setup lang="ts">
// `/admin` opens the Operations Cockpit (#1300). The redirect resolves before
// any route middleware, so the page gate meets the cockpit's own path.
definePageMeta({
	redirect: '/admin/graphics-assets',
});
</script>

<template>
	<div />
</template>
