import "mapbox-gl/dist/mapbox-gl.css";
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getProfile, homeFor } from "@/lib/auth";
import { ProfileProvider } from "@/components/ProfileContext";
import { ToastProvider } from "@/components/Toast";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PERS RRT",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "PERS RRT", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1b33",
};

export default async function RrtLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login?e=profile");
  if (profile.role !== "RRT_MEMBER") redirect(homeFor(profile.role));

  return (
    <ProfileProvider profile={profile}>
      <ToastProvider>{children}</ToastProvider>
    </ProfileProvider>
  );
}
