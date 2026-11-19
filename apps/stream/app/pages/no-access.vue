<script setup lang="ts">
/**
 * What a signed-in User with no App access to Stream Keepr is shown, in place
 * of a shell of pages whose every request the Session boundary refuses 403.
 *
 * It reads nothing, so it stands for anyone: App access is granted in Keepr
 * Accounts, by an owner or admin of the User's Organisation, and a User in
 * several Organisations chooses the one they work in there. Both are a visit
 * to Keepr Accounts, which is all this page can offer.
 */
definePageMeta({
	title: 'No access',
	layout: false,
});

const { keeprAccountsOrigin } = useRuntimeConfig().public;
</script>

<template>
	<div class="min-h-screen flex items-center justify-center p-4">
		<UCard class="w-full max-w-md">
			<div class="flex flex-col gap-4" data-testid="no-app-access">
				<h1 class="text-lg font-semibold">You have no access to Stream Keepr</h1>
				<p class="text-sm text-muted">
					You are signed in, but the Organisation you are working in gives you no App access to
					Stream Keepr. Ask an owner or admin of your Organisation for it. If you belong to another
					Organisation that does, switch to it in Keepr Accounts.
				</p>
				<div class="flex flex-wrap gap-2">
					<UButton :to="String(keeprAccountsOrigin)" external color="primary">
						Open Keepr Accounts
					</UButton>
					<UButton to="/" external color="neutral" variant="soft">Try again</UButton>
				</div>
			</div>
		</UCard>
	</div>
</template>
