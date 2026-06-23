#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make_distance_to_river.py
-------------------------
Genera `distance_to_river.tif` (distancia euclidea a la red de drenaje
principal) por zona, FUENTE UNICA DE VERDAD del feature: el mismo raster se
muestrea en el parquet de entrenamiento (via row/col) y se lee en inferencia
(`predict_risk_map_v3t.py`) -> training == inference, sin desfase.

Metodo (identico al A/B `ab_distance_river.py`, pero sobre el grid COMPLETO):
  red    = flow_accumulation > p99.5 (sobre positivos finitos)
  red    = dilatacion 3 iter
  dist   = EDT(~red) * 10 m/px

Sanity: comprueba que flow_accumulation.tif[row,col] == columna flow del
parquet (alineacion grid<->parquet) antes de aceptar el resultado.

Uso: .venv/Scripts/python.exe scripts/features/make_distance_to_river.py
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from scipy.ndimage import binary_dilation, distance_transform_edt

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
PIXEL_M = 10.0
P_RIVER = 99.5
DILATE = 3

ZONES = {
    "valencia": {
        "flow": REPO / "data/dem/flow_accumulation.tif",
        "out": REPO / "data/dem/distance_to_river.tif",
        "parquet": REPO / "data/dataset/training_dataset_v2.parquet",
    },
    "algemesi": {
        "flow": REPO / "data/extrapolation/dem/flow_accumulation.tif",
        "out": REPO / "data/extrapolation/dem/distance_to_river.tif",
        "parquet": REPO / "data/dataset/training_dataset_algemesi.parquet",
    },
}


def _compute(flow: np.ndarray) -> np.ndarray:
    pos = flow[np.isfinite(flow) & (flow > 0)]
    thr = np.percentile(pos, P_RIVER) if pos.size else np.inf
    river = np.isfinite(flow) & (flow > thr)
    river = binary_dilation(river, iterations=DILATE)
    dist = distance_transform_edt(~river).astype("float32") * PIXEL_M
    return dist, float(thr)


def _check_alignment(zone: str, flow: np.ndarray, parquet: Path) -> None:
    """Asegura que parquet (row,col) indexa el grid de flow_accumulation."""
    df = pd.read_parquet(parquet, columns=["row", "col", "flow_accumulation"])
    df = df.sample(min(20_000, len(df)), random_state=0)
    r = df["row"].to_numpy("int64"); c = df["col"].to_numpy("int64")
    if r.max() >= flow.shape[0] or c.max() >= flow.shape[1]:
        raise SystemExit(f"[{zone}] row/col fuera del grid {flow.shape}: "
                         f"max=({r.max()},{c.max()})")
    sampled = flow[r, c]
    parq = df["flow_accumulation"].to_numpy("float32")
    both = np.isfinite(sampled) & np.isfinite(parq)
    if both.sum() == 0:
        raise SystemExit(f"[{zone}] sin solape finito flow raster<->parquet")
    rel = np.abs(sampled[both] - parq[both]) / (np.abs(parq[both]) + 1e-6)
    frac_ok = float((rel < 1e-3).mean())
    log.info("  [%s] alineacion flow raster<->parquet: %.2f%% coincide (n=%d)",
             zone, 100 * frac_ok, both.sum())
    if frac_ok < 0.98:
        raise SystemExit(f"[{zone}] DESALINEADO ({frac_ok:.3f}); abortado")


def main() -> int:
    t0 = time.time()
    for zone, z in ZONES.items():
        log.info("==== %s ====", zone)
        with rasterio.open(z["flow"]) as ds:
            flow = ds.read(1).astype("float32")
            nd = ds.nodata
            prof = ds.profile.copy()
        if nd is not None and not np.isnan(nd):
            flow[flow == nd] = np.nan
        log.info("  flow grid %s", flow.shape)
        _check_alignment(zone, flow, z["parquet"])

        dist, thr = _compute(flow)
        log.info("  thr p%.1f flow=%.1f | dist mediana=%.0fm max=%.0fm",
                 P_RIVER, thr, float(np.median(dist)), float(dist.max()))

        if z["out"].exists():
            bak = z["out"].with_suffix(f".tif.bak_{time.strftime('%Y%m%d_%H%M%S')}")
            z["out"].replace(bak)
            log.info("  backup previo -> %s", bak.name)

        pp = prof.copy()
        pp.update(dtype="float32", count=1, nodata=np.nan, compress="lzw", driver="GTiff")
        for k in ("blockxsize", "blockysize", "tiled", "interleave", "photometric"):
            pp.pop(k, None)
        with rasterio.open(z["out"], "w", **pp) as dst:
            dst.write(dist, 1)
        log.info("  -> %s", z["out"].relative_to(REPO))
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
