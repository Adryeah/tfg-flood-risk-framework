import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Copy,
  Check,
} from 'lucide-react';

// Renamed `Map` → `MapCanvas` so it doesn't shadow the global JS `Map`
// constructor — `new Map(entries)` inside the portfolioStats useMemo was
// resolving to the React component and throwing `Map is not a constructor`.
import {
  Map as MapCanvas,
  MapClusterLayer,
  MapMarker,
  MarkerContent,
  MapControls,
  useMap,
} from '@/components/Map.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/info-hint';

import { api } from '@/lib/api.js';
import { ZONES } from '@/lib/constants.js';
import { useHashParams } from '@/lib/hash-params.js';

// ─── Product palette (consistent with Portfolio Explorer / Exposure) ──
const PRODUCT_COLORS = {
  particulares: '#2563EB', // brand-500 blue
  pymes: '#D97706', // amber
  autos: '#7C3AED', // violet
};
const PRODUCT_LABEL = {
  particulares: 'Particulares',
  pymes: 'Pymes',
  autos: 'Autos',
};
const RISK_COLORS = {
  low: '#16A34A',
  moderate: '#D97706',
  high: '#DC2626',
  very_high: '#991B1B',
};
const RISK_BG = {
  low: '#ECFDF5',
  moderate: '#FFFBEB',
  high: '#FEF2F2',
  very_high: '#FEF2F2',
};

// ─── Backwards-compat helper ─────────────────────────────────
// Old clients pre-C1 only had `type` (residential/commercial/industrial).
// New clients have `product` directly. We coerce here so the view doesn't
// have to branch everywhere.
function productOf(client) {
  if (client.product) return client.product;
  if (client.type === 'residential') return 'particulares';
  if (client.type === 'auto') return 'autos';
  return 'pymes'; // commercial + industrial collapse here
}

// ─── Haversine distance in km (no external dep) ──────────────
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aa =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

const SORTS = {
  risk_desc: {
    label: 'Riesgo · mayor primero',
    key: (c) => -(c.risk_probability ?? 0),
  },
  loss_desc: {
    label: 'Pérdida · mayor primero',
    key: (c) => -(c.estimated_loss_dana ?? 0),
  },
  value_desc: {
    label: 'Valor · mayor primero',
    key: (c) => -(c.insured_value ?? 0),
  },
};

const PRODUCT_FILTER_VALUES = ['all', 'particulares', 'pymes', 'autos'];

