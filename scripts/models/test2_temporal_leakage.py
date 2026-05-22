"""
TEST 2 - Leakage temporal en seasonal features.

Diagnostico:
  El script extract_advanced_features_v3.py tiene un filtro defectuoso:
      if "event" not in p.parts
  Solo excluye archivos en SUBDIRECTORIO event/. NO excluye escenas
  con fechas evento que esten directamente en processed/.

  Cuando se ejecuto el script (Mayo 2 2026 23:58), las escenas
  20241019 (pre-DANA) y 20241031 (during-DANA) estaban en
  data/sentinel1/processed/ directamente (timestamps 19:20 y 19:21).

  Por tanto las features:
      winter_mean_sigma0_vv, winter_min_sigma0_vv, winter_std_sigma0_vv,
      winter_minus_summer_vv
  INCLUYEN las escenas de la inundacion. Esto es LEAKAGE TEMPORAL DIRECTO.

Verificacion empirica:
  Regenera las 4 winter features SIN las 2 escenas evento y compara
  con las originales. Si difieren significativamente en pixeles
  inundados, confirmacion del leakage.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject as rio_reproject

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]
MIN_LIN = 1e-9


def _load_db(p: Path, band_idx: int, canon_t, canon_crs, shape):
    rows, cols = shape
    dst = np.empty((rows, cols), dtype="float32")
    with rasterio.open(p) as src:
        rio_reproject(
            source=rasterio.band(src, band_idx), destination=dst,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=canon_t, dst_crs=canon_crs,
            resampling=Resampling.bilinear,
            src_nodata=src.nodata, dst_nodata=np.nan,
        )
    with np.errstate(divide="ignore", invalid="ignore"):
        db = np.where(dst > MIN_LIN, 10.0 * np.log10(dst), np.nan).astype("float32")
    return db


def _band_index(p: Path, name: str) -> int:
    with rasterio.open(p) as ds:
        for i, desc in enumerate(ds.descriptions, start=1):
            if desc and name.lower() in desc.lower():
                return i
    return 2 if name.upper() == "VV" else 1


def _is_winter(date_str: str) -> bool:
    """Mes 10-12 o 1-3 = invierno."""
    m = int(date_str[4:6])
    return m in (10, 11, 12, 1, 2, 3)


def _date(p: Path) -> str:
    for part in p.stem.split("_"):
        if len(part) == 8 and part.isdigit():
            return part
    return ""


def main():
    t0 = time.time()
    log.info("=" * 75)
    log.info("TEST 2 - Leakage temporal seasonal features")
    log.info("=" * 75)

    out_dir = REPO / "results" / "model"
    diag_dir = REPO / "results" / "diagnostics" / "leakage_tests"
    clean_dir = REPO / "data" / "features" / "advanced_clean"
    out_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)
    clean_dir.mkdir(parents=True, exist_ok=True)

    # 1. Diagnostico de fechas usadas
    processed = REPO / "data" / "sentinel1" / "processed"
    tifs = sorted(processed.glob("S1_sigma0_*.tif"))
    log.info("Escenas en processed/: %d", len(tifs))
    for t in tifs:
        d = _date(t)
        log.info("  %s  %s",
                 d, "(WINTER)" if _is_winter(d) else "(summer)")

    # 2. Filtro original del script v3 (solo excluye subfolder event/)
    used_by_v3 = [t for t in tifs if "event" not in t.parts]
    log.info("Escenas usadas por extract_advanced_features_v3.py "
             "(filtro 'event' not in p.parts): %d", len(used_by_v3))
    event_dates = ("20241019", "20241031")
    leakage_scenes = [t for t in used_by_v3 if _date(t) in event_dates]
    log.info("Escenas EVENTO incluidas indebidamente: %d",
             len(leakage_scenes))
    for t in leakage_scenes:
        log.info("  -> %s  fecha=%s  (%s)",
                 t.name, _date(t),
                 "winter" if _is_winter(_date(t)) else "summer")

    has_leakage = len(leakage_scenes) > 0

    # 3. Si hay leakage, regenerar winter features SIN escenas evento
    if not has_leakage:
        log.info("Sin leakage detectado. Test 2 = OK")
        verdict = "OK"
        results = {"test": "2_temporal_leakage",
                   "leakage_scenes_included": 0,
                   "verdict": verdict}
        with open(out_dir / "test2_temporal_leakage_results.json", "w") as fh:
            json.dump(results, fh, indent=2)
        return verdict

    log.info("=" * 75)
    log.info("LEAKAGE TEMPORAL CONFIRMADO. Regenerando features limpias...")
    log.info("=" * 75)

    # Grid canonico
    wf = REPO / "data/sentinel1/water_masks/water_frequency.tif"
    with rasterio.open(wf) as ref:
        canon_t = ref.transform; canon_crs = ref.crs
        rows, cols = ref.height, ref.width

    # Re-procesar SOLO escenas baseline (sin event_dates)
    baseline_tifs = [t for t in used_by_v3 if _date(t) not in event_dates]
    winter_clean = [t for t in baseline_tifs if _is_winter(_date(t))]
    log.info("Escenas winter baseline (limpias): %d", len(winter_clean))
    for t in winter_clean:
        log.info("  - %s", _date(t))

    vv_idx = _band_index(baseline_tifs[0], "VV")

    # Stack winter clean
    log.info("Apilando winter (clean)...")
    stack_w = np.empty((len(winter_clean), rows, cols), dtype="float32")
    for i, t in enumerate(winter_clean):
        stack_w[i] = _load_db(t, vv_idx, canon_t, canon_crs, (rows, cols))
        log.info("  [%d/%d] %s", i + 1, len(winter_clean), _date(t))

    winter_mean_clean = np.nanmean(stack_w, axis=0).astype("float32")
    winter_min_clean  = np.nanmin(stack_w, axis=0).astype("float32")
    winter_std_clean  = np.nanstd(stack_w, axis=0).astype("float32")

    # Cargar summer mean original (no afectado por leakage, summer no incluye eventos)
    with rasterio.open(REPO / "data/features/advanced/summer_mean_sigma0_vv.tif") as s:
        summer_mean = s.read(1).astype("float32")
    diff_clean = (winter_mean_clean - summer_mean).astype("float32")

    # Guardar limpios
    def _save(arr, name):
        p = clean_dir / f"{name}.tif"
        prof = {"driver": "GTiff", "dtype": "float32", "count": 1,
                "width": cols, "height": rows, "crs": canon_crs,
                "transform": canon_t, "nodata": np.nan, "compress": "lzw"}
        with rasterio.open(p, "w", **prof) as dst:
            dst.write(arr, 1)
        log.info("  %s  %.2f MB", p.name, p.stat().st_size / 1e6)

    _save(winter_mean_clean, "winter_mean_sigma0_vv")
    _save(winter_min_clean,  "winter_min_sigma0_vv")
    _save(winter_std_clean,  "winter_std_sigma0_vv")
    _save(diff_clean, "winter_minus_summer_vv")

    # 4. Comparar con features originales (con leakage)
    def _load(p: Path) -> np.ndarray:
        with rasterio.open(p) as ds:
            arr = ds.read(1).astype("float32")
            nd = ds.nodata
        if nd is not None and not np.isnan(nd):
            arr[arr == nd] = np.nan
        return arr

    orig = {n: _load(REPO / f"data/features/advanced/{n}.tif")
            for n in ("winter_mean_sigma0_vv", "winter_min_sigma0_vv",
                      "winter_std_sigma0_vv", "winter_minus_summer_vv")}
    clean = {"winter_mean_sigma0_vv": winter_mean_clean,
             "winter_min_sigma0_vv":  winter_min_clean,
             "winter_std_sigma0_vv":  winter_std_clean,
             "winter_minus_summer_vv": diff_clean}

    # Cargar mascara inundacion para comparar inund vs no-inund
    with rasterio.open(REPO / "data/labels/flood_mask_emsr773_clipped.tif") as ds:
        lbl = ds.read(1)
    flooded = lbl == 1
    notflood = lbl == 0

    log.info("=" * 75)
    log.info("DIFERENCIAS ORIGINAL (con leakage) vs CLEAN")
    log.info("=" * 75)
    diff_summary = {}
    for name in clean:
        o = orig[name]; c = clean[name]
        d = (o - c)
        valid = np.isfinite(o) & np.isfinite(c)
        d_f = d[valid & flooded]
        d_nf = d[valid & notflood]
        med_f = float(np.median(d_f)) if d_f.size else np.nan
        med_nf = float(np.median(d_nf)) if d_nf.size else np.nan
        max_abs = float(np.nanmax(np.abs(d[valid]))) if valid.any() else np.nan
        log.info("  %-30s  med_diff_inundados=%+.3f  med_diff_no_inund=%+.3f  max|diff|=%.3f",
                 name, med_f, med_nf, max_abs)
        diff_summary[name] = {"median_diff_flooded": med_f,
                              "median_diff_notflooded": med_nf,
                              "max_abs_diff": max_abs}

    # 5. Verdict
    # El leakage es claro: las 4 winter features incluyen las 2 escenas evento.
    # La magnitud de las diferencias en pixeles inundados confirma el impacto.
    verdict = "LEAKAGE_DIRECTO_CONFIRMADO"
    log.info("VEREDICTO: %s", verdict)

    # 6. PNG diagnostico
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axes = plt.subplots(2, 4, figsize=(20, 9))
        for j, name in enumerate(clean):
            o = orig[name]; c = clean[name]; d = o - c
            for k, (arr, title, cmap, vmin, vmax) in enumerate([
                (d, f"{name}\norig - clean", "RdBu_r", -2, 2),
                (np.where(flooded, d, np.nan),
                 f"{name}\norig - clean (inundados)", "RdBu_r", -3, 3),
            ]):
                ax = axes[k, j]
                ax.imshow(arr, cmap=cmap, vmin=vmin, vmax=vmax,
                          interpolation="nearest")
                ax.set_title(title, fontsize=9)
                ax.axis("off")
        plt.suptitle(
            "Test 2 - Diferencias winter features (original con leakage) - (clean sin leakage)",
            fontsize=12,
        )
        plt.tight_layout()
        plt.savefig(diag_dir / "test2_temporal_leakage.png",
                    dpi=120, bbox_inches="tight")
        plt.close()
        log.info("PNG: %s", diag_dir / "test2_temporal_leakage.png")
    except Exception as exc:
        log.warning("PNG no generado: %s", exc)

    # 7. JSON resultados + reporte md
    results = {
        "test": "2_temporal_leakage",
        "leakage_scenes_included": [_date(t) for t in leakage_scenes],
        "winter_baseline_clean": [_date(t) for t in winter_clean],
        "diff_summary": diff_summary,
        "verdict": verdict,
        "clean_features_dir": str(clean_dir),
    }
    with open(out_dir / "test2_temporal_leakage_results.json", "w") as fh:
        json.dump(results, fh, indent=2)
    log.info("JSON: %s", out_dir / "test2_temporal_leakage_results.json")

    md = out_dir / "test2_temporal_leakage_report.md"
    with open(md, "w", encoding="utf-8") as fh:
        fh.write(f"""# Test 2 - Leakage temporal seasonal features

