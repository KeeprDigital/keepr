<script setup lang="ts">
import { acceptedReturnAddress } from '~~/shared/utils/returnAddress';

const route = useRoute();

/** Where the page that sent the User here asked them to be returned (`?returnTo=`). */
const requested = computed(() =>
	typeof route.query.returnTo === 'string' ? route.query.returnTo : undefined,
);
const returnAddress = computed(() =>
	acceptedReturnAddress(requested.value, window.location.origin),
);
const returnAddressRefused = computed(
	() => requested.value !== undefined && returnAddress.value === null,
);

const credentials = reactive({ email: '', password: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);

interface SignInFailure {
	statusCode?: number;
	data?: { code?: string; message?: string };
}

function refusalOf(failure: SignInFailure): string {
	if (failure.data?.code === 'BANNED_USER' && failure.data.message) return failure.data.message;
	if (failure.statusCode === 401) return 'That email and password do not match an account.';
	if (failure.statusCode === 429) return 'Too many attempts. Wait a few seconds and try again.';
	return 'Signing in failed. Try again.';
}

async function submit() {
	// One attempt at a time: a second would spend the rate limit the first is using.
	if (submitting.value) return;
	submitting.value = true;
	refusal.value = null;

	try {
		await $fetch('/api/auth/sign-in/email', {
			method: 'POST',
			body: { email: credentials.email, password: credentials.password },
		});
	} catch (failure) {
		refusal.value = refusalOf(failure as SignInFailure);
		return;
	} finally {
		submitting.value = false;
	}

	const destination = returnAddress.value ?? '/';
	await navigateTo(destination, { external: !destination.startsWith('/') });
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<UForm :state="credentials" @submit="submit">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">Sign in to Keepr</h1>

					<UAlert
						v-if="returnAddressRefused"
						data-return-address="refused"
						color="warning"
						variant="subtle"
						description="The link that brought you here pointed outside Keepr, so you will stay on Keepr Accounts after signing in."
					/>

					<UAlert
						v-if="refusal"
						data-refusal
						color="error"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:description="refusal"
					/>

					<UFormField name="email" label="Email">
						<UInput
							v-model="credentials.email"
							type="email"
							autofocus
							autocomplete="username"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField name="password" label="Password">
						<UInput
							v-model="credentials.password"
							type="password"
							autocomplete="current-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UButton type="submit" color="primary" block :loading="submitting">Sign in</UButton>

					<p class="text-center text-xs text-muted">
						People join Keepr by Invitation, from an Organisation they will work in.
					</p>
				</div>
			</UForm>
		</UCard>
	</div>
</template>