export function PolicyMap() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [productFilter, setProductFilter] = useState('all');
  const [sortKey, setSortKey] = useState('risk_desc');
  const [selectedClientId, setSelectedClientId] = useState(null);

  // URL hash params — drive (and reflect) selection so search results
  // and "open in Policy Map" deeplinks work.
  //   ?p=<portfolio_id>   active portfolio
  //   ?policy=<id>        pre-selected policy (focus on load)
  const [hashParams, setHashParams] = useHashParams();

  // 1) Load portfolio index
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.portfolio.getPredefined();
        if (!mounted) return;
        const list = res?.portfolios || [];
        setPortfolios(list);
        // Initial selection priority:
        //   1. ?p=<id> from URL
        //   2. wide_distribution (1000-client demo)
        //   3. First in list
        const fromUrl = hashParams.p && list.find((p) => p.id === hashParams.p);
        const preferred =
          fromUrl ||
          list.find((p) => p.id === 'wide_distribution') ||
          list[0];
        if (preferred) setSelectedPortfolioId(preferred.id);
      } catch (err) {
        console.error('Policy Map · portfolios failed', err);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync portfolio + selected policy ids into the URL so this view is
  // shareable via link (?p=...&policy=...).
  //
  // Guard with the current hashParams to avoid the dispatch loop:
  // setHashParams → hashchange → setParamsState → re-render → effect →
  // setHashParams. Even though setHashParams won't dispatch when the
  // hash is identical, we ALSO short-circuit at the effect level so
  // React doesn't see useless state churn.
  useEffect(() => {
    const nextP = selectedPortfolioId || undefined;
    const nextPolicy = selectedClientId || undefined;
    if (hashParams.p === (nextP || undefined) && hashParams.policy === (nextPolicy || undefined)) {
      return;
    }
    const next = {};
    if (nextP) next.p = nextP;
    if (nextPolicy) next.policy = nextPolicy;
    setHashParams(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortfolioId, selectedClientId]);

  // 2) Load selected portfolio (full client list)
  useEffect(() => {
    if (!selectedPortfolioId) return;
    let mounted = true;
    setLoading(true);
    setSelectedClientId(null);
    (async () => {
      try {
        const p = await api.portfolio.getById(selectedPortfolioId);
        if (!mounted) return;
        setPortfolio(p);
      } catch (err) {
        console.error('Policy Map · portfolio load failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedPortfolioId]);

  // 3) Filter + sort the clients
  const orderedClients = useMemo(() => {
    if (!portfolio?.clients) return [];
    const passes = (c) =>
      productFilter === 'all' || productOf(c) === productFilter;
    const sorter = SORTS[sortKey].key;
    return [...portfolio.clients]
      .filter(passes)
      .sort((a, b) => sorter(a) - sorter(b));
  }, [portfolio, productFilter, sortKey]);

  // 4) Auto-select policy on order change. Preferences:
  //   1. ?policy=<id> from URL — applied ONCE on initial load only.
  //      We snapshot the URL value into a ref so the effect doesn't
  //      keep re-firing on every hash change (which caused the
  //      infinite loop after URL sync wrote the same policy back).
  //   2. Current selectedClientId if still in the filtered list.
  //   3. First in order.
  const initialUrlPolicyRef = useRef(hashParams.policy);
  useEffect(() => {
    if (!orderedClients.length) {
      return;
    }
    // One-shot consume of the URL policy. After this fires, the ref is
    // cleared and subsequent renders use the standard "first in order"
    // fallback when the current selection drops out of the filtered list.
    const urlPolicy = initialUrlPolicyRef.current;
    if (
      urlPolicy &&
      urlPolicy !== selectedClientId &&
      orderedClients.find((c) => c.id === urlPolicy)
    ) {
      setSelectedClientId(urlPolicy);
      initialUrlPolicyRef.current = null;
      return;
    }
    if (
      !selectedClientId ||
      !orderedClients.find((c) => c.id === selectedClientId)
    ) {
      setSelectedClientId(orderedClients[0].id);
    }
  }, [orderedClients, selectedClientId]);

  // 5) Portfolio-level aggregates (memo so we don't recompute on every nav)
  const portfolioStats = useMemo(() => {
    if (!portfolio?.clients) return null;
    const all = portfolio.clients;
    const totalPml = all.reduce(
      (s, c) => s + (c.estimated_loss_dana || 0),
      0
    );
    const totalTiv = all.reduce((s, c) => s + (c.insured_value || 0), 0);
    const sortedByRisk = [...all].sort(
      (a, b) => (b.risk_probability || 0) - (a.risk_probability || 0)
    );
    const rankByRisk = new Map(
      sortedByRisk.map((c, i) => [c.id, i + 1])
    );

    // P(flood) histogram (10 bins)
    const bins = new Array(10).fill(0);
    for (const c of all) {
      const p = c.risk_probability || 0;
      const idx = Math.min(9, Math.floor(p * 10));
      bins[idx] += 1;
    }
    const maxBin = Math.max(...bins, 1);

    // Pre-extract high-risk policies for nearest-high-risk distance lookup
    const highRiskPolicies = all.filter(
      (c) => c.risk_category === 'high' || c.risk_category === 'very_high'
    );

    return {
      n: all.length,
      totalPml,
      totalTiv,
      rankByRisk,
      sortedByRisk,
      bins,
      maxBin,
      highRiskPolicies,
    };
  }, [portfolio]);

  const selectedClient = useMemo(() => {
    if (!selectedClientId || !portfolio?.clients) return null;
    return portfolio.clients.find((c) => c.id === selectedClientId) || null;
  }, [selectedClientId, portfolio]);

  const selectedIndexInOrder = useMemo(() => {
    if (!selectedClient || !orderedClients.length) return -1;
    return orderedClients.findIndex((c) => c.id === selectedClient.id);
  }, [orderedClients, selectedClient]);

  // GeoJSON for mapcn's <MapClusterLayer>. Same shape we use in Portfolio
  // Explorer — one Point feature per policy. Rebuilds only when the
  // filtered + sorted list changes (memo deps are tight).
  const clientsGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: orderedClients.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          id: c.id,
          product: productOf(c),
          risk_category: c.risk_category,
        },
      })),
    }),
    [orderedClients]
  );

  const goPrev = () => {
    if (selectedIndexInOrder <= 0) return;
    setSelectedClientId(orderedClients[selectedIndexInOrder - 1].id);
  };
  const goNext = () => {
    if (selectedIndexInOrder >= orderedClients.length - 1) return;
    setSelectedClientId(orderedClients[selectedIndexInOrder + 1].id);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] gap-2 p-3 sm:p-4 pb-3">
      {/* Header — slim single line so the map gets maximum vertical room. */}
      <div className="flex items-center justify-between gap-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-18 font-semibold text-text-primary tracking-tight">
            Policy Map
          </h1>
          <Badge
            variant="secondary"
            className="bg-brand-50 text-brand-700 hover:bg-brand-50 text-10 font-mono uppercase tracking-wider"
          >
            Single-policy inspector
          </Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={selectedPortfolioId || ''}
            onValueChange={(v) => v && setSelectedPortfolioId(v)}
          >
            <SelectTrigger className="w-full sm:w-[240px] h-8 text-12">
              <SelectValue placeholder="Select portfolio" />
            </SelectTrigger>
            <SelectContent>
              {portfolios.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-12">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs value={productFilter} onValueChange={setProductFilter}>
            <TabsList className="h-8">
              {PRODUCT_FILTER_VALUES.map((v) => (
                <TabsTrigger
                  key={v}
                  value={v}
                  className="text-11 font-mono uppercase tracking-wider px-2"
                >
                  {v === 'all' ? 'All' : PRODUCT_LABEL[v]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Select value={sortKey} onValueChange={setSortKey}>
            <SelectTrigger className="w-[200px] h-8 text-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SORTS).map(([k, def]) => (
                <SelectItem key={k} value={k} className="text-12">
                  {def.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Map full-bleed + horizontal bottom dock with policy info.
       *  The map takes all remaining vertical space; the dock sits below
       *  at a fixed ~180px height so policy details stay visible while
       *  the user pans/zooms the map. */}
      <div
        className="rounded shadow-sm border border-border-default overflow-hidden bg-bg-surface relative flex-1 min-h-0"
        style={{ minHeight: 520 }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-base/40 z-[10]">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        )}
        <MapCanvas
          // Center the camera on the combined Valencia + Algemesí bbox so
          // the initial paint already shows the full portfolio extent (the
          // FitToPolicies effect then snaps to the exact feature bounds).
          center={[
            (Math.min(ZONES.valencia.bbox[0], ZONES.algemesi.bbox[0]) +
              Math.max(ZONES.valencia.bbox[2], ZONES.algemesi.bbox[2])) /
              2,
            (Math.min(ZONES.valencia.bbox[1], ZONES.algemesi.bbox[1]) +
              Math.max(ZONES.valencia.bbox[3], ZONES.algemesi.bbox[3])) /
              2,
          ]}
          zoom={10}
          minZoom={8}
          maxZoom={16}
          className="h-full w-full"
        >
          <MapControls />
          <RiskBackdrop />

          {/* Auto-fit the camera to the actual extent of policies on first
              load — center calc above is a fallback for the initial paint
              before features arrive. After fitting, the user can pan
              freely; the ref guard prevents re-fitting on every nav. */}
          {clientsGeoJSON.features.length > 0 && (
            <FitToPolicies features={clientsGeoJSON.features} />
          )}

          {/* Active policies — clustered with mapcn's MapClusterLayer.
              At low zoom (≤13) policies are clustered; click an
              individual point only fires after expanding. To make the
              map "always selectable", `ClickToSelectPolicy` below
              listens to ALL map clicks and selects the nearest policy
              within a zoom-aware threshold — so the dock updates
              whether you click a cluster, a point, or empty land
              between them. */}
          {clientsGeoJSON.features.length > 0 && (
            <>
              <MapClusterLayer
                data={clientsGeoJSON}
                clusterRadius={45}
                clusterMaxZoom={13}
                clusterColors={['#3B82F6', '#1D4ED8', '#1E3A8A']}
                clusterThresholds={[40, 200]}
                pointColor="#2563EB"
                onPointClick={(feature) => {
                  setSelectedClientId(feature.properties.id);
                }}
              />
              <ClickToSelectPolicy
                clients={orderedClients}
                onSelect={setSelectedClientId}
              />
            </>
          )}

          {/* Selected policy — distinctive dark marker + camera focus. */}
          {selectedClient && (
            <>
              <SelectedFocus
                longitude={selectedClient.lon}
                latitude={selectedClient.lat}
              />
              <MapMarker
                longitude={selectedClient.lon}
                latitude={selectedClient.lat}
              >
                <MarkerContent>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: '#FFFFFF',
                      border: '3px solid #0F172A',
                      boxShadow: '0 1px 3px rgba(15,23,42,0.35)',
                    }}
                  />
                </MarkerContent>
              </MapMarker>
            </>
          )}
        </MapCanvas>
      </div>

      {/* Bottom dock — horizontal policy detail strip. 4 cells:
          Nav · Policy ficha · Position in portfolio · Distribution. */}
      <PolicyDock
        current={selectedIndexInOrder + 1}
        total={orderedClients.length}
        onPrev={goPrev}
        onNext={goNext}
        disabledPrev={selectedIndexInOrder <= 0}
        disabledNext={selectedIndexInOrder >= orderedClients.length - 1}
        client={selectedClient}
        stats={portfolioStats}
        loading={loading}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Map child components — they use useMap() to get the maplibre
// instance from the mapcn Map context.
// ────────────────────────────────────────────────────────────

/** Risk-surface fill underneath the policy points. Loads BOTH study
 *  areas (Valencia + Algemesí) so the backdrop matches el extent real
 *  del wide_distribution portfolio (que cruza ambas zonas).
 *
 *  Usa los raster tiles pre-renderizados (/api/tiles/…) en vez del
 *  geojson — fidelidad píxel-perfect al RF, opacidad bajada para que
 *  los cluster markers de pólizas destaquen encima. */
function RiskBackdrop() {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const zones = ['valencia', 'algemesi'];
    for (const zone of zones) {
      const sourceId = `risk-backdrop-${zone}`;
      const layerId = `risk-backdrop-${zone}`;
      if (map.getSource(sourceId)) continue;
      map.addSource(sourceId, {
        type: 'raster',
        tiles: [api.risk.tilesUrl(zone)],
        tileSize: 256,
        minzoom: 10,
        maxzoom: 15,
        attribution: 'Random Forest v2 · TFG Vargas (UAB)',
      });
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          // Opacidad baja para que los cluster markers destaquen encima.
          'raster-opacity': 0.45,
          'raster-resampling': 'linear',
        },
      });
    }
  }, [map, isLoaded]);
  return null;
}

