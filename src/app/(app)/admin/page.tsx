import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isAdminRole } from "@/lib/types";
import AdminClient from "@/components/admin/AdminClient";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await getProfile();
  if (!profile || !isAdminRole(profile.role)) redirect("/dashboard");
  return <AdminClient />;
}
