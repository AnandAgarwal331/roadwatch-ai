import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boundingBox, haversineMeters, isValidCoordinate } from "./geo.ts";

Deno.test("haversineMeters is zero for the same point", () => {
  assertEquals(haversineMeters(12.9716, 77.5946, 12.9716, 77.5946), 0);
});

Deno.test("haversineMeters matches a known city-pair distance (Bengaluru to Chennai, ~290km)", () => {
  const meters = haversineMeters(12.9716, 77.5946, 13.0827, 80.2707);
  assertAlmostEquals(meters, 290_000, 5_000);
});

Deno.test("haversineMeters is symmetric", () => {
  const a = haversineMeters(12.9716, 77.5946, 13.0827, 80.2707);
  const b = haversineMeters(13.0827, 80.2707, 12.9716, 77.5946);
  assertEquals(a, b);
});

Deno.test("boundingBox contains the centre point and roughly matches the requested radius", () => {
  const lat = 12.9716;
  const lon = 77.5946;
  const radius = 500;
  const box = boundingBox(lat, lon, radius);

  assertEquals(box.minLat < lat && lat < box.maxLat, true);
  assertEquals(box.minLon < lon && lon < box.maxLon, true);

  // The corner should be roughly `radius` meters away, not wildly more or less
  // (this is what the SQL prefilter relies on to not miss real neighbours).
  const cornerDistance = haversineMeters(lat, lon, box.maxLat, box.maxLon);
  assertAlmostEquals(cornerDistance, radius * Math.SQRT2, radius * 0.5);
});

Deno.test("boundingBox clamps at the poles and the antimeridian", () => {
  const nearPole = boundingBox(89.9, 0, 50_000);
  assertEquals(nearPole.maxLat <= 90, true);

  const nearDateLine = boundingBox(0, 179.9, 50_000);
  assertEquals(nearDateLine.maxLon <= 180, true);
});

Deno.test("isValidCoordinate accepts the full valid range and rejects outside it", () => {
  assertEquals(isValidCoordinate(0, 0), true);
  assertEquals(isValidCoordinate(90, 180), true);
  assertEquals(isValidCoordinate(-90, -180), true);
  assertEquals(isValidCoordinate(90.0001, 0), false);
  assertEquals(isValidCoordinate(0, 180.0001), false);
});
