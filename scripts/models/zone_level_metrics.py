#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
zone_level_metrics.py
---------------------
Metricas a la ESCALA OPERATIVA real del producto (municipio y celda de 1 km),
no a nivel de pixel. La precision por pixel es estructuralmente baja (SAR banda
C + prevalencia extrema), pero un asegurador decide por codigo postal / barrio:
a esa escala los falsos positivos dispersos se promedian y la precision sube de
forma 100 % honesta. Es la cifra relevante para el caso de uso.

Regla: una unidad (municipio o celda 1 km) es POSITIVA ---predicha o real--- si
la fraccion de pixeles marcados/inundados supera UNIT_THR. precision/recall/F1
se calculan sobre unidades. Se reporta tambien el N de unidades.

Salida: results/model/zone_level_metrics.json (para mergear en precomputed).
Uso: .venv/Scripts/python.exe scripts/models/zone_level_metrics.py
"""
from __future__ import annotations
import json, logging
from pathlib import Path
import numpy as np, rasterio
import geopandas as gpd
from rasterio.features import rasterize
from sklearn.metrics import precision_score, recall_score, f1_score

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]
UNIT_THR = 0.05        # una unidad es "inundable/marcada" si >=5% de sus pixeles lo son
BLOCK_PX = 100         # 100 px * 10 m = celda de 1 km

ZONES = {
    "valencia": {
        "pred": "results/maps/04_risk_prediction/risk_binary_v3t.tif",
        "gt": "data/labels/flood_mask_emsr773_clipped.tif",
        "muni": "data/auxiliary/municipios/dana_affected_municipalities.geojson",
    },
    "algemesi": {
        "pred": "results/maps/05_extrapolation/risk_binary_algemesi_v3t.tif",
        "gt": "data/labels/algemesi/flood_mask_algemesi_clipped.tif",
        "muni": "data/auxiliary/municipios/algemesi_zone_municipalities.geojson",
    },
}


def _unit_metrics(unit_ids, pred_pos, gt_pos, valid, thr):
    """precision/recall/F1 sobre unidades. unit_ids: etiqueta por pixel (>=0;
    -1 = sin unidad). Una unidad es positiva si frac inundada >= thr."""
    ids = unit_ids[valid]; pp = pred_pos[valid]; gp = gt_pos[valid]
    uniq = np.unique(ids); uniq = uniq[uniq >= 0]
    yhat, ytrue = [], []
    for u in uniq:
        m = ids == u
        if m.sum() < 25:   # ignora unidades minusculas (<0.25 km2 de datos)
            continue
        yhat.append(int(pp[m].mean() >= thr))
        ytrue.append(int(gp[m].mean() >= thr))
    yhat, ytrue = np.array(yhat), np.array(ytrue)
    return {
        "n_units": int(len(yhat)),
        "n_pos_real": int(ytrue.sum()),
        "precision": float(precision_score(ytrue, yhat, zero_division=0)),
        "recall": float(recall_score(ytrue, yhat, zero_division=0)),
        "f1": float(f1_score(ytrue, yhat, zero_division=0)),
    }


def main():
    out = {}
    for zone, z in ZONES.items():
        with rasterio.open(REPO / z["pred"]) as ds:
            pred = ds.read(1); transform = ds.transform; crs = ds.crs; H, W = ds.shape
        with rasterio.open(REPO / z["gt"]) as ds:
            gt = ds.read(1)
        if gt.shape != pred.shape:
            log.warning("%s: shapes distintos, omitido", zone); continue
        valid = (pred != 255) & (gt != 255)
        pred_pos = pred == 1; gt_pos = gt == 1

        # --- municipios ---
        g = gpd.read_file(REPO / z["muni"]).to_crs(crs)
        shapes = [(geom, i + 1) for i, geom in enumerate(g.geometry)]
        muni_ids = rasterize(shapes, out_shape=(H, W), transform=transform,
                             fill=0, dtype="int32") - 1  # -1 = fuera de municipio
        m_muni = _unit_metrics(muni_ids, pred_pos, gt_pos, valid, UNIT_THR)

        # --- celda 1 km ---
        rr, cc = np.indices((H, W))
        nb_c = int(np.ceil(W / BLOCK_PX))
        cell_ids = ((rr // BLOCK_PX) * nb_c + (cc // BLOCK_PX)).astype("int32")
        m_cell = _unit_metrics(cell_ids, pred_pos, gt_pos, valid, UNIT_THR)

        out[zone] = {"municipality": m_muni, "grid_1km": m_cell, "unit_threshold": UNIT_THR}
        log.info("%s · MUNICIPIO  P=%.3f R=%.3f F1=%.3f (N=%d, pos=%d)",
                 zone, m_muni["precision"], m_muni["recall"], m_muni["f1"], m_muni["n_units"], m_muni["n_pos_real"])
        log.info("%s · 1km        P=%.3f R=%.3f F1=%.3f (N=%d, pos=%d)",
                 zone, m_cell["precision"], m_cell["recall"], m_cell["f1"], m_cell["n_units"], m_cell["n_pos_real"])

    dst = REPO / "results/model/zone_level_metrics.json"
    dst.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Escrito: %s", dst.relative_to(REPO))


if __name__ == "__main__":
    raise SystemExit(main())
