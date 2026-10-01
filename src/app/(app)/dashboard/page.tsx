import type { Metadata } from "next";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tower?: string; team?: string }> }) {
  const { tower, team } = await searchParams;
  return <DashboardClient initialTowerId={tower ?? null} initialTeamId={team ?? null} />;
}
