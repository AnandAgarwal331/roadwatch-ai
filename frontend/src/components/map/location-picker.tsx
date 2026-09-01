"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/lib/constants";

const pinIcon = L.divIcon({
  className: "roadwatch-pin",
  html: `<span style="position:relative;display:block;width:26px;height:26px;">
    <span style="position:absolute;inset:-7px;border-radius:9999px;background:#1d4ed8;opacity:.18;"></span>
    <span style="position:absolute;inset:0;border-radius:9999px;background:#1d4ed8;border:3px solid #fff;box-shadow:0 3px 8px rgba(15,23,42,.4);"></span>
  </span>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => onPick(event.latlng.lat, event.latlng.lng),
  });
  return null;
}

/** Recentres when the coordinates change from outside (e.g. "use my location"). */
function Recenter({ position }: { position: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.setView(position, Math.max(map.getZoom(), 16), { animate: true });
    }
  }, [map, position]);

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [map]);

  return null;
}

export interface LocationPickerProps {
  value: { latitude: number; longitude: number } | null;
  onChange: (coords: { latitude: number; longitude: number }) => void;
}

/** Tap or drag to place the exact spot of the problem. */
export default function LocationPicker({ value, onChange }: LocationPickerProps) {
  const position: [number, number] | null = value ? [value.latitude, value.longitude] : null;

  return (
    <MapContainer
      center={position ?? DEFAULT_MAP_CENTER}
      zoom={position ? 16 : DEFAULT_MAP_ZOOM}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ClickHandler onPick={(latitude, longitude) => onChange({ latitude, longitude })} />
      <Recenter position={position} />

      {position ? (
        <Marker
          position={position}
          icon={pinIcon}
          draggable
          autoPan
          eventHandlers={{
            dragend: (event) => {
              const { lat, lng } = event.target.getLatLng();
              onChange({ latitude: lat, longitude: lng });
            },
          }}
          alt="Selected report location"
        />
      ) : null}
    </MapContainer>
  );
}
