#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
rescore_predefined_portfolios_v3t.py
------------------------------------
Re-puntúa las carteras predefinidas con el modelo v3-T calibrado, SIN
regenerar clientes (mismas ubicaciones, valores, tipos). Solo actualiza
el riesgo y reescala la pérdida proporcionalmente.

Por qué reescalar y no recalcular: las carteras predefinidas se generaron
con un tool ausente que usaba convenciones de subtype distintas a las del
generador actual ('casa' vs 'house'), así que recalcular el damage_ratio
sería frágil. En su lugar:
    risk_new   = model.predict(features@lat,lon)   (v3-T calibrado)
    loss_new   = loss_old * (risk_new / risk_old)  (preserva damage_ratio)
    eal_new    = eal_old  * (risk_new / risk_old)  (preserva PROB_EVENT_YEAR)
El modelo de daño no cambia; solo la probabilidad de riesgo pasa a v3-T.

Backup del v2 antes de sobrescribir. Uso:
  .venv/Scripts/python.exe tools/rescore_predefined_portfolios_v3t.py
"""
from __future__ import annotations

import json
import logging
import shutil
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "framework_web"))

from backend.config import settings  # noqa: E402
from backend.services.feature_extractor import (  # noqa: E402
    categorize_probability, get_feature_extractor)
from backend.services.model_service import get_model_service  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)


def main() -> int:
    t0 = time.time()
    model = get_model_service()
    model.load_model(settings.MODEL_PATH, settings.CALIBRATOR_PATH)
    ext = get_feature_extractor()
    ext.load_lookups(settings.DATA_PROCESSED_DIR)
    feats = model.get_feature_names()
    log.info("v3-T cargado: %d feats, umbral %.3f", len(feats), model.get_threshold())

    path = settings.DATA_PROCESSED_DIR / "predefined_portfolios.json"
    shutil.copy(path, path.with_suffix(".json.v2backup"))
    log.info("Backup: %s", path.name + ".v2backup")
    d = json.loads(path.read_text(encoding="utf-8"))

    rescored = skipped = outside = 0
    for p in d["portfolios"]:
        for c in p["clients"]:
            f = ext.get_features_at(c["lat"], c["lon"], max_distance_m=300.0)
            if f is None:
                outside += 1
                continue
            try:
                x = np.array([f["features"][k] for k in feats], dtype="float32")
            except KeyError:
                skipped += 1
                continue
            rp_new = float(model.predict(x))
            rp_old = float(c.get("risk_probability") or 0.0)
            ratio = rp_new / rp_old if rp_old > 1e-4 else None
            c["risk_probability"] = round(rp_new, 6)
            c["risk_category"] = categorize_probability(rp_new)
            if ratio is not None:
                c["estimated_loss_dana"] = round(float(c.get("estimated_loss_dana", 0)) * ratio)
                c["expected_annual_loss"] = round(float(c.get("expected_annual_loss", 0)) * ratio, 2)
            else:
                # riesgo viejo ~0: reescala desde insured con damage ratio 0.3
                loss = round(float(c.get("insured_value", 0)) * rp_new * 0.3)
                c["estimated_loss_dana"] = loss
                c["expected_annual_loss"] = round(loss * 0.012, 2)
            rescored += 1
        log.info("  %s: %d clientes re-puntuados", p["id"], len(p["clients"]))

    meta = d.setdefault("_meta", {})
    meta["model"] = "Random Forest v3-T (calibrado, umbral 0.310)"
    meta["rescored_at"] = time.strftime("%Y-%m-%d")
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Re-puntuados=%d  skipped=%d  fuera-bbox=%d", rescored, skipped, outside)
    log.info("Guardado: %s  (%.1fs)", path.name, time.time() - t0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
