/**
 * Pre-process GTFS data from EMT Madrid into optimized JSON for the visualizer.
 * Run: node scripts/preprocess-gtfs.js
 *
 * Outputs:
 *   public/data/emt-routes.json  — route shapes + stops
 *   public/data/emt-stops.json   — all unique stops
 *   public/data/emt-schedule.json — per-route schedule (trip timing + frequencies)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function findGtfsDir() {
  const entries = fs.readdirSync(ROOT);
  const d = entries.find(
    e => fs.statSync(path.join(ROOT, e)).isDirectory() && e.includes('EMT_MADRID')
  );
  if (!d) { console.error('❌ No GTFS folder found'); process.exit(1); }
  return path.join(ROOT, d);
}

function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(l => l.trim());
  const hdr = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row = {};
    hdr.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    return row;
  });
}

/** "7:05:30" → seconds since midnight */
function timeToSec(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function main() {
  const gtfsDir = findGtfsDir();
  console.log(`📂 ${gtfsDir}`);

  // ── 1. routes ──────────────────────────────────────────
  console.log('🚌 routes.txt…');
  const routesRaw = parseCSV(path.join(gtfsDir, 'routes.txt'));
  console.log(`   ${routesRaw.length}`);

  // ── 2. trips ───────────────────────────────────────────
  console.log('🗺️  trips.txt…');
  const tripsRaw = parseCSV(path.join(gtfsDir, 'trips.txt'));
  console.log(`   ${tripsRaw.length}`);

  // route_id → { key → tripInfo } (deduplicate by direction+shape)
  const routeTrips = {};
  // Also build tripId → routeId lookup
  const tripRoute = {};
  for (const t of tripsRaw) {
    tripRoute[t.trip_id] = t.route_id;
    if (!routeTrips[t.route_id]) routeTrips[t.route_id] = {};
    const key = `${t.direction_id}_${t.shape_id}`;
    if (!routeTrips[t.route_id][key]) {
      routeTrips[t.route_id][key] = {
        shape_id: t.shape_id,
        trip_id: t.trip_id,
        headsign: t.trip_headsign,
        direction: parseInt(t.direction_id) || 0,
      };
    }
  }

  // ── 3. shapes ──────────────────────────────────────────
  console.log('📐 shapes.txt…');
  const shapesRaw = parseCSV(path.join(gtfsDir, 'shapes.txt'));
  console.log(`   ${shapesRaw.length}`);

  const shapesMap = {};
  for (const pt of shapesRaw) {
    if (!shapesMap[pt.shape_id]) shapesMap[pt.shape_id] = [];
    shapesMap[pt.shape_id].push({
      lat: parseFloat(pt.shape_pt_lat),
      lon: parseFloat(pt.shape_pt_lon),
      seq: parseInt(pt.shape_pt_sequence),
    });
  }
  for (const id of Object.keys(shapesMap)) shapesMap[id].sort((a, b) => a.seq - b.seq);

  // ── 4. stops ───────────────────────────────────────────
  console.log('🚏 stops.txt…');
  const stopsRaw = parseCSV(path.join(gtfsDir, 'stops.txt'));
  console.log(`   ${stopsRaw.length}`);

  const stopsMap = {};
  for (const s of stopsRaw) {
    stopsMap[s.stop_id] = {
      id: s.stop_id,
      name: s.stop_name,
      lat: parseFloat(s.stop_lat),
      lon: parseFloat(s.stop_lon),
    };
  }

  // ── 5. stop_times ──────────────────────────────────────
  console.log('⏱️  stop_times.txt…');
  const stRaw = parseCSV(path.join(gtfsDir, 'stop_times.txt'));
  console.log(`   ${stRaw.length}`);

  // trip_id → [{stop_id, seq, dist, arrival_sec}]
  const tripStops = {};
  for (const st of stRaw) {
    if (!tripStops[st.trip_id]) tripStops[st.trip_id] = [];
    tripStops[st.trip_id].push({
      stop_id: st.stop_id,
      seq: parseInt(st.stop_sequence),
      dist: parseFloat(st.shape_dist_traveled) || 0,
      arrSec: timeToSec(st.arrival_time),
    });
  }
  for (const id of Object.keys(tripStops)) tripStops[id].sort((a, b) => a.seq - b.seq);

  // ── 6. frequencies ─────────────────────────────────────
  console.log('🔁 frequencies.txt…');
  const freqRaw = parseCSV(path.join(gtfsDir, 'frequencies.txt'));
  console.log(`   ${freqRaw.length}`);

  // route_id → [ { startSec, endSec, headway, tripDuration, direction } ]
  // We aggregate per route (merge trip-level into route-level, group by hour band)
  const routeFreqs = {};
  for (const f of freqRaw) {
    const routeId = tripRoute[f.trip_id];
    if (!routeId) continue;
    if (!routeFreqs[routeId]) routeFreqs[routeId] = [];
    const sts = tripStops[f.trip_id];
    const tripDur = sts ? (sts[sts.length - 1].arrSec - sts[0].arrSec) : 1800;
    routeFreqs[routeId].push({
      startSec: timeToSec(f.start_time),
      endSec: timeToSec(f.end_time),
      headway: parseInt(f.headway_secs),
      tripDur,
    });
  }
  // Deduplicate overlapping frequency bands per route (keep the one with smallest headway)
  for (const rid of Object.keys(routeFreqs)) {
    const bands = routeFreqs[rid];
    const merged = {};
    for (const b of bands) {
      const key = `${b.startSec}-${b.endSec}`;
      if (!merged[key] || b.headway < merged[key].headway) merged[key] = b;
    }
    routeFreqs[rid] = Object.values(merged).sort((a, b) => a.startSec - b.startSec);
  }

  // ── 7. Build output routes ─────────────────────────────
  console.log('🔧 Building…');
  const outputRoutes = [];

  for (const route of routesRaw) {
    const trips = routeTrips[route.route_id];
    if (!trips) continue;

    const routeShapes = [];
    for (const ti of Object.values(trips)) {
      const pts = shapesMap[ti.shape_id];
      if (!pts || pts.length < 2) continue;

      // Simplify shape
      const step = pts.length > 200 ? 3 : pts.length > 100 ? 2 : 1;
      const coords = [];
      for (let i = 0; i < pts.length; i++) {
        if (i === 0 || i === pts.length - 1 || i % step === 0) {
          coords.push([
            Math.round(pts[i].lon * 1e6) / 1e6,
            Math.round(pts[i].lat * 1e6) / 1e6,
          ]);
        }
      }

      const tStops = tripStops[ti.trip_id] || [];
      const stopArr = [];
      for (const ts of tStops) {
        const stop = stopsMap[ts.stop_id];
        if (stop && !isNaN(stop.lat) && !isNaN(stop.lon)) {
          stopArr.push({
            id: stop.id,
            name: stop.name,
            coords: [Math.round(stop.lon * 1e6) / 1e6, Math.round(stop.lat * 1e6) / 1e6],
            dist: ts.dist,
            arr: ts.arrSec,
          });
        }
      }

      routeShapes.push({
        shapeId: ti.shape_id,
        headsign: ti.headsign,
        direction: ti.direction,
        coordinates: coords,
        stops: stopArr,
      });
    }

    if (routeShapes.length === 0) continue;

    // Compute trip duration from first shape's stops
    const s0 = routeShapes[0].stops;
    const tripDuration = s0.length > 1 ? s0[s0.length - 1].arr - s0[0].arr : 1800;

    outputRoutes.push({
      id: route.route_id,
      shortName: route.route_short_name,
      longName: route.route_long_name,
      color: route.route_color ? `#${route.route_color}` : '#0178BC',
      shapes: routeShapes,
      tripDuration,
      frequencies: routeFreqs[route.route_id] || [],
    });
  }

  console.log(`✅ ${outputRoutes.length} routes`);

  // ── 8. Write files ─────────────────────────────────────
  const outDir = path.join(ROOT, 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const rPath = path.join(outDir, 'emt-routes.json');
  fs.writeFileSync(rPath, JSON.stringify(outputRoutes));
  console.log(`📦 ${rPath} (${(fs.statSync(rPath).size / 1e6).toFixed(2)} MB)`);

  // Unique stops
  const seen = new Set();
  const allStops = [];
  for (const r of outputRoutes)
    for (const sh of r.shapes)
      for (const s of sh.stops)
        if (!seen.has(s.id)) { seen.add(s.id); allStops.push(s); }

  const sPath = path.join(outDir, 'emt-stops.json');
  fs.writeFileSync(sPath, JSON.stringify(allStops));
  console.log(`📦 ${sPath} (${(fs.statSync(sPath).size / 1e6).toFixed(2)} MB) — ${allStops.length} stops`);
}

main();
