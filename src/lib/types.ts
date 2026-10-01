import type * as GeoJSON from "geojson";

// Types that mirror the database views and tables created in Phase 1.

export type RoleCode = "SUPER_ADMIN" | "ADMIN" | "OPERATOR" | "RRT_MEMBER";
export type TeamStatus = "AVAILABLE" | "ASSIGNED" | "REACHED" | "OFFLINE";
export type TowerStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE";
export type IncidentStatus = "OPEN" | "ASSIGNED" | "REACHED" | "RESOLVED" | "CANCELLED";
export type DispatchState = "OFFERING" | "EXHAUSTED" | "DONE";
export type AssignmentStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED";
export type QuestionType = "YES_NO" | "RATING" | "TEXT" | "DROPDOWN" | "FILE" | "PHOTO" | "MULTI_SELECT";
export type NotificationType =
  | "INCIDENT_OFFER"
  | "INCIDENT_ASSIGNED"
  | "INCIDENT_REACHED"
  | "INCIDENT_RESOLVED"
  | "INCIDENT_EXHAUSTED"
  | "INCIDENT_CANCELLED"
  | "TEAM_OFFLINE"
  | "SYSTEM";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: RoleCode;
  rrt_team_id: string | null;
}

export interface DashboardStats {
  total_towers: number;
  active_towers: number;
  active_incidents: number;
  open_incidents: number;
  online_rrt: number;
  assigned_rrt: number;
  reached_rrt: number;
  offline_rrt: number;
  online_total: number;
  resolved_today: number;
}

/** v_rrt_live */
export interface RrtLive {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  region: string | null;
  is_active: boolean;
  is_simulated: boolean;
  is_online_enabled: boolean;
  db_status: TeamStatus;
  live_status: TeamStatus;
  is_stale: boolean;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  heading: number | null;
  accuracy_m: number | null;
  last_seen_at: string | null;
  current_incident_id: string | null;
  incident_number: string | null;
  incident_status: IncidentStatus | null;
  accepted_at: string | null;
  eta_seconds: number | null;
  distance_remaining_m: number | null;
  tower_number: string | null;
  tower_name: string | null;
  tower_lat: number | null;
  tower_lng: number | null;
}

export interface Tower {
  id: string;
  tower_number: string;
  site_name: string;
  lat: number;
  lng: number;
  region: string;
  status: TowerStatus;
  address: string | null;
  deleted_at: string | null;
}

/** v_tower_incident_counts */
export interface TowerCounts {
  tower_id: string;
  tower_number: string;
  site_name: string;
  region: string;
  status: TowerStatus;
  total_incidents: number;
  open_incidents: number;
  resolved_incidents: number;
  last_incident_at: string | null;
  avg_response_seconds: number | null;
}

/** v_incident_detail */
export interface IncidentDetail {
  id: string;
  incident_number: string;
  status: IncidentStatus;
  dispatch_state: DispatchState;
  dispatch_round: number;
  source: "MAP_MENU" | "CREATE_FORM" | "API";
  region: string | null;
  triggered_at: string;
  accepted_at: string | null;
  reached_at: string | null;
  reached_manually: boolean;
  resolved_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  eta_seconds: number | null;
  eta_updated_at: string | null;
  distance_remaining_m: number | null;
  route_distance_m: number | null;
  route_geojson: GeoJSON.LineString | { type: string; [k: string]: unknown } | null;
  accept_seconds: number | null;
  travel_seconds: number | null;
  response_seconds: number | null;
  onsite_seconds: number | null;
  resolution_seconds: number | null;
  notes: string | null;
  form_id: string | null;
  is_demo_seed: boolean;
  tower_id: string;
  tower_number: string;
  tower_name: string;
  tower_lat: number;
  tower_lng: number;
  tower_status: TowerStatus;
  assigned_team_id: string | null;
  team_code: string | null;
  team_name: string | null;
  team_mobile: string | null;
  team_lat: number | null;
  team_lng: number | null;
  team_speed_kmh: number | null;
  team_last_seen_at: string | null;
  triggered_by: string | null;
  triggered_by_name: string | null;
  offers_count: number;
  pending_team_id: string | null;
  pending_expires_at: string | null;
  pending_team_code: string | null;
  pending_team_name: string | null;
}

/** v_incident_offers */
export interface IncidentOffer {
  id: string;
  incident_id: string;
  sequence_no: number;
  round_no: number;
  team_id: string;
  team_code: string;
  team_name: string;
  distance_km: number;
  status: AssignmentStatus;
  manual: boolean;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  response_reason: string | null;
  response_seconds: number | null;
}

export interface IncidentAnswer {
  id: string;
  incident_id: string;
  question_id: string | null;
  question_label: string;
  question_type: QuestionType;
  value: unknown;
  answered_at: string;
}

export interface IncidentPhoto {
  id: string;
  incident_id: string;
  question_id: string | null;
  kind: "PHOTO" | "FILE";
  storage_path: string;
  file_name: string | null;
  mime_type: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  incident_id: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface CustomQuestion {
  id: string;
  form_id: string;
  position: number;
  label: string;
  type: QuestionType;
  is_required: boolean;
  options: string[];
  scale_min: number | null;
  scale_max: number | null;
  min_files: number;
  is_active: boolean;
}

export interface TowerSearchHit {
  id: string;
  tower_number: string;
  site_name: string;
  region: string;
  lat: number;
  lng: number;
  status: TowerStatus;
}

export const ACTIVE_STATUSES: IncidentStatus[] = ["OPEN", "ASSIGNED", "REACHED"];
export const isStaffRole = (r: RoleCode | undefined | null) => r === "SUPER_ADMIN" || r === "ADMIN" || r === "OPERATOR";
export const isAdminRole = (r: RoleCode | undefined | null) => r === "SUPER_ADMIN" || r === "ADMIN";
