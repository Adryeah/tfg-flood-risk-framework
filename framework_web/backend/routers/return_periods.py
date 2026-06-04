"""Endpoints de Return Periods.

Stub que documenta la integración con la cartografía oficial SNCZI
(Sistema Nacional de Cartografía de Zonas Inundables, MITECO).

Estado actual:
    - Modo 'rf_v2' (default): la frontend escala las pérdidas
      client-side via Dottori 2018 sobre la salida del Random Forest.
      Este router no se invoca; el frontend resuelve todo localmente.
    - Modo 'snczi': pendiente de integración. Los siguientes
      endpoints documentan la API que el frontend espera cuando el
      operador haya descargado los rasters SNCZI y los haya servido
      como tiles propios desde Render.

Integración SNCZI · pasos pendientes (para chapter 7 memoria):

  1. Descargar manualmente los rasters T10, T100, T500 desde:
        https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/cartografia-zi-lamina.html
     (requiere aceptar términos en el navegador, no automatizable).
     Bajar para cuencas: Júcar (cubre Valencia + Algemesí + Alzira).

  2. Recortar al bbox de cada zona con:
        gdalwarp -te lon_min lat_min lon_max lat_max \\
                 -t_srs EPSG:4326 \\
                 input.tif output_clipped.tif

  3. Generar tile pyramids (z=10-15) con:
        gdal2tiles.py -z 10-15 -w none output_clipped.tif tiles/

  4. Servir tiles desde Render como capa raster:
        /api/return-periods/snczi/{zone}/{rp}/{z}/{x}/{y}.png

  5. Alternativa WMS · evitar el download manual usando el WMS
     INSPIRE oficial:
        https://servicios.idee.es/wms-inspire/inundabilidad
     ─ pros: cero data engineering, cero coste de almacenamiento.
     ─ cons: dependencia de uptime MITECO + posible problema CORS
       que requiere proxy desde nuestro backend.

Cuando el operador active SNCZI desde la UI (toggle 'Fuente
backbone' en el Console y en /exposure), el frontend pegará al
endpoint /api/return-periods/snczi/{zone}/{rp}/manifest para saber
si los tiles están disponibles. Si responde 404 o 503, la UI
mostrará un banner explicando que SNCZI no está configurado en
este deployment y mantendrá el modo 'rf_v2'.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/return-periods", tags=["return-periods"])

ZoneName = Literal["valencia", "algemesi"]
RPValue = Literal[10, 50, 100, 250, 500]

SNCZI_AVAILABLE = False
SNCZI_WMS_URL = (
    "https://servicios.idee.es/wms-inspire/inundabilidad?"
    "service=WMS&version=1.3.0&request=GetCapabilities"
)


@router.get("/sources")
def list_sources() -> dict:
    """Lista las fuentes backbone disponibles para mapas de RP.

    Devuelve el flag de disponibilidad para que la UI sepa si puede
    ofrecer el toggle SNCZI o solo RF v2 (default).
    """
    return {
        "default": "rf_v2",
        "available": [
            {
                "id": "rf_v2",
                "label": "RF v2 propio",
                "ready": True,
                "method": "Random Forest v2 + escalado AEP (Dottori 2018)",
            },
            {
                "id": "snczi",
                "label": "SNCZI · MITECO",
                "ready": SNCZI_AVAILABLE,
                "method": (
                    "Sistema Nacional de Cartografía de Zonas "
                    "Inundables, T10/T100/T500 oficial"
                ),
                "wms_url": SNCZI_WMS_URL,
                "note": (
                    "Pendiente de configuración en este deployment. "
                    "Ver docs en routers/return_periods.py."
                ),
            },
        ],
    }


@router.get("/snczi/{zone}/{rp}/manifest")
def snczi_manifest(zone: ZoneName, rp: int) -> dict:
    """Manifest del raster SNCZI para una zona + RP.

    Returns 503 mientras la integración SNCZI esté pendiente, con
    detalles del estado para que la UI pueda mostrar el banner de
    'SNCZI no configurado' sin romper el flujo.

    Cuando esté configurado, devolverá:
        {
          "zone": "valencia",
          "rp": 100,
          "tile_url": "/api/return-periods/snczi/valencia/100/{z}/{x}/{y}.png",
          "bbox": [lon_min, lat_min, lon_max, lat_max],
          "source": "MITECO SNCZI 2024",
          "license": "CC-BY 4.0 + términos MITECO"
        }
    """
    if rp not in (10, 50, 100, 250, 500):
        raise HTTPException(
            status_code=400,
            detail=f"RP {rp} no soportado. Valores válidos: 10, 50, 100, 250, 500",
        )
    if not SNCZI_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "snczi_not_configured",
                "zone": zone,
                "rp": rp,
                "message": (
                    "Integración SNCZI pendiente en este deployment. "
                    "Frontend debe usar modo 'rf_v2' (default)."
                ),
                "wms_alternative": SNCZI_WMS_URL,
                "docs": (
                    "Ver instrucciones de configuración en "
                    "framework_web/backend/routers/return_periods.py"
                ),
            },
        )
    return {
        "zone": zone,
        "rp": rp,
        "tile_url": f"/api/return-periods/snczi/{zone}/{rp}/{{z}}/{{x}}/{{y}}.png",
        "source": "MITECO SNCZI 2024",
        "license": "CC-BY 4.0 + términos MITECO",
    }
