#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
swap_metrics_v3t.py
-------------------
Promueve precomputed_metrics_v3t.json a precomputed_metrics.json (el que sirve
el backend) y le inyecta las secciones nuevas:
  - zone_level       <- results/model/zone_level_metrics.json
  - operating_points <- results/model/operating_points.json
  - aoa              <- results/model/aoa_v3t.json (resumen)

Preserva leakage_audit (ya viene en el _v3t). Backup timestampeado del
precomputed_metrics.json anterior antes de sobrescribir.

Uso: .venv/Scripts/python.exe tools/swap_metrics_v3t.py
"""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DP = REPO / "framework_web/backend/data_processed"
CANON = DP / "precomputed_metrics.json"
V3T = DP / "precomputed_metrics_v3t.json"


def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def main() -> int:
    if not V3T.exists():
        raise SystemExit(f"Falta {V3T}; ejecuta compute_v3t_metrics.py primero.")
    data = _load(V3T)

    zl = _load(REPO / "results/model/zone_level_metrics.json")
    if zl:
        data["zone_level"] = zl
    op = _load(REPO / "results/model/operating_points.json")
    if op:
        data["operating_points"] = op
    aoa = _load(REPO / "results/model/aoa_v3t.json")
    if aoa:
        data["aoa"] = {
            "model": aoa.get("model"), "method": aoa.get("method"),
            "pct_inside_aoa": aoa.get("algemesi", {}).get("pct_inside_aoa"),
            "metrics": aoa.get("metrics"),
        }

    if CANON.exists():
        bak = CANON.with_suffix(".json.bak_" + time.strftime("%Y%m%d_%H%M%S"))
        shutil.copy(CANON, bak)
        print(f"Backup: {bak.name}")
    CANON.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    secciones = [k for k in ("valencia", "algemesi", "transferability",
                             "leakage_audit", "zone_level", "operating_points", "aoa")
                 if k in data]
    print(f"Escrito {CANON.name} con secciones: {', '.join(secciones)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
