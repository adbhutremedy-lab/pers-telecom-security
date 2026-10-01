// NEXT_PUBLIC_ variables must be written out in full so Next.js can place them in the browser bundle.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export const envProblems = (): string[] => {
  const p: string[] = [];
  if (!/^https?:\/\//.test(SUPABASE_URL)) p.push("NEXT_PUBLIC_SUPABASE_URL is missing or does not start with https://");
  if (!SUPABASE_KEY) p.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing");
  if (SUPABASE_KEY.startsWith("sb_secret_")) p.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a SECRET key. Use the publishable key instead and rotate the secret key now");
  if (!MAPBOX_TOKEN.startsWith("pk.")) p.push("NEXT_PUBLIC_MAPBOX_TOKEN is missing or is not a public token (it must start with pk.)");
  return p;
};
