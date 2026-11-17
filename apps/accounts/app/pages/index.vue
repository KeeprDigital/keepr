<script setup lang="ts">
interface SignedIn {
	user: { name: string; email: string };
}

/** Who is signed in here, or `null` once known that nobody is. */
const signedIn = ref<SignedIn | null>();
const signingOut = ref(false);

onMounted(async () => {
	signedIn.value = await $fetch<SignedIn | null>('/api/auth/get-session');
	if (!signedIn.value) await navigateTo('/sign-in');
});

async function signOut() {
	signingOut.value = true;
	try {
		await $fetch('/api/auth/sign-out', { method: 'POST', body: {} });
	} finally {
		signingOut.value = false;
	}
	await navigateTo('/sign-in');
}
</script>

<template>
	<UContainer class="flex min-h-screen flex-col justify-center gap-6 py-16">
		<h1 class="text-3xl font-semibold text-highlighted">Keepr Accounts</h1>
		<div v-if="signedIn" data-signed-in class="flex flex-col gap-4">
			<p>
				Signed in as <strong>{{ signedIn.user.name }}</strong>
				<span class="text-muted">({{ signedIn.user.email }})</span>
			</p>
			<div>
				<UButton color="neutral" variant="outline" :loading="signingOut" @click="signOut">
					Sign out
				</UButton>
			</div>
		</div>
	</UContainer>
</template>
