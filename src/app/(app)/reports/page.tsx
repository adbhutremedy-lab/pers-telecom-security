import type { Metadata } from "next";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div className="p-4">
      <PageHeader title="Reports" subtitle="Daily, weekly, monthly and custom reports as PDF, Excel and CSV" />
      <EmptyState title="Reports arrive in Phase 4" hint="The report data is already in the database (view v_report_incidents)." />
    </div>
  );
}