/** Once-only camera fit to the actual extent of policies. Fires when the
 *  first non-empty feature collection arrives; the ref guard prevents
 *  re-fitting on every Prev/Next nav (that's `SelectedFocus`'s job). */
function FitToPolicies({ features }) {
  const { map, isLoaded } = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || fitted.current) return;
    if (!features?.length) return;
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    if (!Number.isFinite(minLng)) return;
    // Tight padding so the cluster fills the viewport instead of
    // floating in empty space. Asymmetric padding (more on the bottom)
    // leaves room for the dock without cropping the southernmost
    // policies. maxZoom 13 allows a tighter frame than the previous 12.
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: { top: 28, bottom: 60, left: 32, right: 32 },
      maxZoom: 13,
      duration: 0,
    });
    fitted.current = true;
  }, [map, isLoaded, features]);
  return null;
}

/** Pans (and gently zooms when needed) the map so the currently-selected
 *  policy is always visible. With mapcn's MapClusterLayer at
 *  clusterMaxZoom=13, the selected point can be hidden inside a cluster
 *  when zoomed out — we bump to zoom 14 to force the cluster to expand. */
function SelectedFocus({ longitude, latitude }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || longitude == null || latitude == null) return;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    map.easeTo({
      center: [longitude, latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: 600,
    });
  }, [map, isLoaded, longitude, latitude]);
  return null;
}

