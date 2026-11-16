<script setup lang="ts">
import { ENGINE_VERSION as pairingVersion } from '@keepr/pairing';
import { ENGINE_VERSION as standingsVersion } from '@keepr/standings';

// The app is not built yet. This page shows that it runs, and on which engines.
const engines = [
	{ id: 'pairing', name: 'Pairing Engine', version: pairingVersion },
	{ id: 'standings', name: 'Standings Engine', version: standingsVersion },
];
</script>

<template>
	<UContainer class="flex min-h-screen flex-col justify-center gap-6 py-16">
		<div class="flex flex-col gap-2">
			<h1 class="text-3xl font-semibold text-highlighted">Score Keepr</h1>
			<p class="text-muted">Runs a tournament from pairings to final standings. Not built yet.</p>
		</div>
		<dl class="flex flex-col gap-2">
			<div
				v-for="engine in engines"
				:key="engine.id"
				:data-engine="engine.id"
				class="flex items-center gap-3"
			>
				<dt class="text-toned">{{ engine.name }}</dt>
				<dd><UBadge color="primary" variant="subtle">{{ engine.version }}</UBadge></dd>
			</div>
		</dl>
	</UContainer>
</template>
