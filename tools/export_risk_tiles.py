#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
export_risk_tiles.py
--------------------
Re-genera los tiles XYZ raster (PNG 256x256, EPSG:3857) del mapa de
probabilidad de riesgo, a partir de los rasters del modelo v3-T.

Recrea el exportador ausente (`tools/07_export_risk_tiles.py`) usando
rio-tiler (lo que usaba el original). Formato identico al desplegado:
256x256 RGBA, colormap continuo YlOrRd sobre P[0,1], alpha=230 en pixel
valido y 0 en nodata. Solo escribe tiles no vacios (igual que el set
original). Zoom z=10..15.

Salida: framework_web/backend/data_processed/tiles/{zone}/{z}/{x}/{y}.png

Uso:
  .venv/Scripts/python.exe tools/export_risk_tiles.py [--zone valencia|algemesi|all]
"""
from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

import morecantile
import numpy as np
from matplotlib import colormaps
from PIL import Image
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[1]
TILES_ROOT = REPO / "framework_web/backend/data_processed/tiles"
TMS = morecantile.tms.get("WebMercatorQuad")
ZOOMS = range(10, 16)            # z=10..15, igual que el set original
ALPHA = 230                     # opacidad de pixel valido (match formato actual)

ZONES = {
    "valencia": REPO / "results/maps/04_risk_prediction/risk_probability_v3t.tif",
    "algemesi": REPO / "results/maps/05_extrapolation/risk_probability_algemesi_v3t.tif",
}

# LUT YlOrRd 256 -> RGB uint8 (mismo colormap que el original)
_YLORD = (np.array([colormaps["YlOrRd"](i / 255)[:3] for i in range(256)]) * 255).astype("uint8")


VISIBLE_MIN = 0.25  # "< 0.25 transparente": p bajo (mar, suelo seco) NO se pinta


def _render_tile(data: np.ndarray) -> np.ndarray | None:
    """data (256,256) float. Solo se pinta p >= VISIBLE_MIN (convención de
    la leyenda "< 0.25 transparente"): así el mar y el suelo de baja
    probabilidad quedan transparentes y se ve el basemap oscuro debajo,
    igual que en producción. Devuelve RGBA uint8 o None si el tile no
    tiene ningun pixel visible."""
    visible = np.isfinite(data) & (data >= VISIBLE_MIN) & (data <= 1.0)
    if not visible.any():
        return None
    v = np.clip(np.where(visible, data, 0.0), 0.0, 1.0)
    idx = (v * 255).astype("uint8")
    rgb = _YLORD[idx]                                  # (256,256,3)
    alpha = np.where(visible, ALPHA, 0).astype("uint8")
    return np.dstack([rgb, alpha])


def _export_zone(zone: str, src: Path) -> None:
    if not src.exists():
        log.error("Falta raster %s — zona %s saltada", src, zone)
        return
    out_root = TILES_ROOT / zone
    log.info("==== %s ====  src=%s", zone, src.relative_to(REPO))
    t0 = time.time()
    written = 0
    with Reader(src, tms=TMS) as r:
        w, s, e, n = r.get_geographic_bounds(TMS.rasterio_geographic_crs)
        for z in ZOOMS:
            tiles = list(TMS.tiles(w, s, e, n, z))
            for t in tiles:
                try:
                    img = r.tile(t.x, t.y, t.z, tilesize=256)
                except TileOutsideBounds:
                    continue
                data = img.data[0].astype("float32")
                rgba = _render_tile(data)
                if rgba is None:
                    continue
                p = out_root / str(t.z) / str(t.x) / f"{t.y}.png"
                p.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(p, optimize=True)
                written += 1
            log.info("  z=%d  tiles_escritos_acum=%d", z, written)
    log.info("  %s: %d tiles en %.1f min", zone, written, (time.time() - t0) / 60)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", choices=["valencia", "algemesi", "all"], default="all")
    args = ap.parse_args()
    targets = ZONES if args.zone == "all" else {args.zone: ZONES[args.zone]}
    for zone, src in targets.items():
        _export_zone(zone, src)
    log.info("=== TILES v3-T COMPLETADOS ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
