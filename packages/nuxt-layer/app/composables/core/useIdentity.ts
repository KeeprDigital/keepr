import type { AppId } from '../../../shared/utils/appRegistry';
import type { PageIdentity } from '../../../shared/utils/identityProof';
import { readonly } from 'vue';
import { IDENTITY_PATH, signInAddress } from '../../../shared/utils/identityProof';

/**
 * Who the visitor is, as the App's own "who am I" route (`IDENTITY_PATH`) says.
 * A signed-out visitor is sent to Keepr Accounts to sign in, and returned to the
 * page they were on; any other refusal is the caller's to show.
 */
export function useIdentity<App extends AppId = AppId>() {
	const identity = useState<PageIdentity<App> | null>('keeprIdentity', () => null);
	const { keeprAccountsOrigin } = useRuntimeConfig().public;

	async function load(): Promise<PageIdentity<App> | null> {
		try {
			identity.value = await $fetch<PageIdentity<App>>(IDENTITY_PATH);
		} catch (error) {
			if ((error as { statusCode?: unknown }).statusCode !== 401) throw error;
			identity.value = null;
			await navigateTo(signInAddress(String(keeprAccountsOrigin), window.location.href), {
				external: true,
			});
		}
		return identity.value;
	}

	return { identity: readonly(identity), load };
}
