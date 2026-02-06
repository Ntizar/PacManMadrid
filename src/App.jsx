import { useState, useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import GtfsMap from './GtfsMap'

/* seconds → "HH:MM" */
function fmtTime(sec) {
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/* Format a frequency band for display */
function fmtBand(b) {
  return `${fmtTime(b.startSec)} – ${fmtTime(b.endSec)}  ·  cada ${Math.round(b.headway / 60)} min`
}

const SIM_SPEED = 60 // 1 simulated minute per real second

const T_MIN = 5 * 3600   // 05:00
const T_MAX = 26 * 3600  // 02:00 next day

export default function App() {
  const [simTime, setSimTime] = useState(8 * 3600) // 08:00
  const [playing, setPlaying] = useState(true)
  const [stats, setStats] = useState({ routes: 0, buses: 0 })
  const [loading, setLoading] = useState(true)
  const [loadMsg, setLoadMsg] = useState('Cargando…')
  const [routes, setRoutes] = useState([])
  const [query, setQuery] = useState('')
  const [selRoute, setSelRoute] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const lastT = useRef(null)
  const raf = useRef(null)
  const mapRef = useRef(null) // to call fitBounds

  // ── Advance simulation clock ───────────────────────────
  useEffect(() => {
    if (!playing) { lastT.current = null; return }
    function step(ts) {
      if (lastT.current !== null) {
        const dt = (ts - lastT.current) / 1000
        setSimTime(prev => {
          let n = prev + dt * SIM_SPEED
          if (n > T_MAX) n = T_MIN
          return n
        })
      }
      lastT.current = ts
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [playing])

  // ── Filter routes for search ───────────────────────────
  const filtered = routes.filter(r => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      r.shortName.toLowerCase().includes(q) ||
      r.longName.toLowerCase().includes(q)
    )
  })

  const handleRoutePick = useCallback(r => {
    const deselect = selRoute?.id === r.id
    setSelRoute(deselect ? null : r)
    // Focus map on route bounds
    if (!deselect && mapRef.current) {
      const coords = r.shapes.flatMap(sh => sh.coordinates)
      if (coords.length > 0) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(coords[0], coords[0])
        )
        mapRef.current.fitBounds(bounds, { padding: 80, duration: 800 })
      }
    }
  }, [selRoute])

  return (
    <>
      {/* ── Loading ──────────────────────────────────── */}
      {loading && (
        <div className="loading-overlay">
          <h1>PACMAN MADRID</h1>
          <div className="loading-dots"><span /><span /><span /></div>
          <p>{loadMsg}</p>
        </div>
      )}

      {/* ── Header ───────────────────────────────────── */}
      <div className="hud-top">
        <div className="hud-left">
          <h1>🎮 PACMAN MADRID</h1>
          <div className="hud-stats">
            <span>🟡 <b>{stats.buses}</b> buses</span>
            <span>🛤️ <b>{stats.routes}</b> rutas</span>
          </div>
        </div>

        <div className="hud-clock">{fmtTime(simTime)}</div>

        <button
          className="panel-toggle"
          onClick={() => setPanelOpen(p => !p)}
          title="Buscar líneas"
        >
          {panelOpen ? '✕' : '🔍'}
        </button>
      </div>

      {/* ── Map ──────────────────────────────────────── */}
      <GtfsMap
        simTime={simTime}
        playing={playing}
        selectedRoute={selRoute}
        onStats={setStats}
        onReady={() => setLoading(false)}
        onProgress={setLoadMsg}
        onRoutesLoaded={setRoutes}
        mapRef={mapRef}
      />

      {/* ── Search Panel ─────────────────────────────── */}
      {panelOpen && (
        <div className="search-panel">
          <input
            type="text"
            className="search-input"
            placeholder="Buscar línea…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />

          <div className="search-results">
            {filtered.slice(0, 60).map(r => (
              <div
                key={r.id}
                className={`sr-item${selRoute?.id === r.id ? ' sel' : ''}`}
                onClick={() => handleRoutePick(r)}
              >
                <div className="sr-head">
                  <span className="sr-badge" style={{ background: r.color }}>
                    {r.shortName}
                  </span>
                  <span className="sr-name">{r.longName}</span>
                </div>

                {selRoute?.id === r.id && r.frequencies?.length > 0 && (
                  <div className="sr-sched">
                    <div className="sr-sched-title">Frecuencias ({r.frequencies.length} bandas)</div>
                    {r.frequencies.map((b, i) => (
                      <div key={i} className="sr-band">{fmtBand(b)}</div>
                    ))}
                  </div>
                )}
                {selRoute?.id === r.id && r.shapes?.[0]?.stops?.length > 0 && (
                  <div className="sr-sched">
                    <div className="sr-sched-title">Paradas ({r.shapes[0].stops.length})</div>
                    {r.shapes[0].stops.map((s, i) => (
                      <div key={i} className="sr-band">{s.name}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="sr-empty">No se encontraron líneas</div>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom controls ──────────────────────────── */}
      <div className="hud-bottom">
        <button onClick={() => setPlaying(p => !p)} className="active">
          {playing ? '⏸' : '▶'}
        </button>

        <div className="divider" />

        <input
          type="range"
          className="time-slider"
          min={T_MIN}
          max={T_MAX}
          step={60}
          value={simTime}
          onChange={e => setSimTime(Number(e.target.value))}
        />
        <span className="time-display">{fmtTime(simTime)}</span>
      </div>

      {/* ── Credit ───────────────────────────────────── */}
      <div className="credit">Visualizador realizado por David Antizar</div>
    </>
  )
}
