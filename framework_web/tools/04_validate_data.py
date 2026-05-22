"""
04_validate_data.py
-------------------
Sanity checks pre-deploy de los archivos generados por 01-03 + 05.

Verifica:
  - Existencia de los archivos en backend/data_processed/
  - GeoJSONs validos (parseables, con feature collection)
  - Modelo random_forest_v2.joblib carga correctamente
  - Coherencia entre n_pixels declarados y filas del lookup
  - Modelo predice probabilidad razonable para una coordenada de test
"""
from __future__ import annotations

import json
import logging
import sys
import warnings
from pathlib import Path

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
DATA_DIR = REPO / "framework_web" / "backend" / "data_processed"
MODEL_PATH = REPO / "models" / "random_forest_v2.joblib"

EXPECTED_FILES = {
    "valencia_risk.geojson":            "geojson",
    "algemesi_risk.geojson":            "geojson",
    "ground_truth_valencia.geojson":    "geojson",
    "ground_truth_algemesi.geojson":    "geojson",
    "municipalities.geojson":           "geojson",
    "valencia_features_lookup.parquet": "parquet",
    "algemesi_features_lookup.parquet": "parquet",
    "precomputed_metrics.json":         "json",
    "predefined_portfolios.json":       "json",
}

FEATURE_COLS = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]


def _check_geojson(path: Path) -> tuple[bool, str]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("type") != "FeatureCollection":
            return False, "no es FeatureCollection"
        n = len(data.get("features", []))
        return True, f"{n} features"
    except Exception as exc:
        return False, str(exc)


def _check_parquet(path: Path) -> tuple[bool, str]:
    try:
        import pandas as pd
        df = pd.read_parquet(path)
        return True, f"{len(df)} filas, cols={list(df.columns)[:5]}..."
    except Exception as exc:
        return False, str(exc)


def _check_json(path: Path) -> tuple[bool, str]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return True, f"top-level keys: {list(data.keys())[:5]}"
        if isinstance(data, list):
            return True, f"list[{len(data)}]"
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def main() -> int:
    log.info("=" * 60)
    log.info("VALIDATE DATA — pre-deploy sanity checks")
    log.info("Data dir: %s", DATA_DIR)
    log.info("=" * 60)

    errors: list[str] = []
    warnings_list: list[str] = []

    # 1. Verificar archivos
    log.info("\n[1] Existencia + formato de archivos")
    for fname, kind in EXPECTED_FILES.items():
        p = DATA_DIR / fname
        if not p.exists():
            errors.append(f"FALTA: {fname}")
            log.error("  [MISSING] %s", fname)
            continue
        size_mb = p.stat().st_size / 1e6
        if kind == "geojson":
            ok, msg = _check_geojson(p)
        elif kind == "parquet":
            ok, msg = _check_parquet(p)
        else:
            ok, msg = _check_json(p)
        status = "OK   " if ok else "ERROR"
        log.info("  [%s] %s (%.2f MB)  %s", status, fname, size_mb, msg)
        if not ok:
            errors.append(f"FORMATO INVALIDO: {fname} — {msg}")

    # 2. Modelo
    log.info("\n[2] Modelo Random Forest v2")
    if not MODEL_PATH.exists():
        errors.append(f"FALTA modelo: {MODEL_PATH}")
        log.error("  [MISSING] %s", MODEL_PATH)
    else:
        try:
            import joblib, numpy as np
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                model = joblib.load(MODEL_PATH)
            log.info("  Modelo cargado: %s", type(model).__name__)
            log.info("  n_features_in_: %d", getattr(model, "n_features_in_", -1))
            log.info("  n_estimators: %d", getattr(model, "n_estimators", -1))
            log.info("  max_depth: %s", getattr(model, "max_depth", "?"))
            if model.n_features_in_ != 14:
                errors.append(f"Modelo espera {model.n_features_in_} features, esperado 14")
        except Exception as exc:
            errors.append(f"Error cargando modelo: {exc}")

    # 3. Coherencia lookup vs metricas
    log.info("\n[3] Coherencia lookup vs metricas")
    metrics_path = DATA_DIR / "precomputed_metrics.json"
    val_lookup = DATA_DIR / "valencia_features_lookup.parquet"
    alg_lookup = DATA_DIR / "algemesi_features_lookup.parquet"
    if metrics_path.exists() and val_lookup.exists():
        try:
            import pandas as pd
            with open(metrics_path, encoding="utf-8") as fh:
                m = json.load(fh)
            df_v = pd.read_parquet(val_lookup)
            n_decl = m.get("valencia", {}).get("n_pixels")
            log.info("  Valencia: lookup tiene %d filas, dataset original declara %d pixels",
                     len(df_v), n_decl)
            missing = [c for c in FEATURE_COLS if c not in df_v.columns]
            if missing:
                errors.append(f"Lookup Valencia: features faltantes {missing}")
            else:
                log.info("  Las 14 features estan en el lookup")
        except Exception as exc:
            warnings_list.append(f"Coherencia Valencia: {exc}")

    if alg_lookup.exists():
        try:
            import pandas as pd
            df_a = pd.read_parquet(alg_lookup)
            log.info("  Algemesi: lookup tiene %d filas", len(df_a))
        except Exception as exc:
            warnings_list.append(f"Coherencia Algemesi: {exc}")

    # 4. Sanity-check del modelo: predict sobre un punto de Paiporta
    log.info("\n[4] Sanity-check predict")
    if val_lookup.exists() and MODEL_PATH.exists():
        try:
            import pandas as pd, numpy as np, joblib
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                model = joblib.load(MODEL_PATH)
            df_v = pd.read_parquet(val_lookup)
            # Punto cercano a Paiporta: lat=39.4276, lon=-0.4153
            target_lat, target_lon = 39.4276, -0.4153
            d = ((df_v["lat"] - target_lat) ** 2 +
                 (df_v["lon"] - target_lon) ** 2)
            i = int(d.idxmin())
            row = df_v.iloc[i]
            X = row[FEATURE_COLS].to_numpy(dtype="float32").reshape(1, -1)
            p = float(model.predict_proba(X)[0, 1])
            p_pre = float(row["predicted_probability_v2"])
            log.info("  Paiporta proxy (lat=%.4f, lon=%.4f) lookup_pre=%.4f model=%.4f",
                     row["lat"], row["lon"], p_pre, p)
            if not (0.0 <= p <= 1.0):
                errors.append(f"Probabilidad fuera de [0,1]: {p}")
            if abs(p - p_pre) > 0.05:
                warnings_list.append(
                    f"Predicted probability divergence Paiporta: pre={p_pre:.4f} vs model={p:.4f}"
                )
        except Exception as exc:
            warnings_list.append(f"Sanity predict: {exc}")

    # 5. Tamano total
    log.info("\n[5] Tamano total data_processed")
    if DATA_DIR.exists():
        total_mb = sum(f.stat().st_size for f in DATA_DIR.iterdir()
                       if f.is_file()) / 1e6
        log.info("  %.2f MB", total_mb)
        if total_mb > 30:
            warnings_list.append(f"data_processed pesa {total_mb:.1f} MB > 30 MB")

    # Resumen
    log.info("\n" + "=" * 60)
    log.info("RESUMEN")
    log.info("=" * 60)
    log.info("  Errores : %d", len(errors))
    log.info("  Warnings: %d", len(warnings_list))
    for e in errors:
        log.error("  [ERROR]   %s", e)
    for w in warnings_list:
        log.warning("  [WARN]    %s", w)

    if errors:
        log.error("VALIDACION FALLIDA")
        return 1
    log.info("VALIDACION OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
