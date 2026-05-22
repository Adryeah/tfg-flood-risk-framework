"""
06_compress_geojsons.py
------------------------
Trims coordinate precision to 5 decimals (~1.1 m, well below el píxel
SAR de 10 m → invisible en pantalla) y pre-comprime cada GeoJSON con
gzip nivel 9. El backend sirve el .gz directamente con
`Content-Encoding: gzip`, ahorrando ~75% del payload por request.

Resultado esperado para Algemesí: 15 MB → ~3 MB → ~3 s sobre Render
free tier en vez de los 14-15 s actuales.

Operación in-place sobre framework_web/backend/data_processed/. Genera
un .gz por cada .geojson; el .geojson original se reescribe con
separadores compactos y precisión recortada.
"""
from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "backend" / "data_processed"
COORD_DECIMALS = 5


def _round_coords(obj: Any) -> Any:
    """Recorre recursivamente la estructura GeoJSON y redondea cualquier
    float a COORD_DECIMALS. No depende del tipo de geometría (Point,
    LineString, Polygon, MultiPolygon, GeometryCollection…)."""
    if isinstance(obj, float):
        return round(obj, COORD_DECIMALS)
    if isinstance(obj, list):
        return [_round_coords(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _round_coords(v) for k, v in obj.items()}
    return obj


def compress_one(path: Path) -> None:
    raw_size = path.stat().st_size
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    data = _round_coords(data)

    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    path.write_text(payload, encoding="utf-8")

    gz_path = path.with_suffix(path.suffix + ".gz")
    with gzip.open(gz_path, "wb", compresslevel=9) as gz:
        gz.write(payload.encode("utf-8"))

    trimmed_size = path.stat().st_size
    gz_size = gz_path.stat().st_size
    log.info(
        "%s: raw %.1f KB → trimmed %.1f KB → gzip %.1f KB (%.0f%% wire reduction)",
        path.name,
        raw_size / 1024,
        trimmed_size / 1024,
        gz_size / 1024,
        100 * (1 - gz_size / raw_size),
    )


def main() -> None:
    if not DATA_DIR.is_dir():
        raise SystemExit(f"data_processed dir no encontrado: {DATA_DIR}")

    geojsons = sorted(DATA_DIR.glob("*.geojson"))
    if not geojsons:
        raise SystemExit(f"sin .geojson en {DATA_DIR}")

    log.info("Comprimiendo %d archivos en %s", len(geojsons), DATA_DIR)
    for p in geojsons:
        compress_one(p)
    log.info("OK")


if __name__ == "__main__":
    main()
