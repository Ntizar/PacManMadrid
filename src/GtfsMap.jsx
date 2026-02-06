import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import * as turf from '@turf/turf'

// ── Config ──────────────────────────────────────────────────
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw'

const BASE = import.meta.env.BASE_URL || '/'
const PELLET_RESPAWN = 4000

const ROUTE_PALETTE = [
  '#FF0000','#FFB8FF','#00FFFF','#FFB852','#FF69B4','#7FFF00',
  '#FF4500','#DA70D6','#1E90FF','#FFD700','#00FF7F','#FF6347',
]

// ── Helpers ─────────────────────────────────────────────────
async function fetchJSON(name) {
  const r = await fetch(`${BASE}data/${name}`)
  if (!r.ok) throw new Error(`Failed ${name}`)
  return r.json()
}

function routeColor(i) {
  return ROUTE_PALETTE[i % ROUTE_PALETTE.length]
}

/** Create a Pac-Man icon facing RIGHT (horizontal) as raw pixel data */
function createPacmanIcon(size = 48, color = '#FFD700') {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')
  const cx = size / 2, cy = size / 2, r = size / 2 - 2

  // Body — mouth opens to the right
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, 0.25 * Math.PI, 1.75 * Math.PI)
  ctx.closePath()
  ctx.fill()

  // Eye
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.arc(cx + 2, cy - r * 0.38, size * 0.06, 0, Math.PI * 2)
  ctx.fill()

  return ctx.getImageData(0, 0, size, size)
}

/**
 * Given a route's frequency bands and the current simulated time,
 * return an array of { progress } for each bus currently on-route.
 */
function activeBuses(route, simTime) {
  const out = []
  const freqs = route.frequencies
  if (!freqs || freqs.length === 0) return out

  for (const band of freqs) {
    if (band.headway <= 0) continue
    const dur = band.tripDur || route.tripDuration || 1800

    for (let dep = band.startSec; dep < band.endSec; dep += band.headway) {
      const elapsed = simTime - dep
      if (elapsed < 0 || elapsed > dur) continue
      out.push({ progress: elapsed / dur })
    }
  }
  return out
}