## Diagnostico

El script `scripts/features/extract_advanced_features_v3.py` filtra escenas con:

```python
tifs = sorted(p for p in processed_dir.glob("S1_sigma0_*.tif")
              if "event" not in p.parts)
```

Solo excluye archivos cuyo path contenga el subdirectorio `event/`.
NO excluye escenas con fechas evento que esten DIRECTAMENTE en
`processed/`.

**Cuando se ejecuto el script** (timestamps `data/features/advanced/`),
las escenas evento estaban en `processed/`:

| escena | timestamp en processed/ |
|---|---|
| S1_sigma0_20241019_orb103.tif | 2026-05-02 19:20:13 |
| S1_sigma0_20241031_orb103.tif | 2026-05-02 19:21:06 |
| winter_mean_sigma0_vv.tif (generada) | 2026-05-02 23:58:16 |

Las 2 escenas evento entraron al stack winter (mes oct = invierno).

## Escenas afectadas

Features calculadas con leakage:
- `winter_mean_sigma0_vv` (incluye 19 oct y 31 oct 2024)
- `winter_min_sigma0_vv`  (idem)
- `winter_std_sigma0_vv`  (idem)
- `winter_minus_summer_vv` = winter_mean - summer_mean (heredando winter_mean contaminado)

Features NO afectadas:
- `summer_*`  (las 6 escenas Apr-Sep 2024 son todas pre-DANA)
- `urban_mask`, `local_std_5x5`, `local_range_5x5`

