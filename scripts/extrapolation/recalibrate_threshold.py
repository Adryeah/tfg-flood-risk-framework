"""
Recalibracion de threshold para Algemesi — version eficiente con muestreo.
"""
import numpy as np
import rasterio
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROBA = REPO / "results/maps/05_extrapolation/risk_probability_algemesi.tif"
LABEL = REPO / "data/labels/algemesi/flood_mask_algemesi_clipped.tif"

# Cargar mascara y probabilidad desde GeoTIFF (mucho mas rapido que parquet)
print("Cargando label...")
with rasterio.open(LABEL) as ds:
    lbl = ds.read(1).astype("float32")
print("Cargando probabilidades...")
with rasterio.open(PROBA) as ds:
    prb = ds.read(1)

# Filtrar pixeles validos
mask = np.isfinite(prb) & (lbl != 255) & (lbl >= 0)
y = lbl[mask].astype("int8")
p = prb[mask]
del lbl, prb

n_pos = int((y == 1).sum())
print(f"Pixels validos: {len(y):,}  Inundados: {n_pos:,} ({100*n_pos/len(y):.2f}%)")
print(f"Proba: [{p.min():.4f}, {p.max():.4f}]  mediana={np.median(p):.4f}")

# Si hay mas de 2M pixeles, muestrear para velocidad
if len(y) > 2_000_000:
    rng = np.random.default_rng(42)
    idx_pos = np.where(y == 1)[0]
    idx_neg = np.where(y == 0)[0]
    n_pos_s = min(len(idx_pos), 500_000)
    n_neg_s = min(len(idx_neg), 1_500_000)
    idx_s = np.concatenate([
        rng.choice(idx_pos, n_pos_s, replace=False),
        rng.choice(idx_neg, n_neg_s, replace=False),
    ])
    y = y[idx_s]; p = p[idx_s]
    print(f"Muestreo: {len(y):,} (pos:{n_pos_s:,} neg:{n_neg_s:,})")

# Grid search
candidates = np.arange(0.001, 1.0, 0.002)
best_f1 = 0; best_thr_f1 = 0; best_info_f1 = None
best_thr_rec = 999; best_info_rec = None

print("\nBuscando thresholds optimos...")
for thr in candidates:
    pred = (p >= thr).astype("int8")
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    f1 = 2 * prec * rec / max(prec + rec, 1e-9)

    if f1 > best_f1:
        best_f1 = f1; best_thr_f1 = thr
        best_info_f1 = (tp, fp, fn, prec, rec)
    if rec >= 0.75 and thr < best_thr_rec:
        best_thr_rec = thr; best_info_rec = (tp, fp, fn, prec, rec, f1)

print("\n" + "=" * 60)
print("RESULTADOS RECALIBRACION ALGEMESI")
print("=" * 60)

tp, fp, fn, prec, rec = best_info_f1
print(f"\n--- Threshold optimo F1 ---")
print(f"  Threshold = {best_thr_f1:.3f}")
print(f"  F1        = {best_f1:.4f}")
print(f"  Recall    = {rec:.4f}")
print(f"  Precision = {prec:.4f}")
print(f"  TP={tp}  FP={fp}  FN={fn}")

if best_info_rec:
    tp, fp, fn, prec, rec, f1 = best_info_rec
    print(f"\n--- Threshold Recall>=0.75 (minimo) ---")
    print(f"  Threshold = {best_thr_rec:.3f}")
    print(f"  F1        = {f1:.4f}")
    print(f"  Recall    = {rec:.4f}")
    print(f"  Precision = {prec:.4f}")
    print(f"  TP={tp}  FP={fp}  FN={fn}")

# Mostrar curvas clave cada 0.02
print(f"\n--- Curva completa (thresholds clave) ---")
print(f"  {'thr':>6s}  {'F1':>8s}  {'Recall':>8s}  {'Prec':>8s}  {'TP':>8s}  {'FP':>8s}  {'FN':>8s}")
for thr in np.arange(0.01, 1.0, 0.02):
    thr = round(thr, 3)
    pred = (p >= thr).astype("int8")
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    f1 = 2 * prec * rec / max(prec + rec, 1e-9)
    print(f"  {thr:6.3f}  {f1:8.4f}  {rec:8.4f}  {prec:8.4f}  {tp:8d}  {fp:8d}  {fn:8d}")

# Recomendacion final
print(f"\n--- RECOMENDACION ---")
print(f"  Threshold optimo F1:  {best_thr_f1:.3f}")
print(f"  Threshold Valencia:    0.614 (NO transfiere)")
print(f"  Delta:                {best_thr_f1 - 0.614:+.3f}")
print(f"\n  El threshold 0.614 de Valencia produce 1.84M FP en Algemesi.")
print(f"  Recalibrando a {best_thr_f1:.3f} se obtiene F1={best_f1:.4f}.")
