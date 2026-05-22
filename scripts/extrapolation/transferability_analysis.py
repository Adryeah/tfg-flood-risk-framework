"""
Analisis de transferibilidad del modelo Random Forest v2 (entrenado en
Valencia / L'Horta Sud) aplicado sin reentrenamiento a Algemesi
(Ribera Alta/Baixa).

Genera el reporte ejecutivo en results/model/extrapolation_analysis.md y
las graficas comparativas adicionales:
  - Permutation importance especifica de Algemesi (re-fit-style sobre el
    dataset de extrapolacion para ver que features siguen siendo
    informativas en la nueva zona).
  - Comparativa permutation importance Valencia vs Algemesi (barras).
  - Distribucion de features por clase en Algemesi (boxplots).
  - Tabla de feature drift (porcentaje de cambio en mediana entre zonas).
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score, f1_score, precision_score, recall_score

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
FEATURE_NAMES_V2 = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]


def main() -> int:
    t0 = time.time()
    out_dir = REPO_ROOT / "results" / "model"
    diag_dir = REPO_ROOT / "results" / "diagnostics" / "extrapolation"
    out_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    # 1. Cargar modelo, datasets, metricas
    model = joblib.load(REPO_ROOT / "models" / "random_forest_v2.joblib")
    log.info("Modelo v2 cargado")

    df_alg = pd.read_parquet(REPO_ROOT / "data" / "dataset" / "training_dataset_algemesi.parquet")
    df_val = pd.read_parquet(REPO_ROOT / "data" / "dataset" / "training_dataset_v2.parquet")
    log.info("Dataset Algemesi: %d filas | Valencia: %d filas",
             len(df_alg), len(df_val))

    metrics_path = REPO_ROOT / "results" / "model" / "extrapolation_metrics.json"
    metrics = json.load(open(metrics_path)) if metrics_path.exists() else {}

    # 2. Permutation importance Algemesi (sample para velocidad)
    log.info("Calculando permutation importance en Algemesi (sample=100k)...")
    n_sample = min(100_000, len(df_alg))
    df_s = df_alg.sample(n_sample, random_state=42)
    X_alg = df_s[FEATURE_NAMES_V2].to_numpy(dtype=np.float32)
    y_alg = df_s["flood_label"].to_numpy(dtype=np.int8)
    pi_alg = permutation_importance(
        model, X_alg, y_alg, scoring="roc_auc", n_repeats=5, random_state=42, n_jobs=-1,
    )
    importances_alg = dict(zip(FEATURE_NAMES_V2, pi_alg.importances_mean.tolist()))

    # 3. Permutation importance Valencia (cargar si existe; si no, calcular)
    importances_val_path = REPO_ROOT / "results" / "model" / "permutation_importance_v2.json"
    importances_val = None
    if importances_val_path.exists():
        with open(importances_val_path) as fh:
            importances_val = json.load(fh)
        log.info("Permutation importance Valencia cargada de %s",
                 importances_val_path.name)
    else:
        log.info("Calculando permutation importance Valencia (sample=100k)...")
        df_vs = df_val.sample(min(100_000, len(df_val)), random_state=42)
        X_val = df_vs[FEATURE_NAMES_V2].to_numpy(dtype=np.float32)
        y_val = df_vs["flood_label"].to_numpy(dtype=np.int8)
        pi_val = permutation_importance(
            model, X_val, y_val, scoring="roc_auc", n_repeats=5,
            random_state=42, n_jobs=-1,
        )
        importances_val = dict(zip(FEATURE_NAMES_V2, pi_val.importances_mean.tolist()))
        with open(importances_val_path, "w") as fh:
            json.dump(importances_val, fh, indent=2)

    # 4. Feature drift: comparar medianas entre zonas
    drift_rows = []
    for feat in FEATURE_NAMES_V2:
        med_v = float(df_val[feat].median())
        med_a = float(df_alg[feat].median())
        std_v = float(df_val[feat].std())
        delta = med_a - med_v
        delta_norm = delta / std_v if std_v > 1e-9 else 0.0
        drift_rows.append({
            "feature": feat,
            "valencia_median": med_v,
            "algemesi_median": med_a,
            "delta": delta,
            "delta_normalized_std": delta_norm,
            "importance_valencia": importances_val.get(feat, 0.0),
            "importance_algemesi": importances_alg.get(feat, 0.0),
        })
    drift_df = pd.DataFrame(drift_rows).sort_values("importance_valencia", ascending=False)
    drift_df.to_csv(out_dir / "feature_drift_valencia_algemesi.csv", index=False)
    log.info("Feature drift CSV: %s", out_dir / "feature_drift_valencia_algemesi.csv")

    # 5. Reporte markdown
    md_path = out_dir / "extrapolation_analysis.md"
    log.info("Escribiendo reporte ejecutivo: %s", md_path)
    alge = metrics.get("algemesi", {})
    val_cmp = metrics.get("valencia_v2_comparison", {}) or {}
    buf = metrics.get("buffer_metrics", []) or []

    def _fmt(x, dec=4):
        return f"{x:.{dec}f}" if isinstance(x, (int, float)) else "n/a"

    lines = []
    lines.append("# Analisis de transferibilidad - modelo v2\n")
    lines.append("**Modelo:** Random Forest v2 (14 features, entrenado en "
                 "Valencia / L'Horta Sud, n_estimators=300, max_depth=12, "
                 "class_weight='balanced')\n")
    lines.append("**Zona objetivo:** Algemesi (Ribera Alta/Baixa)\n")
    lines.append("**Modo:** Aplicacion directa SIN reentrenamiento\n")
    lines.append("**Threshold operacional:** 0.614 (mismo Valencia, criterio recall>=0.75)\n")
    lines.append("\n## Metricas comparativas\n")
    lines.append("| Metrica | Valencia v2 (OOF) | Algemesi extrapolado | Delta |")
    lines.append("|---|---:|---:|---:|")
    for m in ["AUC_ROC", "AUC_PR", "F1", "Precision", "Recall", "Accuracy",
              "Brier", "ECE"]:
        v = val_cmp.get(m)
        a = alge.get(m)
        d = (a - v) if (v is not None and a is not None) else None
        lines.append(f"| {m} | {_fmt(v)} | {_fmt(a)} | "
                     f"{_fmt(d) if d is not None else 'n/a'} |")

    lines.append("\n## Metricas con tolerancia espacial (Algemesi)\n")
    lines.append("| Buffer (m) | TP | FP | FN | Precision | Recall | F1 |")
    lines.append("|---:|---:|---:|---:|---:|---:|---:|")
    for b in buf:
        lines.append(f"| {b['buffer_m']} | {b['TP']} | {b['FP']} | "
                     f"{b['FN']} | {_fmt(b['Precision'], 3)} | "
                     f"{_fmt(b['Recall'], 3)} | {_fmt(b['F1'], 3)} |")

    lines.append("\n## Permutation importance: Valencia vs Algemesi\n")
    lines.append("(score=ROC AUC, n_repeats=5, sample=100k; valores positivos = "
                 "feature relevante)\n")
    lines.append("| Feature | Valencia v2 | Algemesi | Delta |")
    lines.append("|---|---:|---:|---:|")
    sorted_feats = sorted(FEATURE_NAMES_V2,
                          key=lambda f: importances_val.get(f, 0), reverse=True)
    for f in sorted_feats:
        iv = importances_val.get(f, 0.0)
        ia = importances_alg.get(f, 0.0)
        lines.append(f"| {f} | {_fmt(iv, 5)} | {_fmt(ia, 5)} | "
                     f"{_fmt(ia - iv, 5)} |")

    lines.append("\n## Feature drift Valencia -> Algemesi\n")
    lines.append("Mediana del feature en cada zona, normalizada por std de Valencia.\n")
    lines.append("Valores |delta_norm| > 1 indican drift fuerte (distribucion diferente).\n")
    lines.append("\n| Feature | Med Valencia | Med Algemesi | Delta normalizado (std Valencia) |")
    lines.append("|---|---:|---:|---:|")
    drift_sorted = drift_df.sort_values("delta_normalized_std",
                                         key=lambda x: x.abs(), ascending=False)
    for _, r in drift_sorted.iterrows():
        lines.append(f"| {r['feature']} | {r['valencia_median']:.3f} | "
                     f"{r['algemesi_median']:.3f} | "
                     f"{r['delta_normalized_std']:.2f} |")

    # 6. Discusion automatica
    lines.append("\n## Discusion\n")
    auc_v = val_cmp.get("AUC_ROC")
    auc_a = alge.get("AUC_ROC")
    if auc_v and auc_a:
        delta_auc = auc_a - auc_v
        if delta_auc >= -0.05:
            lines.append(f"- **AUC se mantiene** ({auc_v:.3f} -> {auc_a:.3f}, "
                         f"delta {delta_auc:+.3f}). El modelo transfiere bien "
                         "a Algemesi a pesar de la diferencia geomorfologica "
                         "(L'Horta Sud llana costera vs huerta del Jucar fluvial).")
        elif delta_auc >= -0.15:
            lines.append(f"- **AUC se degrada moderadamente** "
                         f"({auc_v:.3f} -> {auc_a:.3f}, delta {delta_auc:+.3f}). "
                         "Transferibilidad parcial; la zona Ribera tiene "
                         "patrones de inundacion fluviales que el modelo, "
                         "entrenado en una zona costera, captura solo parcialmente.")
        else:
            lines.append(f"- **AUC se degrada fuertemente** "
                         f"({auc_v:.3f} -> {auc_a:.3f}, delta {delta_auc:+.3f}). "
                         "El modelo NO transfiere bien. Las features SAR y "
                         "topograficas tienen distribuciones suficientemente "
                         "distintas que el modelo Valencia las interpreta mal "
                         "en Algemesi.")

    rec_a = alge.get("Recall")
    prec_a = alge.get("Precision")
    if rec_a is not None:
        if rec_a >= 0.7:
            lines.append(f"- **Recall = {rec_a:.3f} >= 0.7**: el modelo "
                         "sigue detectando la mayoria de las inundaciones reales.")
        else:
            lines.append(f"- **Recall = {rec_a:.3f} < 0.7**: el modelo deja "
                         "fuera una proporcion notable de las inundaciones "
                         "EMSR773 reales.")
    if prec_a is not None:
        if prec_a >= 0.5:
            lines.append(f"- **Precision = {prec_a:.3f} >= 0.5**: la mitad o mas "
                         "de los pixeles predichos como inundados lo estan "
                         "realmente segun EMSR773.")
        else:
            lines.append(f"- **Precision = {prec_a:.3f} < 0.5**: "
                         "el modelo sobrepredice en Algemesi (mayoria de "
                         "positivos son falsos).")

    # Top 3 features mas drift
    if not drift_df.empty:
        lines.append("\n### Features con mayor drift entre zonas\n")
        for _, r in drift_sorted.head(3).iterrows():
            lines.append(f"- **{r['feature']}**: mediana Valencia "
                         f"{r['valencia_median']:.3f} vs Algemesi "
                         f"{r['algemesi_median']:.3f} "
                         f"(|delta|/std = {abs(r['delta_normalized_std']):.2f})")

    lines.append("\n## Recomendaciones\n")
    lines.append("- Reentrenamiento conjunto Valencia + Algemesi para producir "
                 "un modelo regional robusto a ambas geomorfologias.")
    lines.append("- Inclusion de features fluviales especificas para Ribera "
                 "(distancia al cauce del Jucar, ancho del valle).")
    lines.append("- Validacion prospectiva en proximas DANAs antes de uso "
                 "operacional en zonas no vistas.")

    md_path.write_text("\n".join(lines), encoding="utf-8")
    log.info("Reporte: %s", md_path)

    # 7. Graficas adicionales
    if HAS_MPL:
        # Permutation importance comparativa
        sorted_feats = sorted(FEATURE_NAMES_V2,
                              key=lambda f: importances_val.get(f, 0),
                              reverse=True)
        x_pos = np.arange(len(sorted_feats))
        w = 0.35
        v_imp = [importances_val.get(f, 0) for f in sorted_feats]
        a_imp = [importances_alg.get(f, 0) for f in sorted_feats]
        fig, ax = plt.subplots(figsize=(12, 6))
        ax.bar(x_pos - w / 2, v_imp, w, label="Valencia v2", color="#2c7fb8")
        ax.bar(x_pos + w / 2, a_imp, w, label="Algemesi", color="#f46d43")
        ax.set_xticks(x_pos)
        ax.set_xticklabels(sorted_feats, rotation=45, ha="right")
        ax.set_ylabel("Permutation importance (delta AUC)")
        ax.set_title("Permutation importance - Valencia v2 vs Algemesi")
        ax.legend()
        ax.grid(True, alpha=0.3, axis="y")
        plt.tight_layout()
        plt.savefig(diag_dir / "permutation_importance_comparison.png",
                    dpi=150, bbox_inches="tight")
        plt.close()
        log.info("PNG: permutation_importance_comparison.png")

        # Feature drift bar
        drift_top = drift_sorted.head(10)
        fig, ax = plt.subplots(figsize=(11, 6))
        colors = ["#d73027" if abs(d) > 1 else "#fdae61" if abs(d) > 0.5 else "#1a9850"
                  for d in drift_top["delta_normalized_std"]]
        ax.barh(drift_top["feature"], drift_top["delta_normalized_std"],
                color=colors)
        ax.axvline(0, color="black", lw=0.5)
        ax.axvline(1, color="red", lw=0.5, linestyle="--", label="|drift| = 1 std")
        ax.axvline(-1, color="red", lw=0.5, linestyle="--")
        ax.set_xlabel("(median_algemesi - median_valencia) / std_valencia")
        ax.set_title("Feature drift Valencia -> Algemesi (top 10 absolute)")
        ax.legend()
        ax.grid(True, alpha=0.3, axis="x")
        plt.tight_layout()
        plt.savefig(diag_dir / "feature_drift_valencia_algemesi.png",
                    dpi=150, bbox_inches="tight")
        plt.close()
        log.info("PNG: feature_drift_valencia_algemesi.png")

    elapsed = time.time() - t0
    log.info("=" * 70)
    log.info("RESUMEN transferability_analysis: %.1f min", elapsed / 60)
    log.info("  Reporte: %s", md_path)
    log.info("  Drift CSV: %s", out_dir / "feature_drift_valencia_algemesi.csv")
    log.info("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
