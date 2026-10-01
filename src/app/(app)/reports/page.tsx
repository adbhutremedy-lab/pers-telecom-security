import type { Metadata } from "next";
import ReportsClient from "./ReportsClient";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsClient />;
}
