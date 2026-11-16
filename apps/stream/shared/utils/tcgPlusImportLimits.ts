/**
 * A TCG+ Import's request ceiling: a 512-player export is about 720 KiB as
 * text, so this leaves room for the largest field with its JSON wrapping.
 */
export const TCGPLUS_IMPORT_MAX_BODY_BYTES = 4 * 1024 * 1024;
