import { redirect } from "next/navigation";
import { getProfile, homeFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(homeFor(profile.role));
}
