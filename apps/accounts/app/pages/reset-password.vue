<script setup lang="ts">
import type { AuthFailure } from '~~/shared/utils/newPassword';
import { MIN_PASSWORD_LENGTH, newPasswordRefusal } from '~~/shared/utils/newPassword';

/**
 * Where an emailed reset link lands. The token is in the fragment, which no
 * request carries, so nothing between the browser and the Worker logs it; the
 * server decides whether it is still good.
 */
const token = ref<string | null>();

onMounted(() => {
	token.value = new URLSearchParams(window.location.hash.slice(1)).get('token') || null;
});

const form = reactive({ password: '', confirmation: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);
const done = ref(false);

const mismatched = computed(
	() => form.confirmation.length > 0 && form.password !== form.confirmation,
);

function refusalOf(failure: AuthFailure): string {
	if (failure.data?.code === 'INVALID_TOKEN')
		return 'This link has expired or has been used. Ask for a new one.';
	return newPasswordRefusal(failure) ?? 'Setting your password failed. Try again.';
}

async function submit() {
	// The link works once, so a second submission would only be refused.
	if (submitting.value || !token.value || mismatched.value) return;
	submitting.value = true;
	refusal.value = null;

	try {
		await $fetch('/api/auth/reset-password', {
			method: 'POST',
			body: { token: token.value, newPassword: form.password },
		});
	} catch (failure) {
		refusal.value = refusalOf(failure as AuthFailure);
		return;
	} finally {
		submitting.value = false;
	}

	// The link is spent: it should not sit in the address bar or the history.
	window.history.replaceState(null, '', window.location.pathname);
	done.value = true;
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<div v-if="done" data-reset class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">Password set</h1>
				<p class="text-sm text-muted">
					Sign in with your new password. Anywhere else your account was signed in has been signed
					out.
				</p>
				<UButton to="/sign-in" color="primary" block>Go to sign in</UButton>
			</div>

			<div v-else-if="token === null" data-no-token class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">This link is not complete</h1>
				<p class="text-sm text-muted">
					Open the link from your email as it is, or ask for a new one.
				</p>
				<UButton to="/forgot-password" color="neutral" variant="outline" block>
					Ask for a new link
				</UButton>
			</div>

			<UForm v-else :state="form" @submit="submit">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">Choose a new password</h1>

					<UAlert
						v-if="refusal"
						data-refusal
						color="error"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:description="refusal"
					/>

					<UFormField
						name="password"
						label="New password"
						:help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
					>
						<UInput
							v-model="form.password"
							type="password"
							autofocus
							autocomplete="new-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField
						name="confirmation"
						label="Confirm new password"
						:error="mismatched ? 'The two passwords do not match.' : undefined"
					>
						<UInput
							v-model="form.confirmation"
							type="password"
							autocomplete="new-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UButton
						type="submit"
						color="primary"
						block
						:loading="submitting"
						:disabled="form.password.length === 0 || mismatched"
					>
						Set password
					</UButton>
					<UButton to="/forgot-password" color="neutral" variant="link" block>
						Ask for a new link
					</UButton>
				</div>
			</UForm>
		</UCard>
	</div>
</template>
