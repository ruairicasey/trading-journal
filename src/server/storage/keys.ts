/** Image types we accept. SVG is deliberately excluded (it can carry script). */
export const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;

/** Throws unless the key is a safe relative path with an allowed image extension. */
export function assertSafeKey(key: string): string {
  if (key.length > 300 || !KEY_RE.test(key) || key.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error("Invalid storage key");
  }
  const ext = key.split(".").pop()!.toLowerCase();
  if (!CONTENT_TYPES[ext]) throw new Error("Unsupported file type");
  return CONTENT_TYPES[ext];
}
