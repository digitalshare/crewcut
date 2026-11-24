// Public base URL for links posted into Teamily (set GR_PUBLIC_URL to a tunnel URL, else localhost).
export const PORT = Number(process.env.GR_PORT ?? 4321);
export function publicUrl(path: string) {
  const base = (process.env.GR_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
  return base + path;
}