// ── Component ───────────────────────────────────────────────
export default function GtfsMap({
  simTime, playing, selectedRoute,
  onStats, onReady, onProgress, onRoutesLoaded, mapRef: externalMapRef,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const stateRef = useRef({ simTime, playing, selectedRoute })

  useEffect(() => { stateRef.current.simTime = simTime }, [simTime])
  useEffect(() => { stateRef.current.playing = playing }, [playing])
  useEffect(() => { stateRef.current.selectedRoute = selectedRoute }, [selectedRoute])

  useEffect(() => {
    if (mapRef.current) return
    let cancelled = false
    let animId = null

    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution:
              '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'carto-dark' }],
      },
      center: [-3.7038, 40.4168],
      zoom: 12,
      maxBounds: [[-4.1, 40.05], [-3.2, 40.75]],
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map
    if (externalMapRef) externalMapRef.current = map

    map.on('load', async () => {
      if (cancelled) return
      try {
        // ── Load data ──────────────────────────────────
        onProgress('Descargando rutas EMT…')
        const [routes, stops] = await Promise.all([
          fetchJSON('emt-routes.json'),
          fetchJSON('emt-stops.json'),
        ])
        if (cancelled) return
        onRoutesLoaded(routes)

        // ── Pac-Man icons ──────────────────────────────
        map.addImage('pacman', createPacmanIcon(48, '#FFD700'))
        map.addImage('pacman-hl', createPacmanIcon(48, '#00FF88'))

        // ── Pre-compute turf lineStrings ───────────────
        onProgress('Procesando rutas…')
        const routeGeo = routes.map(r => {
          const sh = r.shapes[0]
          if (!sh || sh.coordinates.length < 2) return null
          try {
            const line = turf.lineString(sh.coordinates)
            const len = turf.length(line, { units: 'kilometers' })
            return len > 0.05 ? { line, len } : null
          } catch { return null }
        })

        // ── Route lines ────────────────────────────────
        onProgress('Dibujando rutas…')
        const routeFeatures = []
        routes.forEach((r, ri) => {
          r.shapes.forEach(sh => {
            if (sh.coordinates.length < 2) return
            routeFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: sh.coordinates },
              properties: { color: r.color || routeColor(ri), routeId: r.id },
            })
          })
        })

        map.addSource('routes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: routeFeatures },
        })
        map.addLayer({
          id: 'routes-glow', type: 'line', source: 'routes',
          paint: {
            'line-color': ['get', 'color'], 'line-width': 5,
            'line-opacity': 0.08, 'line-blur': 3,
          },
        })
        map.addLayer({
          id: 'routes-line', type: 'line', source: 'routes',
          paint: {
            'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.35,
          },
        })

        // ── Highlight layer (selected route) ───────────
        map.addSource('highlight', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: 'hl-glow', type: 'line', source: 'highlight',
          paint: { 'line-color': '#FFD700', 'line-width': 8, 'line-opacity': 0.3, 'line-blur': 4 },
        })
        map.addLayer({
          id: 'hl-line', type: 'line', source: 'highlight',
          paint: { 'line-color': '#FFD700', 'line-width': 3, 'line-opacity': 0.9 },
        })

        // ── Stop pellets ───────────────────────────────
        onProgress('Colocando paradas…')
        const pelletFeatures = stops.map(s => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: s.coords },
          properties: { id: s.id, name: s.name, eaten: 0 },
        }))

        map.addSource('pellets', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: pelletFeatures },
        })
        map.addLayer({
          id: 'pellets-glow', type: 'circle', source: 'pellets',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 17, 11],
            'circle-color': '#FFD700',
            'circle-opacity': ['case', ['==', ['get', 'eaten'], 1], 0, 0.15],
            'circle-blur': 1,
          },
        })
        map.addLayer({
          id: 'pellets-dot', type: 'circle', source: 'pellets',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 4, 17, 6],
            'circle-color': '#FFD700',
            'circle-opacity': ['case', ['==', ['get', 'eaten'], 1], 0, 0.75],
          },
        })

        // Build stop → routes index for popup
        const stopRoutes = {}
        for (const r of routes) {
          for (const sh of r.shapes) {
            for (const s of sh.stops) {
              if (!stopRoutes[s.id]) stopRoutes[s.id] = new Set()
              stopRoutes[s.id].add(r.shortName)
            }
          }
        }

        map.on('click', 'pellets-dot', e => {
          const f = e.features[0]
          const sid = f.properties.id
          const rNames = stopRoutes[sid] ? [...stopRoutes[sid]].sort((a,b) => a.localeCompare(b, undefined, {numeric:true})) : []
          const routeList = rNames.length
            ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">${rNames.map(n => `<span style="background:#333;color:#00FFFF;padding:2px 5px;border-radius:3px;font-size:7px">${n}</span>`).join('')}</div>`
            : ''
          new mapboxgl.Popup({ closeOnClick: true, maxWidth: '260px' })
            .setLngLat(f.geometry.coordinates)
            .setHTML(`<div style="color:#FFD700;font-size:10px">🟡 ${f.properties.name}</div>${routeList}`)
            .addTo(map)
        })
        map.on('mouseenter', 'pellets-dot', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'pellets-dot', () => { map.getCanvas().style.cursor = '' })

        // ── Bus sources + layers ───────────────────────
        map.addSource('buses', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        map.addLayer({
          id: 'bus-icon', type: 'symbol', source: 'buses',
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.55, 17, 0.8],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        })

        map.addLayer({
          id: 'bus-label', type: 'symbol', source: 'buses',
          layout: {
            'text-field': ['get', 'lineNumber'],
            'text-font': ['Open Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 9, 17, 12],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-offset': [0, 1.8],
          },
          paint: {
            'text-color': '#FFD700',
            'text-halo-color': '#000',
            'text-halo-width': 1.5,
          },
        })

        map.on('click', 'bus-icon', e => {
          const p = e.features[0].properties
          new mapboxgl.Popup({ closeOnClick: true })
            .setLngLat(e.features[0].geometry.coordinates)
            .setHTML(`
              <div style="line-height:1.8">
                <div style="color:#FFD700;font-size:12px">🟡 Línea ${p.lineNumber}</div>
                <div style="color:#bbb;font-size:8px;margin-top:2px">${p.routeName}</div>
                <div style="color:#777;font-size:7px;margin-top:2px">→ ${p.headsign}</div>
              </div>`)
            .addTo(map)
        })
        map.on('mouseenter', 'bus-icon', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'bus-icon', () => { map.getCanvas().style.cursor = '' })

        // ── Animation loop ─────────────────────────────
        const eatenAt = {}
        let lastHlId = null

        function tick() {
          if (cancelled) return
          const { simTime: t, selectedRoute: sel } = stateRef.current

          // Update highlight when selection changes
          if ((sel?.id ?? null) !== lastHlId) {
            lastHlId = sel?.id ?? null
            const hlF = []
            if (sel) {
              for (const sh of sel.shapes) {
                if (sh.coordinates.length >= 2) {
                  hlF.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: sh.coordinates },
                  })
                }
              }
            }
            const hs = map.getSource('highlight')
            if (hs) hs.setData({ type: 'FeatureCollection', features: hlF })
          }

          // Compute all active buses for current time
          const features = []
          const nowEaten = new Set()
          let busCount = 0

          routes.forEach((route, ri) => {
            const geo = routeGeo[ri]
            if (!geo) return

            const abs = activeBuses(route, t)
            for (const ab of abs) {
              const p = Math.max(0.001, Math.min(0.999, ab.progress))
              try {
                const pt = turf.along(geo.line, p * geo.len, { units: 'kilometers' })

                const isSelected = sel && route.id === sel.id
                features.push({
                  type: 'Feature',
                  geometry: pt.geometry,
                  properties: {
                    lineNumber: route.shortName,
                    routeName: route.longName,
                    headsign: route.shapes[0]?.headsign || '',
                    color: route.color || routeColor(ri),
                    icon: isSelected ? 'pacman-hl' : 'pacman',
                  },
                })
                busCount++

                // Eat nearby stops
                const sh = route.shapes[0]
                if (sh?.stops?.length) {
                  const totalD = sh.stops[sh.stops.length - 1]?.dist || 1
                  for (const s of sh.stops) {
                    if (Math.abs(p - s.dist / totalD) < 0.015) nowEaten.add(s.id)
                  }
                }
              } catch { /* skip */ }
            }
          })

          // Push bus positions
          const bs = map.getSource('buses')
          if (bs) bs.setData({ type: 'FeatureCollection', features })
          onStats({ routes: routes.length, buses: busCount })

          // Pellet eating
          const now = performance.now()
          for (const id of nowEaten) eatenAt[id] = now

          if (Math.round(now / 16) % 12 === 0) {
            const pf = stops.map(s => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: s.coords },
              properties: {
                id: s.id, name: s.name,
                eaten: (eatenAt[s.id] && now - eatenAt[s.id] < PELLET_RESPAWN) ? 1 : 0,
              },
            }))
            const ps = map.getSource('pellets')
            if (ps) ps.setData({ type: 'FeatureCollection', features: pf })
          }

          animId = requestAnimationFrame(tick)
        }

        animId = requestAnimationFrame(tick)
        onReady()
      } catch (err) {
        console.error(err)
        onProgress('Error: ' + err.message)
      }
    })

    return () => {
      cancelled = true
      if (animId) cancelAnimationFrame(animId)
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="map-wrap" />
}
