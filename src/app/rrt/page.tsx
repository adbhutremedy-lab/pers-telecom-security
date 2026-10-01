import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";

// The RRT mobile app (alerts, accept/reject, navigation, GPS, resolution form, photos) is built in Phase 3.
export default async function RrtHome() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return (
    <main className="grid min-h-screen place-items-center bg-ink-900 p-6 text-center text-white">
      <div className="max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">PERS · RRT</h1>
        <p className="text-slate-300">Hello {profile.full_name}. The team app (alerts, navigation and resolution form) arrives in Phase 3.</p>
        <SignOutButton />
      </div>
    </main>
  );
}