// ─── Click-anywhere policy picker ─────────────────────────────────
// Listens to ALL map clicks (not bound to a specific layer). On click,
// finds the closest policy (by haversine distance) and selects it if
// within a zoom-aware threshold. This way the user can:
//   - Click an individual unclustered point (already worked)
//   - Click a cluster bubble → the nearest policy becomes selected
//   - Click empty land near policies → still picks the closest
//
// Threshold scales with zoom so the picker is forgiving at low zoom
// (when each pixel is many metres) and precise at high zoom.
// ───────────────────────────────────────────────────────────────────
function ClickToSelectPolicy({ clients, onSelect }) {
  const { map, isLoaded } = useMap();
  // Stable refs so the click handler doesn't re-bind on every selection
  // change (which would otherwise miss subsequent clicks while React
  // is between renders).
  const clientsRef = useRef(clients);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    clientsRef.current = clients;
    onSelectRef.current = onSelect;
  }, [clients, onSelect]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const handle = (e) => {
      const { lng, lat } = e.lngLat;
      const list = clientsRef.current || [];
      if (!list.length) return;
      let nearest = null;
      let bestKm = Infinity;
      for (const c of list) {
        const d = haversineKm({ lat, lon: lng }, { lat: c.lat, lon: c.lon });
        if (d < bestKm) {
          bestKm = d;
          nearest = c;
        }
      }
      if (!nearest) return;
      // Zoom-aware threshold: at zoom 10 → 5 km tolerance,
      // at zoom 14+ → 0.3 km tolerance. Logarithmic falloff.
      const z = map.getZoom();
      const thresholdKm = Math.max(0.2, 25 / Math.pow(2, z - 9));
      if (bestKm <= thresholdKm) {
        onSelectRef.current?.(nearest.id);
      }
    };
    map.on('click', handle);
    return () => {
      map.off('click', handle);
    };
  }, [map, isLoaded]);
  return null;
}

