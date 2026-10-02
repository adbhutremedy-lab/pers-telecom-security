"use client";

import { useEffect, useState } from "react";
import { MapPin, LocateFixed, ExternalLink } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";
import { CITY_PRESETS, announceMapSettingsChanged, useMapSettings } from "@/lib/mapSettings";

/**
 * Admin -> Settings -> "Demo location".
 * Lets a Super Admin pick the city the map opens on (Lagos today, Accra or Dubai
 * next week) and optionally move the simulated teams there too.
 */
export default function MapLocationCard() {
  const me = useProfile();
  const toast = useToast();
  const isSuper = me.role === "SUPER_ADMIN";
  const saved = useMapSettings();
  const [city, setCity] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [zoom, setZoom] = useState("");
  const [moveTeams, setMoveTeams] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // fill the form once the saved values arrive (and again after a save)
  useEffect(() => {
    if (!saved.loaded) return;
    setCity(saved.city);
    setLat(String(saved.lat));
    setLng(String(saved.lng));
    setZoom(String(saved.zoom));
  }, [saved.loaded, saved.city, saved.lat, saved.lng, saved.zoom]);

  // a stale error message disappears as soon as the person edits a field
  useEffect(() => {
    setErr(null);
  }, [city, lat, lng, zoom]);

  const changed = saved.loaded && (city.trim() !== saved.city || Number(lat) !== saved.lat || Number(lng) !== saved.lng || Number(zoom) !== saved.zoom);

  function pickPreset(label: string) {
    const p = CITY_PRESETS.find((c) => c.label === label);
    if (!p) return;
    setErr(null);
    setCity(p.city);
    setLat(String(p.lat));
    setLng(String(p.lng));
    setZoom(String(p.zoom));
  }

  function useMyLocation() {
    setErr(null);
    if (!navigator.geolocation) return setErr("This browser cannot share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLat(pos.coords.latitude.toFixed(5));
        setLng(pos.coords.longitude.toFixed(5));
        if (!city.trim()) setCity("My location");
      },
      () => {
        setLocating(false);
        setErr("Could not get your location. Allow location for this site, or pick a city from the list.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  async function save() {
    setErr(null);
    const la = Number(lat);
    const ln = Number(lng);
    const z = Number(zoom);
    if (!city.trim()) return setErr("Enter a name for the place, for example Lagos, Nigeria.");
    if (lat.trim() === "" || !Number.isFinite(la) || la < -85 || la > 85) return setErr("Latitude must be a number between -85 and 85.");
    if (lng.trim() === "" || !Number.isFinite(ln) || ln < -180 || ln > 180) return setErr("Longitude must be a number between -180 and 180.");
    if (zoom.trim() === "" || !Number.isInteger(z) || z < 1 || z > 20) return setErr("Zoom must be a whole number between 1 and 20.");
    setBusy(true);
    const sb = supabaseBrowser();
    const writes = [
      sb.from("settings").update({ value: { lat: la, lng: ln }, updated_by: me.id }).eq("key", "map_default_center"),
      sb.from("settings").update({ value: z, updated_by: me.id }).eq("key", "map_default_zoom"),
      sb.from("settings").update({ value: city.trim(), updated_by: me.id }).eq("key", "demo_city"),
    ];
    for (const w of writes) {
      const { error } = await w;
      if (error) {
        setBusy(false);
        return setErr(cleanError(error));
      }
    }
    let moved: number | null = null;
    if (moveTeams) {
      const { data, error } = await sb.rpc("move_simulated_teams", { p_lat: la, p_lng: ln });
      if (error) {
        setBusy(false);
        announceMapSettingsChanged();
        return setErr(`Location saved, but the simulated teams could not be moved: ${cleanError(error)}`);
      }
      moved = typeof data === "number" ? data : null;
    }
    setBusy(false);
    announceMapSettingsChanged();
    toast.push({
      kind: "success",
      title: "Demo location saved",
      body: moved === null ? `${city.trim()}. The map opens here from now on.` : `${city.trim()}. ${moved} simulated teams moved there too.`,
    });
  }

  const mapsUrl = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat.trim() !== "" && lng.trim() !== "" ? `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}` : null;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="map-location-card">
      <div className="mb-1 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-blue-600" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-900">Demo location</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Where the control-room map opens, and the name shown at the top. Pick a city for each demo (Lagos, Accra, Dubai, India…).
        {isSuper ? "" : " Only a Super Admin can change this."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-slate-700">Quick pick</span>
          <select className={inputCls} defaultValue="" disabled={!isSuper} onChange={(e) => pickPreset(e.target.value)} aria-label="Pick a city" data-testid="map-preset">
            <option value="" disabled>Choose a city…</option>
            {CITY_PRESETS.map((c) => (
              <option key={c.label} value={c.label}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-slate-700">Name shown at the top</span>
          <input className={inputCls} value={city} disabled={!isSuper} onChange={(e) => setCity(e.target.value)} maxLength={80} aria-label="Place name" data-testid="map-city" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Latitude</span>
          <input className={inputCls} inputMode="decimal" value={lat} disabled={!isSuper} onChange={(e) => setLat(e.target.value)} aria-label="Map latitude" data-testid="map-lat" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Longitude</span>
          <input className={inputCls} inputMode="decimal" value={lng} disabled={!isSuper} onChange={(e) => setLng(e.target.value)} aria-label="Map longitude" data-testid="map-lng" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Zoom <span className="font-normal text-slate-500">(1 = world, 20 = street; 10–12 suits a city)</span></span>
          <input className={inputCls} inputMode="numeric" value={zoom} disabled={!isSuper} onChange={(e) => setZoom(e.target.value)} aria-label="Map zoom" data-testid="map-zoom" />
        </label>
        <div className="flex items-end gap-2 text-sm">
          {isSuper && (
            <Button tone="outline" onClick={useMyLocation} busy={locating} type="button">
              <LocateFixed className="mr-1.5 h-4 w-4" aria-hidden /> Use my location
            </Button>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-1 py-2 text-blue-700 hover:underline">
              Check on Google Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </div>

      {isSuper && (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={moveTeams} onChange={(e) => setMoveTeams(e.target.checked)} data-testid="map-move-teams" />
          <span>
            Also move the 9 simulated teams to this city
            <span className="block text-xs text-slate-500">They are placed 2–5 km around the centre so the fleet looks real. The real phone (RRT-01) is never moved, and "Reset demo" will park them here from now on.</span>
          </span>
        </label>
      )}

      {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="map-error">{err}</p>}
      {isSuper && (
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={save} busy={busy} disabled={!changed && !moveTeams} data-testid="save-map-location">Save location</Button>
          {changed && <span className="text-sm text-slate-500">unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
