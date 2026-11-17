<script setup lang="ts">
const form = reactive({ email: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);
/** The address a link was asked for, once asked. */
const requested = ref<string | null>(null);

async function submit() {
	if (submitting.value) return;
	submitting.value = true;
	refusal.value = null;

	try {
		await $fetch('/api/auth/request-password-reset', {
			method: 'POST',
			body: { email: form.email },
		});
		requested.value = form.email;
	} catch (failure) {
		refusal.value =
			(failure as { statusCode?: number }).statusCode === 429
				? 'Too many attempts. Wait a minute and try again.'
				: 'Asking for a link failed. Try again.';
	} finally {
		submitting.value = false;
	}
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<!-- Said for every address: nobody learns from it whether an address has an account. -->
			<div v-if="requested" data-requested class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">Check your email</h1>
				<p class="text-sm text-muted">
					If <strong>{{ requested }}</strong> belongs to a Keepr account, a link to choose a new
					password is on its way. It works once, for an hour.
				</p>
				<UButton to="/sign-in" color="neutral" variant="outline" block>Back to sign in</UButton>
			</div>

			<UForm v-else :state="form" @submit="submit">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">Reset your password</h1>
					<p class="text-sm text-muted">
						Enter the email address you sign in with, and we will email you a link to choose a new
						password.
					</p>

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
							v-model="form.email"
							type="email"
							autofocus
							autocomplete="username"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UButton type="submit" color="primary" block :loading="submitting">
						Email me a link
					</UButton>
					<UButton to="/sign-in" color="neutral" variant="link" block>Back to sign in</UButton>
				</div>
			</UForm>
		</UCard>
	</div>
</template>
