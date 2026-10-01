import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isAdminRole } from "@/lib/types";
import DemoClient from "./DemoClient";

export const metadata: Metadata = { title: "Demo Controller" };
export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const profile = await getProfile();
  if (!profile || !isAdminRole(profile.role)) redirect("/dashboard");
  return <DemoClient />;
}
