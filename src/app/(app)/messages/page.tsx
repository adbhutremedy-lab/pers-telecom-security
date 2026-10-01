import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isAdminRole } from "@/lib/types";
import MessagesClient from "./MessagesClient";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const profile = await getProfile();
  if (!profile || !isAdminRole(profile.role)) redirect("/dashboard");
  const { team } = await searchParams;
  return <MessagesClient initialTeam={team && /^[0-9a-f-]{36}$/i.test(team) ? team : null} />;
}
