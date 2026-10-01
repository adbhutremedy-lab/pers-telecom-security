import type { Metadata } from "next";
import TowersClient from "./TowersClient";

export const metadata: Metadata = { title: "Towers" };

export default function TowersPage() {
  return <TowersClient />;
}
