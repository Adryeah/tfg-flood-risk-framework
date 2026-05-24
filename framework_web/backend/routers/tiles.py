"""Endpoint /api/tiles/{zone}/{z}/{x}/{y}.png — sirve los XYZ raster
tiles pre-renderizados por tools/07_export_risk_tiles.py.

Pre-renderizados (no on-demand TiTiler) precisamente para no romper el
presupuesto de RAM de Render free tier (512 MB). El worker sólo abre
file handles; cero pico de memoria por petición. Cache-Control de 24 h
+ tile coords inmutables → Cloudflare / browser cachean perfectamente.

Cubre el RF a fidelidad píxel (10 m, colormap continuo YlOrRd), en
contraste con `/api/risk/{zone}.geojson` que vectoriza por 8 bins y
sirve para el modo 3D extrudido.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tiles", tags=["tiles"])


_TILE_HEADERS = {
    # Mismo perfil de caché que los geojson — los tiles cambian sólo
    # cuando se re-entrena el modelo + se regenera el set.
    "Cache-Control": "public, max-age=86400, immutable",
}

_TILES_ROOT = settings.DATA_PROCESSED_DIR / "tiles"


@router.get("/{zone}/{z}/{x}/{y}.png",
             summary="Tile PNG 256x256 EPSG:3857 (XYZ scheme)")
def get_risk_tile(
    zone: Literal["valencia", "algemesi"],
    z: int,
    x: int,
    y: int,
):
    """Devuelve el tile PNG raster de probabilidad para (z, x, y).
    Si el tile no existe (zoom fuera de rango o tile completamente
    vacío que no se llegó a escribir) devuelve 404 — MapLibre lo
    interpreta correctamente y simplemente no pinta ese cuadrante."""
    # Guard: rangos sensatos de zoom (los generados son 10..15; cualquier
    # otro zoom simplemente no existe en disco y devolvería 404 de todas
    # formas, pero rechazar explícitamente evita disk-stat innecesario).
    if not (0 <= z <= 22 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(400, "coordenadas XYZ fuera de rango")

    path = _TILES_ROOT / zone / str(z) / str(x) / f"{y}.png"
    if not path.is_file():
        # 404 es correcto aquí — MapLibre lo trata como "tile vacío"
        raise HTTPException(404, f"tile no disponible: {zone}/{z}/{x}/{y}")

    return FileResponse(
        path,
        media_type="image/png",
        headers=_TILE_HEADERS,
    )
