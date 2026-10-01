// NEXT_PUBLIC_ variables must be written out in full so Next.js can place them in the browser bundle.
const RAW_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();

/** Accepts "https://xxxx.supabase.co", "xxxx.supabase.co" or a copy that still ends in "/rest/v1/" and returns the bare address. */
function cleanSupabaseUrl(v: string): string {
  if (!v) return "";
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).origin;
  } catch {
    return v;
  }
}

export const SUPABASE_URL = cleanSupabaseUrl(RAW_URL);
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
export const MAPBOX_TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();

export const envProblems = (): string[] => {
  const p: string[] = [];
  if (!/^https?:\/\//.test(SUPABASE_URL)) p.push("NEXT_PUBLIC_SUPABASE_URL is missing or does not look like https://xxxx.supabase.co");
  if (!SUPABASE_KEY) p.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing");
  if (SUPABASE_KEY.startsWith("sb_secret_")) p.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a SECRET key. Use the publishable key instead and rotate the secret key now");
  if (!MAPBOX_TOKEN.startsWith("pk.")) p.push("NEXT_PUBLIC_MAPBOX_TOKEN is missing or is not a public token (it must start with pk.)");
  return p;
};