// ────────────────────────────────────────────────────────────
// PolicyDock — horizontal bottom strip with 4 cells:
//   ① Nav + counter   ② Policy ficha   ③ Position in portfolio
//   ④ P(flood) distribution histogram
// Replaces the old vertical impact rail so the map gets the entire
// above-the-dock viewport.
// ────────────────────────────────────────────────────────────
const PRODUCT_BADGE_COLOR = {
  particulares: '#2563EB',
  pymes: '#D97706',
  autos: '#7C3AED',
};
const DOCK_RISK_FG = {
  low: '#16A34A',
  moderate: '#D97706',
  high: '#DC2626',
  very_high: '#991B1B',
};
const DOCK_RISK_BG = {
  low: '#ECFDF5',
  moderate: '#FFFBEB',
  high: '#FEF2F2',
  very_high: '#FEF2F2',
};

function PolicyDock({
  current,
  total,
  onPrev,
  onNext,
  disabledPrev,
  disabledNext,
  client,
  stats,
  loading,
}) {
  return (
    <div
      className="shrink-0 bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden"
      style={{ height: 168 }}
    >
      <div
        className="grid h-full divide-x divide-border-default"
        style={{
          gridTemplateColumns:
            '180px minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr)',
        }}
      >
        <DockNavCell
          current={current}
          total={total}
          onPrev={onPrev}
          onNext={onNext}
          disabledPrev={disabledPrev}
          disabledNext={disabledNext}
        />
        <DockPolicyCell client={client} loading={loading} />
        <DockPositionCell client={client} stats={stats} />
        <DockDistCell
          bins={stats?.bins}
          maxBin={stats?.maxBin}
          highlightP={client?.risk_probability}
        />
      </div>
    </div>
  );
}

