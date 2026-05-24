"""
07_export_risk_tiles.py
-----------------------
Pre-genera tiles XYZ (PNG 256x256, EPSG:3857) a partir de los GeoTIFF
de probabilidad del Random Forest, con colormap continuo y transparencia
en el shoulder bajo (p < 0.25). Los tiles se sirven luego como
`FileResponse` estático desde el backend → cero pico de RAM en Render
free tier.

Razón de pre-renderizar (vs TiTiler on-demand):
  - Render free tiene 512 MB; TiTiler genera tiles por petición y cada
    una sube el high-water mark, con riesgo de OOM bajo carga (mismo
    enemigo que pelámos con el geojson de 14 MB).
  - Tiles estáticos en disco → el worker sólo abre file handles.
  - Coste: ~30-50 MB en el repo, regenerar cuando se re-entrene el modelo.

Diferencia con el geojson actual (tools/01_*):
  - Fidelidad píxel-perfect (10 m, sin Douglas-Peucker, sin filtro de área)
  - Colormap CONTINUO (256 tonos del gradiente YlOrRd) vs 8 bins discretos
  - Cubre el 100% de los píxeles válidos del RF; el geojson sigue existiendo
    para el modo 3D (que necesita features vectoriales con probability_max
    como atributo numérico para la altura extrudida).

Output: framework_web/backend/data_processed/tiles/{zone}/{z}/{x}/{y}.png
"""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

import mercantile
import numpy as np
from matplotlib import cm
from PIL import Image
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-7s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "framework_web" / "backend" / "data_processed" / "tiles"

# Zoom range:
#   z=10  ~150 m/px display, vista regional (Valencia entera ~1 tile)
#   z=15  ~4.8 m/px display, super-resuelto 2x sobre el SAR nativo de 10 m
# Más alto (z=16+) sólo estira píxeles, no añade información.
MIN_ZOOM = 10
MAX_ZOOM = 15

# Pintar sólo p >= 0.25 (igual que el geojson principal); por debajo
# transparente para que el basemap se vea. El shoulder bajo sigue en
# *_risk_tail.geojson para los que quieran auditarlo.
PROB_MIN_VISIBLE = 0.25

# Colormap: amarillo → naranja → rojo (matplotlib YlOrRd). 256 entradas,
# coincide visualmente con los bins del geojson actual pero CONTINUO.
CMAP = cm.get_cmap("YlOrRd", 256)

# Opacidad del raster (la capa Mapbox/MapLibre añade su propia opacity
# encima; este alpha controla la transparencia base por píxel).
ALPHA_VISIBLE = 230  # ~0.9 sobre 255

ZONES = {
    "valencia":
        REPO / "results" / "maps" / "04_risk_prediction" / "risk_probability_v2.tif",
    "algemesi":
        REPO / "results" / "maps" / "05_extrapolation" / "risk_probability_algemesi.tif",
}


def _render_tile(reader: Reader, x: int, y: int, z: int) -> bytes | None:
    """Devuelve el PNG del tile (z, x, y) o None si está fuera del bbox
    del raster (no se escribe a disco). Aplica colormap continuo y
    transparencia en p < PROB_MIN_VISIBLE."""
    try:
        img = reader.tile(x, y, z, tilesize=256, resampling_method="bilinear")
    except TileOutsideBounds:
        return None

    # img.data shape (1, 256, 256) float32; img.mask shape (256, 256) uint8
    # rio-tiler 9.x → img.mask 255=valid, 0=invalid
    data = img.data[0].astype(np.float32)
    mask = img.mask
    if mask.ndim == 3:
        mask = mask[0]

    # Clip al rango [0, 1] (algunas reproyecciones bilinear pueden generar
    # valores ligeramente fuera por interpolación)
    data = np.clip(data, 0.0, 1.0)

    # Colormap → RGBA uint8
    rgba = (CMAP(data) * 255).astype(np.uint8)

    # Alpha: transparente donde no hay dato O donde p < umbral visible
    visible = (mask > 0) & (data >= PROB_MIN_VISIBLE)
    if not visible.any():
        # Tile completamente vacío — no merece la pena escribirlo
        return None
    rgba[..., 3] = np.where(visible, ALPHA_VISIBLE, 0).astype(np.uint8)

    # PNG comprimido
    pil_img = Image.fromarray(rgba, mode="RGBA")
    import io
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bbox_lonlat(reader: Reader) -> tuple[float, float, float, float]:
    """Bounds del raster reproyectados a EPSG:4326 (lon/lat)."""
    from rasterio.crs import CRS as RioCRS
    bounds = reader.get_geographic_bounds(RioCRS.from_epsg(4326))
    return bounds  # (west, south, east, north)


def export_zone(zone_name: str, tif_path: Path, out_dir: Path) -> dict:
    log.info("=" * 60)
    log.info("zona=%s  tif=%s", zone_name, tif_path.relative_to(REPO))
    log.info("=" * 60)
    if not tif_path.exists():
        log.error("TIF no encontrado: %s", tif_path)
        return {"zone": zone_name, "tiles": 0, "skipped": 0, "bytes": 0}

    zone_dir = out_dir / zone_name
    if zone_dir.exists():
        log.info("Borrando dir anterior: %s", zone_dir)
        shutil.rmtree(zone_dir)
    zone_dir.mkdir(parents=True)

    t0 = time.time()
    n_written = 0
    n_skipped = 0
    n_bytes = 0

    with Reader(str(tif_path)) as reader:
        west, south, east, north = _bbox_lonlat(reader)
        log.info("bbox 4326: w=%.4f s=%.4f e=%.4f n=%.4f",
                 west, south, east, north)

        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            zoom_tiles = list(mercantile.tiles(west, south, east, north, [z]))
            log.info("  z=%2d → %d tiles candidatos", z, len(zoom_tiles))
            zoom_written = 0
            for tile in zoom_tiles:
                png = _render_tile(reader, tile.x, tile.y, tile.z)
                if png is None:
                    n_skipped += 1
                    continue
                out_path = zone_dir / str(tile.z) / str(tile.x) / f"{tile.y}.png"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(png)
                n_written += 1
                zoom_written += 1
                n_bytes += len(png)
            log.info("        escritos %d (skip %d vacíos)",
                     zoom_written, len(zoom_tiles) - zoom_written)

    elapsed = time.time() - t0
    log.info("zona=%s  total escritos=%d  skip=%d  size=%.1f MB  (%.1fs)",
             zone_name, n_written, n_skipped, n_bytes / 1e6, elapsed)
    return {"zone": zone_name, "tiles": n_written,
            "skipped": n_skipped, "bytes": n_bytes}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    for zone, tif in ZONES.items():
        results.append(export_zone(zone, tif, OUT_DIR))

    log.info("=" * 60)
    log.info("RESUMEN")
    for r in results:
        log.info("  %s: %d tiles, %.1f MB",
                 r["zone"], r["tiles"], r["bytes"] / 1e6)
    log.info("Tiles servidos como: GET /api/tiles/{zone}/{z}/{x}/{y}.png")
    log.info("Output: %s", OUT_DIR.relative_to(REPO))
    log.info("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
