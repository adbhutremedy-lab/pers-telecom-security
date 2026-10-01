import { haversineKm } from "./format";

export type LngLat = [number, number];

export interface Path {
  coords: LngLat[];
  cum: number[]; // cumulative metres at each vertex (cum[0] = 0)
  total: number; // metres
}

const metres = (a: LngLat, b: LngLat) => haversineKm(a[1], a[0], b[1], b[0]) * 1000;

export function buildPath(coords: LngLat[]): Path {
  const clean = coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + metres(clean[i - 1], clean[i]));
  return { coords: clean, cum, total: cum[cum.length - 1] ?? 0 };
}

export function bearing(a: LngLat, b: LngLat): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b[0] - a[0])) * Math.cos(r(b[1]));
  const x = Math.cos(r(a[1])) * Math.sin(r(b[1])) - Math.sin(r(a[1])) * Math.cos(r(b[1])) * Math.cos(r(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Position after travelling `m` metres along the path (clamped to the end). */
export function pointAt(path: Path, m: number): { lng: number; lat: number; heading: number; done: boolean } {
  const { coords, cum, total } = path;
  if (coords.length === 0) return { lng: 0, lat: 0, heading: 0, done: true };
  if (coords.length === 1 || m <= 0) {
    const h = coords.length > 1 ? bearing(coords[0], coords[1]) : 0;
    return { lng: coords[0][0], lat: coords[0][1], heading: h, done: coords.length === 1 };
  }
  if (m >= total) {
    const last = coords[coords.length - 1];
    return { lng: last[0], lat: last[1], heading: bearing(coords[coords.length - 2], last), done: true };
  }
  let i = 1;
  while (i < cum.length && cum[i] < m) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const k = (m - cum[i - 1]) / segLen;
  const a = coords[i - 1];
  const b = coords[i];
  return { lng: a[0] + (b[0] - a[0]) * k, lat: a[1] + (b[1] - a[1]) * k, heading: bearing(a, b), done: false };
}

export interface RouteResult {
  coords: LngLat[];
  durationS: number;
  distanceM: number;
  source: "mapbox" | "straight";
}

/** Road route from Mapbox Directions; falls back to a straight line if the call fails. */
export async function fetchRoute(from: LngLat, to: LngLat, token: string): Promise<RouteResult> {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Directions ${res.status}`);
    const json = (await res.json()) as { routes?: { geometry: { coordinates: LngLat[] }; duration: number; distance: number }[] };
    const r = json.routes?.[0];
    if (!r || r.geometry.coordinates.length < 2) throw new Error("no route");
    return { coords: r.geometry.coordinates, durationS: r.duration, distanceM: r.distance, source: "mapbox" };
  } catch {
    const d = metres(from, to);
    return { coords: [from, to], durationS: d / (40 / 3.6), distanceM: d, source: "straight" };
  }
}
