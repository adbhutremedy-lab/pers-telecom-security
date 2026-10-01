"use client";

import { useEffect, useRef, useState } from "react";
import type * as GeoJSON from "geojson";
import type { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import { LocateFixed } from "lucide-react";
import { MAPBOX_TOKEN } from "@/lib/env";

interface Props {
  tower: { lat: number; lng: number; name: string };
  me: { lat: number; lng: number } | null;
  route: [number, number][] | null;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Small route map for the active job: tower pin, my blue dot, and the road route. */
export default function JobMap({ tower, me, route }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;

  useEffect(() => {
    let disposed = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (disposed || !box.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: box.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [tower.lng, tower.lat],
        zoom: 14,
        attributionControl: false,
      });
      mapRef.current = map;
      map.on("dragstart", () => setFollow(false));
      map.on("load", () => {
        map.addSource("route", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 9 },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2563eb", "line-width": 5 },
        });

        const pin = document.createElement("div");
        pin.style.cssText = "width:30px;height:30px;border-radius:9999px;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);display:grid;place-items:center;color:#fff;font:700 13px system-ui";
        pin.textContent = "T";
        new mapboxgl.Marker({ element: pin }).setLngLat([tower.lng, tower.lat]).addTo(map);

        const dot = document.createElement("div");
        dot.style.cssText = "width:22px;height:22px;border-radius:9999px;background:#2563eb;border:4px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25),0 2px 8px rgba(0,0,0,.4)";
        meMarker.current = new mapboxgl.Marker({ element: dot }).setLngLat([tower.lng, tower.lat]);
        setReady(true);
      });
    })();
    return () => {
      disposed = true;
      meMarker.current?.remove();
      meMarker.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      fitted.current = false;
      setReady(false);
    };
    // The map is created once per job; tower never changes while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tower.lat, tower.lng]);

  // route line
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("route") as GeoJSONSource | undefined;
    src?.setData(
      route && route.length > 1
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }
        : EMPTY,
    );
  }, [route, ready]);

  // my position + camera
  useEffect(() => {
    const map = mapRef.current;
    const m = meMarker.current;
    if (!ready || !map || !m || !me) return;
    m.setLngLat([me.lng, me.lat]);
    if (!m.getElement().isConnected) m.addTo(map);
    if (!fitted.current) {
      fitted.current = true;
      map.fitBounds(
        [
          [Math.min(me.lng, tower.lng), Math.min(me.lat, tower.lat)],
          [Math.max(me.lng, tower.lng), Math.max(me.lat, tower.lat)],
        ],
        { padding: 50, maxZoom: 16, duration: 0 },
      );
    } else if (followRef.current) {
      map.easeTo({ center: [me.lng, me.lat], duration: 600 });
    }
  }, [me, ready, tower.lat, tower.lng]);

  return (
    <div className="relative h-60 overflow-hidden rounded-2xl border border-white/10" data-testid="job-map">
      <div ref={box} className="h-full w-full" />
      <button
        onClick={() => {
          setFollow(true);
          const map = mapRef.current;
          if (map && me) map.easeTo({ center: [me.lng, me.lat], zoom: Math.max(map.getZoom(), 15), duration: 500 });
        }}
        aria-label="Centre on my location"
        className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-white text-brand-600 shadow-lg"
      >
        <LocateFixed className="h-5 w-5" />
      </button>
    </div>
  );
}
