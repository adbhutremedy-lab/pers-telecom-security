import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { envProblems } from "@/lib/env";
import { BRAND } from "@/lib/constants";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const problems = envProblems();
  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-ink-900 via-ink-800 to-ink-700 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">P</div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{BRAND}</h1>
            <p className="text-sm text-slate-500">Incident Management &amp; RRT Dispatch</p>
          </div>
        </div>

        {problems.length > 0 ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">The app is not configured yet</p>
            <ul className="mt-2 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="mt-2">See docs/PHASE2_DEPLOY_GUIDE.md, Part 4 (environment variables).</p>
          </div>
        ) : (
          <LoginForm noProfile={e === "profile"} />
        )}
      </div>
    </main>
  );
}
