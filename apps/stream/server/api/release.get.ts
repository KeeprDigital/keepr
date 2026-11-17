import { readReleaseIdentity } from '@keepr/nuxt-layer/server/utils/release';

/** The Release this Worker serves, which a deploy's verify requires (`RELEASE_PATH`). */
export default defineEventHandler((event) => readReleaseIdentity(useRuntimeConfig(event)));
