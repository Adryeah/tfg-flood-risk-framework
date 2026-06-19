/**
 * Fixture permanente de floodGeometry — ejecutable con node directo
 * (el proyecto no tiene vitest/jest todavía):
 *
 *   node src/utils/floodGeometry.test.mjs
 *
 * Cada caso es un escenario real de underwriting de la DANA. Si algún día
 * se añade vitest, estos asserts se portan a `expect()` 1:1.
 */
import assert from 'node:assert/strict';
import {
  getFloorMinHeight,
  getFloorMaxHeight,
  floodReachesFloor,
  getExposureFactor,
  inflatePolygon,
  squareFootprint,
  pointInPolygon,
} from './floodGeometry.js';

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

// ── Alturas de planta ────────────────────────────────────────────────
ok('PB(0): base 0 m, techo 3 m', () => {
  assert.equal(getFloorMinHeight(0), 0);
  assert.equal(getFloorMaxHeight(0), 3);
});
ok('P1(1): base 3 m, techo 6 m', () => {
  assert.equal(getFloorMinHeight(1), 3);
  assert.equal(getFloorMaxHeight(1), 6);
});
ok('parking(-1): base -3 m, techo 0 m', () => {
  assert.equal(getFloorMinHeight(-1), -3);
  assert.equal(getFloorMaxHeight(-1), 0);
});

// ── ¿Alcanza el agua? (cotas absolutas m.s.n.m) ─────────────────────
ok('PB en suelo 10 m, lámina 11.5 m → entra 1.5 m', () => {
  const r = floodReachesFloor(0, 10, 11.5);
  assert.equal(r.reaches, true);
  assert.equal(r.marginMeters, 1.5);
});
ok('P1 (base 13 m) con lámina 11.5 m → seca, margen -1.5 m', () => {
  const r = floodReachesFloor(1, 10, 11.5);
  assert.equal(r.reaches, false);
  assert.equal(r.marginMeters, -1.5);
});
ok('parking (base 7 m) con lámina 11.5 m → inunda 4.5 m', () => {
  const r = floodReachesFloor(-1, 10, 11.5);
  assert.equal(r.reaches, true);
  assert.equal(r.marginMeters, 4.5);
});
ok('margen redondeado a 1 decimal', () => {
  assert.equal(floodReachesFloor(0, 10, 10.04).marginMeters, 0); // 0.04 → 0.0
  assert.equal(floodReachesFloor(0, 10, 10.16).marginMeters, 0.2);
});

// ── Factor de exposición por tipo + planta ──────────────────────────
ok('local_comercial: PB 1.0x, sótano 1.4x, alto 0.2x', () => {
  assert.equal(getExposureFactor('local_comercial', 0), 1.0);
  assert.equal(getExposureFactor('local_comercial', -1), 1.4);
  assert.equal(getExposureFactor('local_comercial', 2), 0.2);
});
ok('parking subterráneo 1.4x, en superficie 0.3x', () => {
  assert.equal(getExposureFactor('parking', -1), 1.4);
  assert.equal(getExposureFactor('parking', 0), 0.3);
});
ok('ático siempre 0.05x (inmune)', () => {
  assert.equal(getExposureFactor('atico', 5), 0.05);
  assert.equal(getExposureFactor('atico', 0), 0.05);
});
ok('tipo desconocido cae a default', () => {
  assert.equal(getExposureFactor('foo_bar', 0), 1.0);
  assert.equal(getExposureFactor('foo_bar', 3), 0.15);
});

// ── Inflado de polígono (anti z-fight) ──────────────────────────────
ok('inflatePolygon escala desde centroide y conserva nº de vértices', () => {
  const sq = {
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]],
  };
  const out = inflatePolygon(sq, 2); // centroide (0.8,0.8) con el [0,0] duplicado de cierre
  assert.equal(out.type, 'Polygon');
  assert.equal(out.coordinates[0].length, sq.coordinates[0].length);
  // factor 2 desde un centroide interior aleja todos los vértices del centro
  const [cx, cy] = [0.8, 0.8];
  const farther = out.coordinates[0].every(([x, y], i) => {
    const [ox, oy] = sq.coordinates[0][i];
    const dOld = Math.hypot(ox - cx, oy - cy);
    const dNew = Math.hypot(x - cx, y - cy);
    return dNew >= dOld - 1e-9;
  });
  assert.equal(farther, true);
});
ok('inflatePolygon ignora geometrías no-polígono', () => {
  const pt = { type: 'Point', coordinates: [1, 1] };
  assert.deepEqual(inflatePolygon(pt), pt);
  assert.equal(inflatePolygon(null), null);
});

ok('squareFootprint: ~16×20 m cerrado y centrado', () => {
  const fp = squareFootprint(-0.36, 39.4, 16, 20);
  const ring = fp.coordinates[0];
  assert.equal(ring.length, 5); // cerrado
  assert.deepEqual(ring[0], ring[4]);
  // ancho real ≈ 16 m (±1 m), alto ≈ 20 m
  const wM = (ring[1][0] - ring[0][0]) * 111320 * Math.cos((39.4 * Math.PI) / 180);
  const hM = (ring[2][1] - ring[1][1]) * 111320;
  assert.ok(Math.abs(wM - 16) < 1, `ancho ${wM}`);
  assert.ok(Math.abs(hM - 20) < 1, `alto ${hM}`);
});

// ── point-in-polygon (snap al edificio OSM que contiene la póliza) ──────
ok('pointInPolygon: dentro del cuadrado → true', () => {
  const sq = { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };
  assert.equal(pointInPolygon(1, 1, sq), true);
});
ok('pointInPolygon: fuera del cuadrado → false', () => {
  const sq = { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] };
  assert.equal(pointInPolygon(3, 1, sq), false);
  assert.equal(pointInPolygon(1, -0.5, sq), false);
});
ok('pointInPolygon: MultiPolygon, dentro del 2º polígono → true', () => {
  const mp = {
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
      [[[5, 5], [5, 7], [7, 7], [7, 5], [5, 5]]],
    ],
  };
  assert.equal(pointInPolygon(6, 6, mp), true);
  assert.equal(pointInPolygon(3, 3, mp), false);
});
ok('pointInPolygon: geometría inválida → false', () => {
  assert.equal(pointInPolygon(1, 1, null), false);
  assert.equal(pointInPolygon(1, 1, { type: 'Point', coordinates: [1, 1] }), false);
});

console.log(`\nfloodGeometry: ${passed} casos OK`);
