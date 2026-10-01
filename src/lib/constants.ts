import type { IncidentStatus, TeamStatus, TowerStatus } from "./types";

export const BRAND = "PERS Telecom Security";
export const DEMO_CENTER = { lat: 28.4595, lng: 77.0266 }; // Gurugram
export const DEMO_ZOOM = 11;

/** Map / badge colours for RRT teams: green, yellow, blue, red (as per the brief). */
export const TEAM_COLOR: Record<TeamStatus, string> = {
  AVAILABLE: "#16a34a",
  ASSIGNED: "#eab308",
  REACHED: "#2563eb",
  OFFLINE: "#dc2626",
};

export const TEAM_LABEL: Record<TeamStatus, string> = {
  AVAILABLE: "Online",
  ASSIGNED: "Assigned",
  REACHED: "Reached",
  OFFLINE: "Offline",
};

export const TOWER_COLOR: Record<TowerStatus, string> = {
  ACTIVE: "#0f766e",
  MAINTENANCE: "#d97706",
  INACTIVE: "#94a3b8",
};

export const INCIDENT_LABEL: Record<IncidentStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  REACHED: "Reached",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const INCIDENT_BADGE: Record<IncidentStatus, string> = {
  OPEN: "bg-red-100 text-red-800 ring-red-200",
  ASSIGNED: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  REACHED: "bg-blue-100 text-blue-800 ring-blue-200",
  RESOLVED: "bg-green-100 text-green-800 ring-green-200",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-200",
};
