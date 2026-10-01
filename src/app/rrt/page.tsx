import { getProfile } from "@/lib/auth";
import RrtApp from "@/components/rrt/RrtApp";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function RrtHome() {
  const profile = await getProfile();
  if (!profile?.rrt_team_id) {
    return (
      <main className="grid min-h-dvh place-items-center bg-ink-900 p-6 text-center text-white">
        <div className="max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">PERS · RRT</h1>
          <p className="text-slate-300">Your login is not linked to a response team. Ask the control room to link it, then sign in again.</p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  return <RrtApp teamId={profile.rrt_team_id} />;
}
