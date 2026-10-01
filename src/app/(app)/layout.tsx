import "mapbox-gl/dist/mapbox-gl.css";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { ProfileProvider } from "@/components/ProfileContext";
import { ToastProvider } from "@/components/Toast";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login?e=profile");
  if (profile.role === "RRT_MEMBER") redirect("/rrt");

  return (
    <ProfileProvider profile={profile}>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </ProfileProvider>
  );
}
