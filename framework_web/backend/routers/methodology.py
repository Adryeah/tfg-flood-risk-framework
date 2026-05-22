"""Endpoints /api/methodology/*"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/methodology", tags=["methodology"])


@router.get("/leakage_audit", summary="Caso completo de auditoria de leakage XGBoost v3")
def get_leakage_audit() -> Dict[str, Any]:
    """Devuelve el caso de leakage temporal documentado completo:
    diagnostico, bug exacto, tabla de diferencias, conclusion y rutas
    a las figuras de los Tests 1 y 2."""
    path = settings.DATA_PROCESSED_DIR / "precomputed_metrics.json"
    if not path.exists():
        raise HTTPException(503, "precomputed_metrics.json no disponible")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    leakage = data.get("leakage_audit", {})

    return {
        "title": "Auditoria de leakage temporal en XGBoost v3",
        "summary": (
            "Tras la consolidacion de Random Forest v2 (AUC 0.922) se "
            "exploro una iteracion v3 con 24 features. XGBoost v3 alcanzo "
            "AUC 0.966, aparentemente superior. Una auditoria formal "
            "detecto leakage temporal en 4 features estacionales y "
            "se descarto el modelo."
        ),
        "narrative": [
            {
                "heading": "Hipotesis de partida",
                "text": (
                    "El salto de +0.044 puntos de AUC entre RF v2 y XGBoost v3 "
                    "era cuantitativamente sospechoso para un problema "
                    "espacial correctamente validado."
                ),
            },
            {
                "heading": "Diseno de la auditoria",
                "text": (
                    "Cuatro tests secuenciales con regla de parada: "
                    "Test 1 urban_mask leakage, Test 2 leakage temporal, "
                    "Test 3 validacion CV, Test 4 transferibilidad."
                ),
            },
            {
                "heading": "Test 1 PASA (urban_mask no es leakage)",
                "text": (
                    "AUC con urban_mask = 0.9703, sin = 0.9707, "
                    "delta -0.0004 (despreciable). urban_mask aporta cero."
                ),
            },
            {
                "heading": "Test 2 FALLA (leakage temporal directo)",
                "text": (
                    "El filtro 'event' not in p.parts solo excluye "
                    "subdirectorio /event/ y no fechas evento "
                    "directamente en processed/. Las escenas del "
                    "19 y 31 octubre 2024 entraron al stack winter, "
                    "contaminando winter_min_sigma0_vv hasta 16.34 dB "
                    "en pixeles inundados."
                ),
            },
            {
                "heading": "Decision",
                "text": (
                    "Se descarta XGBoost v3. Random Forest v2 (14 features, "
                    "AUC 0.922 Valencia, 0.817 Algemesi) se mantiene como "
                    "modelo final del TFG. Sin leakage por construccion."
                ),
            },
            {
                "heading": "Leccion metodologica",
                "text": (
                    "Filtrar series temporales por fecha (no por path) y "
                    "verificar siempre ausencia de leakage cuando una nueva "
                    "feature dispara las metricas mas alla de lo razonable."
                ),
            },
        ],
        "tables": {
            "winter_features_diff": [
                {"feature": "winter_mean_sigma0_vv",
                 "median_diff_flooded": 0.060,
                 "median_diff_notflooded": 0.058,
                 "max_abs_diff": 3.58, "unit": "dB"},
                {"feature": "winter_min_sigma0_vv",
                 "median_diff_flooded": 0.000,
                 "median_diff_notflooded": 0.000,
                 "max_abs_diff": 16.34, "unit": "dB"},
                {"feature": "winter_std_sigma0_vv",
                 "median_diff_flooded": 0.053,
                 "median_diff_notflooded": -0.023,
                 "max_abs_diff": 7.14, "unit": "dB"},
                {"feature": "winter_minus_summer_vv",
                 "median_diff_flooded": 0.060,
                 "median_diff_notflooded": 0.058,
                 "max_abs_diff": 3.58, "unit": "dB"},
            ],
        },
        "test1": leakage.get("test1_urban_mask", {}),
        "test2": leakage.get("test2_temporal_leakage", {}),
        "tests_executed": leakage.get("tests_executed", []),
        "tests_skipped": leakage.get("tests_skipped", []),
        "final_verdict": leakage.get("final_verdict", ""),
        "figures": [
            {
                "id": "test1_urban_mask_check",
                "title": "Test 1 — XGBoost v3 con vs sin urban_mask",
                "path": "results/diagnostics/leakage_tests/test1_urban_mask_check.png",
            },
            {
                "id": "test2_temporal_leakage",
                "title": "Test 2 — diferencias winter features con/sin leakage",
                "path": "results/diagnostics/leakage_tests/test2_temporal_leakage.png",
            },
        ],
        "code_references": {
            "bug_location": "scripts/features/extract_advanced_features_v3.py:162",
            "bug_pattern": "if \"event\" not in p.parts",
            "fix_pattern": "EVENT_DATES = {\"20241019\", \"20241031\"}; if _date_from_name(p) not in EVENT_DATES",
            "audit_scripts": [
                "scripts/models/test1_urban_mask_leakage.py",
                "scripts/models/test2_temporal_leakage.py",
            ],
            "documentation": "scripts/models/README_leakage_finding.md",
        },
    }
