<script setup lang="ts">
import { NEW_PASSWORD_REFUSALS, refusalSentence } from '~/utils/refusal';
import { MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';

/**
 * Where the link the first-administrator command prints lands (ADR-0115). The
 * person standing up Keepr chooses a name and password, and becomes its first
 * Keepr Administrator. The claim is in the fragment, so no request line carries it.
 */

const claimId = ref<string | null>();
/** The address the claim is for, `null` once the server said it claims nothing. */
const email = ref<string | null>();

onMounted(async () => {
	claimId.value = new URLSearchParams(window.location.hash.slice(1)).get('claim') || null;
	if (!claimId.value) return;
	try {
		({ email: email.value } = await $fetch<{ email: string }>('/api/first-administrator/offer', {
			method: 'POST',
			body: { claimId: claimId.value },
		}));
	} catch {
		email.value = null;
	}
});

const form = reactive({ name: '', password: '', confirmation: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);

const mismatched = computed(
	() => form.confirmation.length > 0 && form.password !== form.confirmation,
);

const SPENT = 'This claim no longer works: a Keepr Administrator exists, or it was never written.';

async function claim() {
	if (submitting.value || !claimId.value || mismatched.value) return;
	submitting.value = true;
	refusal.value = null;
	try {
		await $fetch('/api/first-administrator/claim', {
			method: 'POST',
			body: { claimId: claimId.value, name: form.name, password: form.password },
		});
	} catch (failure) {
		refusal.value = refusalSentence(failure, {
			...NEW_PASSWORD_REFUSALS,
			codes: {
				...NEW_PASSWORD_REFUSALS.codes,
				CLAIM_NOT_FOUND: SPENT,
				KEEPR_ADMINISTRATOR_EXISTS: SPENT,
				NAME_REQUIRED: 'Enter your name.',
			},
			otherwise: 'Claiming failed. Try again.',
		});
		return;
	} finally {
		submitting.value = false;
	}
	// The claim is spent: it should not sit in the address bar or the history.
	window.history.replaceState(null, '', window.location.pathname);
	await navigateTo('/');
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<div v-if="claimId === null || email === null" data-no-claim class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">This link claims nothing</h1>
				<p class="text-sm text-muted">
					A Keepr Administrator exists already, or the claim was never written. Run the
					first-administrator command again if Keepr has none.
				</p>
			</div>

			<UForm v-else-if="email" :state="form" @submit="claim">
				<div class="flex flex-col gap-4">
					<div data-claim class="flex flex-col gap-2">
						<h1 class="text-lg font-semibold">Become Keepr's first administrator</h1>
						<p class="text-sm text-muted">
							Choose a name and password for {{ email }}. You will run the platform and own the
							Keepr organisation.
						</p>
					</div>

					<UAlert
						v-if="refusal"
						data-refusal
						color="error"
						variant="subtle"
						icon="i-lucide-triangle-alert"
						:description="refusal"
					/>

					<UFormField name="name" label="Your name">
						<UInput v-model="form.name" autocomplete="name" class="w-full" :disabled="submitting" />
					</UFormField>

					<UFormField
						name="password"
						label="Password"
						:help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
					>
						<UInput
							v-model="form.password"
							type="password"
							autocomplete="new-password"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField
						name="confirmation"
						label="Confirm password"
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
						Claim
					</UButton>
				</div>
			</UForm>
		</UCard>
	</div>
</template>
