import type { Metadata } from "next";
import IncidentDetailClient from "./IncidentDetailClient";

export const metadata: Metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IncidentDetailClient id={id} />;
}
