import type { Ref } from 'vue';

const holdsByFlag = new WeakMap<Ref<boolean>, number>();

/**
 * Raises a loading flag for one request and answers its release. The flag
 * stays up while any request holding it is in flight, superseded ones
 * included, and falls once the last of them has released it. Releasing twice
 * counts once.
 */
export function holdLoading(flag: Ref<boolean>): () => void {
	holdsByFlag.set(flag, (holdsByFlag.get(flag) ?? 0) + 1);
	flag.value = true;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (holdsByFlag.get(flag) ?? 1) - 1;
		if (remaining > 0) holdsByFlag.set(flag, remaining);
		else holdsByFlag.delete(flag);
		flag.value = remaining > 0;
	};
}
