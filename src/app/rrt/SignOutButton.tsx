"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
    >
      Sign out
    </button>
  );
}
