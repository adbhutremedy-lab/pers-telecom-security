import { supabaseServer } from "@/lib/supabase/server";
import type { Profile, RoleCode } from "@/lib/types";

/** The signed-in user's profile (name, role, team), or null when not signed in / no profile. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, email, full_name, phone, rrt_team_id, is_active, roles ( code )")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || data.is_active === false) return null;

  const roles = data.roles as unknown as { code: RoleCode } | { code: RoleCode }[] | null;
  const code = Array.isArray(roles) ? roles[0]?.code : roles?.code;
  if (!code) return null;

  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    phone: data.phone,
    rrt_team_id: data.rrt_team_id,
    role: code,
  };
}

export const homeFor = (role: RoleCode) => (role === "RRT_MEMBER" ? "/rrt" : "/dashboard");
