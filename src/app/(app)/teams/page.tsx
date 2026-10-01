import type { Metadata } from "next";
import TeamsClient from "./TeamsClient";

export const metadata: Metadata = { title: "RRT Teams" };

export default function TeamsPage() {
  return <TeamsClient />;
}
