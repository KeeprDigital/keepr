// Importing nothing, so the stand-in's Worker and a Node script read it alike.

/**
 * Text the stand-in's code carries into any bundle it is in: the prefix of
 * every key id it signs with (`standIn.ts`). Nothing else writes it, so a
 * built App Worker that holds it holds the stand-in (`bundleScan.mjs`).
 */
export const STAND_IN_BUNDLE_MARK = 'keepr-accounts-stand-in/never-in-an-app';
