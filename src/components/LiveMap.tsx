"use client";

import { useEffect, useRef } from "react";
import type * as GeoJSON from "geojson";
import type { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import { MAPBOX_TOKEN } from "@/lib/env";
import { DEMO_CENTER, DEMO_ZOOM, TEAM_COLOR, TOWER_COLOR } from "@/lib/constants";
import type { IncidentDetail, RrtLive, Tower } from "@/lib/types";

export interface MapFocus {
  lat: number;
  lng: number;
  zoom?: number;
  key: string | number; // change the key to trigger a fly-to
}

interface Props {
  towers: Tower[];
  activeTowerIds: Set<string>;
  teams: RrtLive[];
  incidents: IncidentDetail[];
  focus?: MapFocus | null;
  selectedTowerId?: string | null;
  onTowerClick?: (towerId: string) => void;
  onTeamClick?: (teamId: string) => void;
  className?: string;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function towerFeatures(towers: Tower[], active: Set<string>, selected?: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: towers.map((t) => ({
      type: "Feature",
      id: undefined,
      properties: { id: t.id, number: t.tower_number, status: t.status, active: active.has(t.id) ? 1 : 0, selected: t.id === selected ? 1 : 0 },
      geometry: { type: "Point", coordinates: [t.lng, t.lat] },
    })),
  };
}

function routeFeatures(incidents: IncidentDetail[], teams: RrtLive[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const i of incidents) {
    if (i.status !== "ASSIGNED" && i.status !== "REACHED") continue;
    const g = i.route_geojson as { type?: string; coordinates?: [number, number][] } | null;
    if (i.status === "ASSIGNED" && g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length > 1) {
      features.push({ type: "Feature", properties: { kind: "road" }, geometry: { type: "LineString", coordinates: g.coordinates } });
    } else if (i.status === "ASSIGNED") {
      const t = teams.find((x) => x.id === i.assigned_team_id);
      if (t?.lat != null && t.lng != null) {
        features.push({
          type: "Feature",
          properties: { kind: "straight" },
          geometry: { type: "LineString", coordinates: [[t.lng, t.lat], [i.tower_lng, i.tower_lat]] },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

function teamElement(t: RrtLive): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "width:34px;height:34px;cursor:pointer;";
  const dot = document.createElement("div");
  dot.className = "pers-dot";
  dot.style.cssText =
    "position:absolute;inset:0;border-radius:9999px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:grid;place-items:center;color:#fff;font:700 11px/1 system-ui,sans-serif;";
  el.appendChild(dot);
  applyTeamStyle(el, t);
  return el;
}

function applyTeamStyle(el: HTMLElement, t: RrtLive) {
  const dot = el.firstElementChild as HTMLElement;
  const color = TEAM_COLOR[t.live_status];
  dot.style.background = color;
  dot.style.color = t.live_status === "ASSIGNED" ? "#1f2937" : "#fff";
  dot.textContent = t.code.replace("RRT-", "");
  dot.title = `${t.code} ${t.name}${t.is_simulated ? " (simulated)" : " (real device)"}`;
  dot.style.borderStyle = t.is_simulated ? "solid" : "double";
  dot.style.borderWidth = t.is_simulated ? "3px" : "4px";
  el.style.color = color;
  el.classList.toggle("pers-pulse", t.live_status === "ASSIGNED");
  el.style.opacity = t.live_status === "OFFLINE" ? "0.85" : "1";
}

export default function LiveMap({ towers, activeTowerIds, teams, incidents, focus, selectedTowerId, onTowerClick, onTeamClick, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const readyRef = useRef(false);
  const markers = useRef<Map<string, { marker: Marker; el: HTMLDivElement; lng: number; lat: number; raf: number | null }>>(new Map());
  const incidentMarkers = useRef<Map<string, Marker>>(new Map());
  const mapboxRef = useRef<typeof import("mapbox-gl").default | null>(null);

  // latest props for callbacks created once
  const latest = useRef({ towers, activeTowerIds, teams, incidents, selectedTowerId, onTowerClick, onTeamClick, focus });
  latest.current = { towers, activeTowerIds, teams, incidents, selectedTowerId, onTowerClick, onTeamClick, focus };

  // ---- create the map once ------------------------------------------------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (disposed || !box.current) return;
      mapboxRef.current = mapboxgl;
      mapboxgl.accessToken = MAPBOX_TOKEN;

      const map = new mapboxgl.Map({
        container: box.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [DEMO_CENTER.lng, DEMO_CENTER.lat],
        zoom: DEMO_ZOOM,
        attributionControl: true,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new mapboxgl.FullscreenControl(), "top-right");

      map.on("load", () => {
        map.addSource("towers", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 38, clusterMaxZoom: 13 });
        map.addSource("routes", { type: "geojson", data: EMPTY });

        map.addLayer({
          id: "routes-road",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "kind"], "road"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.8 },
        });
        map.addLayer({
          id: "routes-straight",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "kind"], "straight"],
          paint: { "line-color": "#2563eb", "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.7 },
        });

        map.addLayer({
          id: "tower-clusters",
          type: "circle",
          source: "towers",
          filter: ["has", "point_count"],
          paint: { "circle-color": "#0f766e", "circle-opacity": 0.85, "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 24], "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
        });
        map.addLayer({
          id: "tower-cluster-count",
          type: "symbol",
          source: "towers",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"] },
          paint: { "text-color": "#fff" },
        });
        map.addLayer({
          id: "tower-points",
          type: "circle",
          source: "towers",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": ["case", ["==", ["get", "selected"], 1], 10, 7],
            "circle-color": ["match", ["get", "status"], "MAINTENANCE", TOWER_COLOR.MAINTENANCE, "INACTIVE", TOWER_COLOR.INACTIVE, TOWER_COLOR.ACTIVE],
            "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 4, 2],
            "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#1d4ed8", "#ffffff"],
          },
        });
        map.addLayer({
          id: "tower-labels",
          type: "symbol",
          source: "towers",
          minzoom: 13,
          filter: ["!", ["has", "point_count"]],
          layout: { "text-field": ["get", "number"], "text-size": 11, "text-offset": [0, 1.4], "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"] },
          paint: { "text-color": "#0f172a", "text-halo-color": "#fff", "text-halo-width": 1.5 },
        });

        map.on("click", "tower-clusters", (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: ["tower-clusters"] })[0];
          if (!f) return;
          const src = map.getSource("towers") as GeoJSONSource;
          src.getClusterExpansionZoom(f.properties?.cluster_id, (err, zoom) => {
            if (err || zoom == null) return;
            map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.5 });
          });
        });
        map.on("click", "tower-points", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) latest.current.onTowerClick?.(id);
        });
        for (const l of ["tower-clusters", "tower-points"]) {
          map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
        }

        readyRef.current = true;
        syncAll();
        const f = latest.current.focus;
        if (f) map.jumpTo({ center: [f.lng, f.lat], zoom: f.zoom ?? 15 });
      });
    })();

    return () => {
      disposed = true;
      readyRef.current = false;
      markers.current.forEach((m) => {
        if (m.raf) cancelAnimationFrame(m.raf);
        m.marker.remove();
      });
      markers.current.clear();
      incidentMarkers.current.forEach((m) => m.remove());
      incidentMarkers.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- push the latest data into the map ------------------------------------
  function syncAll() {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl || !readyRef.current) return;
    const { towers, activeTowerIds, teams, incidents, selectedTowerId } = latest.current;

    (map.getSource("towers") as GeoJSONSource | undefined)?.setData(towerFeatures(towers, activeTowerIds, selectedTowerId));
    (map.getSource("routes") as GeoJSONSource | undefined)?.setData(routeFeatures(incidents, teams));

    // pulsing red ring on towers that have an active incident
    const wanted = new Set<string>();
    for (const t of towers) if (activeTowerIds.has(t.id)) wanted.add(t.id);
    incidentMarkers.current.forEach((m, id) => {
      if (!wanted.has(id)) {
        m.remove();
        incidentMarkers.current.delete(id);
      }
    });
    for (const t of towers) {
      if (!wanted.has(t.id) || incidentMarkers.current.has(t.id)) continue;
      const el = document.createElement("div");
      el.className = "pers-pulse";
      el.style.cssText = "width:26px;height:26px;color:#dc2626;pointer-events:none;";
      const core = document.createElement("div");
      core.style.cssText = "position:absolute;inset:5px;border-radius:9999px;background:#dc2626;border:2px solid #fff;";
      el.appendChild(core);
      incidentMarkers.current.set(t.id, new mapboxgl.Marker({ element: el }).setLngLat([t.lng, t.lat]).addTo(map));
    }

    // RRT markers: create, restyle, glide to the new position, remove
    const seen = new Set<string>();
    for (const t of teams) {
      if (t.lat == null || t.lng == null || !t.is_active) continue;
      seen.add(t.id);
      const cur = markers.current.get(t.id);
      if (!cur) {
        const el = teamElement(t);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          latest.current.onTeamClick?.(t.id);
        });
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([t.lng, t.lat]).addTo(map);
        markers.current.set(t.id, { marker, el, lng: t.lng, lat: t.lat, raf: null });
      } else {
        applyTeamStyle(cur.el, t);
        if (cur.lng !== t.lng || cur.lat !== t.lat) glide(cur, t.lng, t.lat);
      }
    }
    markers.current.forEach((m, id) => {
      if (!seen.has(id)) {
        if (m.raf) cancelAnimationFrame(m.raf);
        m.marker.remove();
        markers.current.delete(id);
      }
    });
  }

  function glide(m: { marker: Marker; lng: number; lat: number; raf: number | null }, toLng: number, toLat: number) {
    if (m.raf) cancelAnimationFrame(m.raf);
    const fromLng = m.lng;
    const fromLat = m.lat;
    const start = performance.now();
    const dur = 900;
    m.lng = toLng;
    m.lat = toLat;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      m.marker.setLngLat([fromLng + (toLng - fromLng) * k, fromLat + (toLat - fromLat) * k]);
      m.raf = k < 1 ? requestAnimationFrame(step) : null;
    };
    m.raf = requestAnimationFrame(step);
  }

  useEffect(() => {
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [towers, activeTowerIds, teams, incidents, selectedTowerId]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 15, speed: 1.4 });
  }, [focus]);

  return <div ref={box} className={className ?? "h-full w-full"} role="application" aria-label="Live map of towers and RRT teams" />;
}