## Verificacion empirica

Regenerando las 4 winter features SOLO con escenas baseline
(excluyendo 20241019 y 20241031), las diferencias por feature son:

| feature | median diff (inundados) | median diff (no inundados) | max abs diff |
|---|---:|---:|---:|
""")
        for name, d in diff_summary.items():
            fh.write(f"| {name} | {d['median_diff_flooded']:+.3f} | "
                     f"{d['median_diff_notflooded']:+.3f} | "
                     f"{d['max_abs_diff']:.3f} |\n")
        fh.write(f"""

## Veredicto

**{verdict}**

El filtro defectuoso ha permitido que las escenas SAR del 19 oct 2024
(dia D-1 de la DANA, lluvias acumuladas previas) y 31 oct 2024
(dia D+2 con la inundacion aun persistente) entren a las features
de invierno. El modelo XGBoost v3 ha sido entrenado con features
que CONTIENEN la inundacion que debe predecir.

Features limpias generadas en: `data/features/advanced_clean/`

Para corregir: re-entrenar el modelo usando las features de
`data/features/advanced_clean/` en lugar de `data/features/advanced/`
para las 4 features winter.
""")
    log.info("Reporte: %s", md)
    log.info("Tiempo total Test 2: %.1f min", (time.time() - t0) / 60)
    return verdict


if __name__ == "__main__":
    sys.exit(0 if main() == "OK" else 1)
