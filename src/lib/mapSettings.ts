"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DEMO_CENTER, DEMO_ZOOM } from "@/lib/constants";

export interface MapSettings {
  lat: number;
  lng: number;
  zoom: number;
  city: string;
  /** true once the saved values have been read (or the read failed and defaults are used) */
  loaded: boolean;
}

export const MAP_SETTINGS_EVENT = "pers-map-settings-changed";

/** Cities offered as one-click presets in Admin -> Settings. */
export const CITY_PRESETS: { label: string; city: string; lat: number; lng: number; zoom: number }[] = [
  { label: "Lagos, Nigeria", city: "Lagos, Nigeria", lat: 6.5244, lng: 3.3792, zoom: 11 },
  { label: "Abuja, Nigeria", city: "Abuja, Nigeria", lat: 9.0765, lng: 7.3986, zoom: 11 },
  { label: "Port Harcourt, Nigeria", city: "Port Harcourt, Nigeria", lat: 4.8156, lng: 7.0498, zoom: 11 },
  { label: "Accra, Ghana", city: "Accra, Ghana", lat: 5.6037, lng: -0.187, zoom: 11 },
  { label: "Kumasi, Ghana", city: "Kumasi, Ghana", lat: 6.6885, lng: -1.6244, zoom: 11 },
  { label: "Dubai, UAE", city: "Dubai, UAE", lat: 25.2048, lng: 55.2708, zoom: 10 },
  { label: "Abu Dhabi, UAE", city: "Abu Dhabi, UAE", lat: 24.4539, lng: 54.3773, zoom: 10 },
  { label: "Riyadh, Saudi Arabia", city: "Riyadh, Saudi Arabia", lat: 24.7136, lng: 46.6753, zoom: 10 },
  { label: "Nairobi, Kenya", city: "Nairobi, Kenya", lat: -1.2921, lng: 36.8219, zoom: 11 },
  { label: "Johannesburg, South Africa", city: "Johannesburg, South Africa", lat: -26.2041, lng: 28.0473, zoom: 10 },
  { label: "Gurugram, India", city: "Gurugram, Haryana, India", lat: 28.4595, lng: 77.0266, zoom: 11 },
  { label: "Delhi, India", city: "Delhi, India", lat: 28.6139, lng: 77.209, zoom: 10 },
  { label: "Mumbai, India", city: "Mumbai, India", lat: 19.076, lng: 72.8777, zoom: 11 },
];

/** Tell every mounted copy of useMapSettings to read the values again. */
export function announceMapSettingsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAP_SETTINGS_EVENT));
}

/** Reads the demo location (map centre, zoom, city name) saved in Admin -> Settings. */
export function useMapSettings(): MapSettings {
  const [s, setS] = useState<MapSettings>({ lat: DEMO_CENTER.lat, lng: DEMO_CENTER.lng, zoom: DEMO_ZOOM, city: "Gurugram, Haryana, India", loaded: false });

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from("settings").select("key, value").in("key", ["map_default_center", "map_default_zoom", "demo_city"]);
    if (error || !data) {
      setS((p) => ({ ...p, loaded: true }));
      return;
    }
    setS((p) => {
      const next = { ...p, loaded: true };
      for (const r of data as { key: string; value: unknown }[]) {
        if (r.key === "map_default_center" && r.value && typeof r.value === "object") {
          const v = r.value as { lat?: unknown; lng?: unknown };
          if (typeof v.lat === "number" && typeof v.lng === "number" && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180) {
            next.lat = v.lat;
            next.lng = v.lng;
          }
        } else if (r.key === "map_default_zoom" && typeof r.value === "number" && r.value >= 1 && r.value <= 20) {
          next.zoom = r.value;
        } else if (r.key === "demo_city" && typeof r.value === "string" && r.value.trim()) {
          next.city = r.value.trim();
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void load();
    const h = () => void load();
    window.addEventListener(MAP_SETTINGS_EVENT, h);
    return () => window.removeEventListener(MAP_SETTINGS_EVENT, h);
  }, [load]);

  return s;
}
