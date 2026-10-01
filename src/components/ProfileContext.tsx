"use client";

import { createContext, useContext } from "react";
import type { Profile } from "@/lib/types";

const Ctx = createContext<Profile | null>(null);

export function ProfileProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  return <Ctx.Provider value={profile}>{children}</Ctx.Provider>;
}

export function useProfile(): Profile {
  const p = useContext(Ctx);
  if (!p) throw new Error("useProfile must be used inside <ProfileProvider>");
  return p;
}
