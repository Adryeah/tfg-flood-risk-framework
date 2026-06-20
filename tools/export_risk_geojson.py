#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
export_risk_geojson.py
----------------------
Re-genera los GeoJSON de riesgo (vectorizacion por bins de probabilidad,
para la extrusion 3D del frontend) desde los rasters del modelo v3-T.

Recrea el exportador ausente (`tools/01_export_risk_to_geojson.py`) con el
MISMO esquema de bins, colores, labels y CRS (CRS84) que el set v2, para no
romper el contrato del frontend. Solo cambia el modelo que genera la P.

  - {zone}_risk.geojson       : 8 bins "riesgo"  P in [0.25, 1.0]  (YlOrRd)
  - {zone}_risk_tail.geojson  : 4 bins "fondo"   P in [0.00, 0.25] (grises)
  + .gz de cada uno (el servicio prefiere servir el .gz).

Salida: framework_web/backend/data_processed/{zone}_risk{,_tail}.geojson(.gz)

Uso:
  .venv/Scripts/python.exe tools/export_risk_geojson.py [--zone valencia|algemesi|all]
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import shapes
from rasterio.warp import transform_geom

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "framework_web/backend/data_processed"

# (bin_id, risk_level, label, probability_bin, min, max, color) — IDENTICO a v2.
TAIL = [
    (0, "tail_1", "background",   "0.00-0.06", 0.00, 0.06, "#E5E7EB"),
    (1, "tail_2", "very_low",     "0.06-0.13", 0.06, 0.13, "#D1D5DB"),
    (2, "tail_3", "low_minus",    "0.13-0.19", 0.13, 0.19, "#B3BAC4"),
    (3, "tail_4", "low_shoulder", "0.19-0.25", 0.19, 0.25, "#9CA3AF"),
]
MAIN = [
    (0, "bin_1", "low",         "0.25-0.34", 0.25, 0.34, "#FEF3C7"),
    (1, "bin_2", "low_medium",  "0.34-0.43", 0.34, 0.43, "#FDE68A"),
    (2, "bin_3", "medium_low",  "0.43-0.52", 0.43, 0.52, "#FCD34D"),
    (3, "bin_4", "medium",      "0.52-0.61", 0.52, 0.61, "#FBBF24"),
    (4, "bin_5", "medium_high", "0.61-0.70", 0.61, 0.70, "#F87171"),
    (5, "bin_6", "high",        "0.70-0.79", 0.70, 0.79, "#EF4444"),
    (6, "bin_7", "very_high",   "0.79-0.88", 0.79, 0.88, "#DC2626"),
    (7, "bin_8", "extreme",     "0.88-1.01", 0.88, 1.00, "#991B1B"),
]

ZONES = {
    "valencia": REPO / "results/maps/04_risk_prediction/risk_probability_v3t.tif",
    "algemesi": REPO / "results/maps/05_extrapolation/risk_probability_algemesi_v3t.tif",
}

CRS84 = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}

# Factor de agregacion antes de vectorizar (10 m -> 80 m). Calibrado para
# ~igualar el recuento de poligonos del set v2 (Valencia ~9,6k, Algemesi ~13k)
# y mantener el payload dentro del free-tier de Render.
DOWNSAMPLE = 8


def _props(spec):
    bid, level, label, pbin, pmin, pmax, color = spec
    return {"bin_id": bid, "risk_level": level, "label": label,
            "probability_bin": pbin, "probability_min": pmin,
            "probability_max": pmax, "color": color}


def _round_geom(geom, nd=5):
    def r(c):
        if isinstance(c, (list, tuple)):
            if c and isinstance(c[0], (int, float)):
                return [round(float(c[0]), nd), round(float(c[1]), nd)]
            return [r(x) for x in c]
        return c
    geom["coordinates"] = r(geom["coordinates"])
    return geom


def _classify(proba: np.ndarray) -> np.ndarray:
    """uint8 code por pixel: 0=nodata, 1-4=tail, 5-12=main."""
    code = np.zeros(proba.shape, dtype="uint8")
    p = proba
    for i, (_, _, _, _, lo, hi, _) in enumerate(TAIL):
        code[(p >= lo) & (p < hi)] = 1 + i
    for i, (_, _, _, _, lo, hi, _) in enumerate(MAIN):
        hit = (p >= lo) & (p < hi) if hi < 1.0 else (p >= lo) & (p <= 1.0)
        code[hit] = 5 + i
    return code


def _write(path: Path, fc: dict) -> None:
    txt = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    path.write_text(txt, encoding="utf-8")
    with gzip.open(path.with_suffix(path.suffix + ".gz"), "wt", encoding="utf-8") as fh:
        fh.write(txt)


def _export_zone(zone: str, src: Path) -> None:
    if not src.exists():
        log.error("Falta raster %s — zona %s saltada", src, zone)
        return
    log.info("==== %s ====  src=%s (downsample x%d)", zone, src.relative_to(REPO), DOWNSAMPLE)
    t0 = time.time()
    # Downsample (block-average) ANTES de vectorizar: a 10 m la vectorizacion
    # genera ~25x mas poligonos de los necesarios y rompe el payload del
    # free-tier. El v2 agregaba a resolucion gruesa; replicamos eso.
    with rasterio.open(src) as ds:
        h2, w2 = ds.height // DOWNSAMPLE, ds.width // DOWNSAMPLE
        proba = ds.read(1, out_shape=(h2, w2),
                        resampling=Resampling.average).astype("float32")
        transform = ds.transform * ds.transform.scale(ds.width / w2, ds.height / h2)
        src_crs = ds.crs
    proba = np.where(np.isfinite(proba), proba, -1.0)
    code = _classify(proba)

    main_feats, tail_feats = [], []
    for geom, val in shapes(code, mask=code > 0, transform=transform, connectivity=4):
        val = int(val)
        g = _round_geom(transform_geom(src_crs, "EPSG:4326", geom))
        if val <= 4:
            tail_feats.append({"type": "Feature", "geometry": g,
                               "properties": _props(TAIL[val - 1])})
        else:
            main_feats.append({"type": "Feature", "geometry": g,
                               "properties": _props(MAIN[val - 5])})

    _write(OUT_DIR / f"{zone}_risk.geojson",
           {"type": "FeatureCollection", "crs": CRS84, "features": main_feats})
    _write(OUT_DIR / f"{zone}_risk_tail.geojson",
           {"type": "FeatureCollection", "crs": CRS84, "features": tail_feats})
    log.info("  %s: main=%d tail=%d polígonos en %.1f min",
             zone, len(main_feats), len(tail_feats), (time.time() - t0) / 60)


def main() -> int:
    global DOWNSAMPLE
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", choices=["valencia", "algemesi", "all"], default="all")
    ap.add_argument("--downsample", type=int, default=DOWNSAMPLE)
    args = ap.parse_args()
    DOWNSAMPLE = args.downsample
    targets = ZONES if args.zone == "all" else {args.zone: ZONES[args.zone]}
    for zone, src in targets.items():
        _export_zone(zone, src)
    log.info("=== GEOJSON v3-T COMPLETADO ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