function DockNavCell({
  current,
  total,
  onPrev,
  onNext,
  disabledPrev,
  disabledNext,
}) {
  return (
    <div className="px-4 py-3 flex flex-col justify-between min-w-0">
      <div>
        <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Policy
        </div>
        <div className="mt-1 text-22 font-mono font-semibold text-text-primary tabular-nums leading-none tracking-tight">
          {(current ?? 0).toLocaleString()}
          <span className="text-text-tertiary text-14">
            {' / '}
            {(total ?? 0).toLocaleString()}
          </span>
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={disabledPrev}
          className="h-8 px-2 flex-1"
        >
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={disabledNext}
          className="h-8 px-2 flex-1"
        >
          <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

// Shared money formatter — matches Portfolio Explorer / Exposure dashboard.
function fmtMoneyDock(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) {
    const m = v / 1_000_000;
    const fixed = m.toFixed(1);
    return `€${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}M`;
  }
  return `€${(v / 1000).toFixed(0)}K`;
}

function DockPolicyCell({ client, loading }) {
  const [copied, setCopied] = useState(false);

  if (!client) {
    return (
      <div className="px-4 py-3 flex items-center text-12 text-text-tertiary">
        {loading ? 'Loading portfolio…' : 'No policy selected.'}
      </div>
    );
  }
  const prod = productOf(client);
  const cat = client.risk_category || 'low';
  const prodColor = PRODUCT_BADGE_COLOR[prod] || '#94A3B8';
  const riskFg = DOCK_RISK_FG[cat] || '#52525B';
  const riskBg = DOCK_RISK_BG[cat] || '#F4F4F5';
  const p = client.risk_probability ?? 0;

  const copyFicha = async () => {
    try {
      // Curate a clean subset (no internal lat/lon precision noise) and
      // copy as pretty JSON. This is the "operational" view of the row.
      const ficha = {
        id: client.id,
        product: prod,
        subtype: client.subtype,
        risk_category: cat,
        risk_probability: client.risk_probability,
        insured_value: client.insured_value,
        estimated_loss_flood: client.estimated_loss_dana,
        annual_premium: client.annual_premium,
        ground_floor: client.ground_floor,
        floor_count: client.floor_count,
        construction_year: client.construction_year,
        policy_start: client.policy_start,
        location: { lat: client.lat, lon: client.lon },
      };
      await navigator.clipboard.writeText(JSON.stringify(ficha, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked — silent */
    }
  };

  return (
    <div className="px-4 py-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <div className="font-mono text-11 text-text-tertiary truncate">
          {client.id}
        </div>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider shrink-0"
          style={{ background: prodColor + '1A', color: prodColor }}
        >
          {PRODUCT_LABEL[prod] || prod}
        </span>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider shrink-0"
          style={{ background: riskBg, color: riskFg }}
        >
          {cat.replace('_', ' ')}
        </span>
        <span className="text-11 text-text-secondary lowercase truncate">
          {client.subtype?.replace('_', ' ')}
        </span>
        <button
          type="button"
          onClick={copyFicha}
          className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-10 font-mono uppercase tracking-wider text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
          title="Copiar ficha como JSON al portapapeles"
        >
          {copied ? (
            <Check className="w-3 h-3" strokeWidth={2.5} />
          ) : (
            <Copy className="w-3 h-3" strokeWidth={1.75} />
          )}
          {copied ? 'Ficha copiada' : 'Copiar ficha'}
        </button>
      </div>

      {/* Risk-position gradient bar — 4 colour segments (low/mod/high/
       *  very-high) at 0.25 intervals, plus a vertical marker at the
       *  policy's actual P(flood). Reads as "where this policy sits in
       *  the risk continuum" without needing the badge to explain it. */}
      <RiskPositionBar p={p} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-11 mt-0.5">
        <DockMetric
          label="Insured"
          value={fmtMoneyDock(client.insured_value)}
        />
        <DockMetric label="P(flood)" value={p.toFixed(3)} />
        <DockMetric
          label="Est. loss"
          value={fmtMoneyDock(client.estimated_loss_dana || 0)}
          highlight
        />
        <DockMetric
          label="Premium"
          value={fmtMoneyDock(client.annual_premium || 0)}
        />
      </div>
    </div>
  );
}

// ─── Mini gradient bar: visual scale showing the policy's risk
// position in the [0, 1] probability continuum. Segments at 0.25
// intervals match the risk_category boundaries used everywhere else.
// The marker is a small triangle pointing down at the exact p value.
function RiskPositionBar({ p }) {
  const pct = Math.min(100, Math.max(0, (p ?? 0) * 100));
  return (
    <div className="relative h-1.5 w-full max-w-[280px] rounded-sm overflow-visible mt-0.5">
      <div
        className="absolute inset-0 rounded-sm"
        style={{
          background:
            'linear-gradient(90deg, #16A34A 0%, #16A34A 25%, #D97706 25%, #D97706 50%, #DC2626 50%, #DC2626 75%, #991B1B 75%, #991B1B 100%)',
          opacity: 0.55,
        }}
      />
      {/* Marker — small downward-pointing triangle at the policy's p */}
      <div
        className="absolute -top-1.5 -translate-x-1/2 transition-[left] duration-200"
        style={{ left: `${pct}%` }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '6px solid #0F172A',
            filter: 'drop-shadow(0 1px 1px rgba(15,23,42,0.35))',
          }}
        />
      </div>
    </div>
  );
}

function DockMetric({ label, value, highlight = false }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-10 font-mono uppercase tracking-wider text-text-tertiary truncate">
        {label}
      </span>
      <span
        className={
          'font-mono tabular-nums text-12 shrink-0 ' +
          (highlight ? 'text-risk-high font-semibold' : 'text-text-primary font-medium')
        }
      >
        {value}
      </span>
    </div>
  );
}

function DockPositionCell({ client, stats }) {
  if (!client || !stats) {
    return <div className="px-4 py-3 text-12 text-text-tertiary">{'—'}</div>;
  }
  const rank = stats.rankByRisk.get(client.id) || stats.n;
  const percentile = ((stats.n - rank + 1) / stats.n) * 100;
  const pmlShare =
    stats.totalPml > 0
      ? ((client.estimated_loss_dana || 0) / stats.totalPml) * 100
      : 0;
  const tivShare =
    stats.totalTiv > 0
      ? ((client.insured_value || 0) / stats.totalTiv) * 100
      : 0;

  // Nearest high-risk distance (excluding self)
  let nearestHrKm = null;
  for (const o of stats.highRiskPolicies) {
    if (o.id === client.id) continue;
    const d = haversineKm(client, o);
    if (nearestHrKm == null || d < nearestHrKm) nearestHrKm = d;
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Position in portfolio
        </span>
        <InfoHint side="bottom">
          {`How this single policy sits relative to the other ${stats.n.toLocaleString()} in the same cartera. Risk rank: sorted by P(flood). Percentile: 100 % = worst. PML share / TIV share: this policy's contribution to the total PML / total insured value. Nearest HR: Haversine distance to the nearest other high-risk policy — "< 50 m" means an effective cluster, useful to detect concentration risk.`}
        </InfoHint>
      </div>
      <DockRow
        k="Risk rank"
        v={'#' + rank.toLocaleString() + ' / ' + stats.n.toLocaleString()}
      />
      <DockRow k="Percentile" v={percentile.toFixed(1) + ' %'} />
      <DockRow
        k="PML share"
        v={pmlShare.toFixed(2) + ' %'}
        highlight={pmlShare > 1}
      />
      <DockRow k="TIV share" v={tivShare.toFixed(2) + ' %'} />
      <DockRow
        k="Nearest HR"
        v={
          nearestHrKm == null
            ? '—'
            : nearestHrKm < 0.05
              ? '< 50 m'
              : nearestHrKm.toFixed(2) + ' km'
        }
      />
    </div>
  );
}

function DockRow({ k, v, highlight = false }) {
  return (
    <div className="flex items-center justify-between gap-3 text-11">
      <span className="text-text-secondary truncate">{k}</span>
      <span
        className={
          'font-mono tabular-nums shrink-0 ' +
          (highlight ? 'text-risk-high font-semibold' : 'text-text-primary')
        }
      >
        {v}
      </span>
    </div>
  );
}

function DockDistCell({ bins, maxBin, highlightP }) {
  if (!bins || !maxBin) {
    return <div className="px-4 py-3 text-12 text-text-tertiary">{'—'}</div>;
  }
  const W = 240;
  const H = 90;
  const padX = 6;
  const padY = 10;
  const barW = (W - 2 * padX) / bins.length;
  const markerX = padX + (highlightP || 0) * (W - 2 * padX);

  // Determine which bin contains the highlighted P value — used for
  // visually emphasising "this bin is the policy's bin" on hover.
  const highlightBinIdx = highlightP != null
    ? Math.min(bins.length - 1, Math.floor((highlightP || 0) * bins.length))
    : -1;

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5 min-w-0">
      <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
        P(flood) distribution
      </div>
      <svg
        viewBox={'0 0 ' + W + ' ' + H}
        width="100%"
        className="block flex-1"
        preserveAspectRatio="none"
        role="img"
        aria-label="Distribución de probabilidad de inundación de las pólizas"
      >
        {bins.map((count, i) => {
          const h = (count / maxBin) * (H - 2 * padY);
          const binMin = (i / bins.length).toFixed(2);
          const binMax = ((i + 1) / bins.length).toFixed(2);
          const isHighlight = i === highlightBinIdx;
          return (
            <g key={i}>
              <rect
                x={padX + i * barW + 1}
                y={H - padY - h}
                width={Math.max(barW - 2, 1)}
                height={h}
                fill={isHighlight ? '#FCA5A5' : '#DCE6F5'}
                rx="1"
              >
                {/* Native SVG tooltip — appears on hover with count + range */}
                <title>
                  {`P ∈ [${binMin}, ${binMax}) · ${count.toLocaleString()} pólizas`}
                </title>
              </rect>
              {/* Invisible wider hit zone so hover is forgiving */}
              <rect
                x={padX + i * barW}
                y={0}
                width={barW}
                height={H}
                fill="transparent"
              >
                <title>
                  {`P ∈ [${binMin}, ${binMax}) · ${count.toLocaleString()} pólizas`}
                </title>
              </rect>
            </g>
          );
        })}
        <line
          x1={markerX}
          x2={markerX}
          y1={padY - 2}
          y2={H - padY + 4}
          stroke="#DC2626"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={markerX} cy={padY - 2} r={3.5} fill="#DC2626" />
      </svg>
      <div className="flex items-center justify-between text-10 font-mono text-text-tertiary tabular-nums">
        <span>0.00</span>
        <span>
          {'P = '}
          <span className="text-text-primary font-medium">
            {(highlightP ?? 0).toFixed(3)}
          </span>
        </span>
        <span>1.00</span>
      </div>
    </div>
  );
}
