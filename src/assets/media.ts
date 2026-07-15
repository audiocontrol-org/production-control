/**
 * Extension → media type, for the stand-in `pc asset add` writes (FR-023).
 *
 * The stand-in records `media` as a FACT about the bytes it addresses, and a reader — human or
 * agent — has nothing else to go on: the bytes are not in the repo, so the stand-in's word is
 * the only word. That is why this table is a closed list and why an extension it does not know
 * produces `null` rather than a guess.
 *
 * **Never add a fallback here.** `application/octet-stream` for the unknown case would look
 * harmless and would be the bug: it is a media type, so it would be recorded as one, and the
 * stand-in would then assert something nobody established. `pc asset add` turns the `null` into
 * a refusal that asks for `--media`, which costs the author one flag and costs a reader nothing.
 * A wrong media type recorded as fact is worse than a refusal.
 *
 * Sniffing the content is deliberately absent too, for the same reason FR-026 forbids it for the
 * size guard: an author must be able to predict what the system will do with a file before
 * running anything, and "the first bytes looked like a RIFF header" is not predictable.
 */
const MEDIA_TYPES_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  // Audio — the editorial-audio profile's stock in trade.
  ['.wav', 'audio/wav'],
  ['.aif', 'audio/aiff'],
  ['.aiff', 'audio/aiff'],
  ['.flac', 'audio/flac'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/opus'],
  // Video.
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mkv', 'video/x-matroska'],
  // Images.
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  // Documents and packages.
  ['.pdf', 'application/pdf'],
  ['.epub', 'application/epub+zip'],
  ['.zip', 'application/zip'],
  ['.json', 'application/json'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
]);

/**
 * The media type for `extension` (leading dot, any case), or `null` when this table does not
 * know it. `null` means "ask the author", never "assume something".
 */
export function mediaTypeForExtension(extension: string): string | null {
  return MEDIA_TYPES_BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

/**
 * Every extension this table knows, sorted. Used to make the refusal ACTIONABLE: an author told
 * only "unknown extension" has to guess whether they mistyped or whether the list is short, and
 * naming what IS known answers both (FR-036).
 */
export function knownExtensions(): readonly string[] {
  return [...MEDIA_TYPES_BY_EXTENSION.keys()].sort();
}
