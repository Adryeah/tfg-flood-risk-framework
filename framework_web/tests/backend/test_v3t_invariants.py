"""Invariantes v3-T: blindan bugs reales que ya ocurrieron en esta plataforma.

Cada test corresponde a un incidente concreto durante la migracion a v3-T;
si alguno se reintroduce, aqui salta en rojo antes del despliegue.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import joblib
import pytest

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "framework_web"))

from backend.config import settings
from backend.services.feature_extractor import categorize_probability


def test_calibrator_threshold_matches_config():
    """Drift de umbral: el calibrador (fuente de verdad), config y la
    categorizacion deben coincidir en 0,16. Ya divergieron (0.310/0.614/0.140)."""
    cal = joblib.load(settings.CALIBRATOR_PATH)
    assert cal["threshold"] == pytest.approx(0.16, abs=1e-6)
    assert settings.THRESHOLD_OPERATIONAL == pytest.approx(0.16, abs=1e-6)
    assert len(cal["features"]) == 10
    assert "distance_to_river" in cal["features"]


def test_categorize_boundary_is_threshold():
    """La banda de la UI 'low'->'moderate' debe caer exactamente en el umbral."""
    assert categorize_probability(0.16) == "moderate"
    assert categorize_probability(0.159) == "low"
    assert categorize_probability(0.30) == "high"
    assert categorize_probability(0.50) == "very_high"


def test_portfolio_meta_threshold_coherent():
    """El _meta de las carteras arrastraba 0.614 / "umbral 0.140"; debe decir 0.16."""
    path = settings.DATA_PROCESSED_DIR / "predefined_portfolios.json"
    meta = json.loads(path.read_text(encoding="utf-8")).get("_meta", {})
    assert meta.get("threshold_operational") == pytest.approx(0.16, abs=1e-6)
    assert "0.160" in meta.get("model", "")


def test_display_floor_above_operational_threshold():
    """Bug del mapa 'toda la zona en riesgo': el SUELO DE VISUALIZACION del
    raster continuo (VISIBLE_MIN) debe quedar por ENCIMA del umbral operacional;
    si baja al umbral, la banda palida sub-umbral satura toda la cuenca."""
    src = (REPO / "tools" / "export_risk_tiles.py").read_text(encoding="utf-8")
    m = re.search(r"^VISIBLE_MIN\s*=\s*([0-9.]+)", src, re.MULTILINE)
    assert m, "no se encontro VISIBLE_MIN en export_risk_tiles.py"
    visible_min = float(m.group(1))
    assert visible_min > settings.THRESHOLD_OPERATIONAL, (
        f"VISIBLE_MIN={visible_min} <= umbral {settings.THRESHOLD_OPERATIONAL}: "
        "el mapa continuo pintaria la banda sub-umbral y saturaria la cuenca"
    )
