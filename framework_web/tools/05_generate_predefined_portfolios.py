"""
05_generate_predefined_portfolios.py
------------------------------------
Genera 3 carteras sinteticas predefinidas con clientes geolocalizados,
features extraidas del lookup y prediccion del modelo Random Forest v2,
y las guarda en backend/data_processed/predefined_portfolios.json.

PRODUCTS (nuevo eje C1+):
  - particulares  (subtypes: piso · casa · chalet)
      Tomadores residenciales. Daños proporcionales a la planta + tipo de
      vivienda (un piso bajo se inunda; un chalet con planta única tambien).
  - pymes         (subtypes: comercio · oficina · nave)
      Pequeña y mediana empresa: locales de calle, oficinas profesionales,
      naves logisticas/industriales. Damage ratio mas alto que vivienda.
  - autos         (subtypes: coche · moto · furgoneta)
      Polizas automóvil: el vehículo se aparca en calle/garaje y se daña
      por anegamiento. Valor asegurado mucho menor pero damage ratio alto.

Damage ratios (asuncion didactica documentada):
  particulares  piso (planta alta)  : 0.05
  particulares  piso (planta baja)  : 0.25
  particulares  casa                : 0.30
  particulares  chalet              : 0.32
  pymes         comercio            : 0.35
  pymes         oficina             : 0.20
  pymes         nave                : 0.40
  autos         coche               : 0.55
  autos         moto                : 0.65
  autos         furgoneta           : 0.50

Annual premium = insured_value * 0.0015 (no autos) o * 0.04 (autos) con
ruido +-20%. prob_event_year = 0.05 (1 DANA-like cada 20 anos).
expected_annual_loss = estimated_loss_dana * prob_event_year.

Backwards-compat: cada cliente lleva `type` (residential | commercial |
industrial | auto) ADEMAS del nuevo `product` para que vistas viejas no
se rompan durante la migración.
"""
from __future__ import annotations

import json
import logging
import random
import sys
import warnings
from datetime import date, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from shapely.geometry import Point, shape as shp_shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
DATA_DIR = REPO / "framework_web" / "backend" / "data_processed"
MODEL_PATH = REPO / "models" / "random_forest_v2.joblib"

FEATURE_COLS = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]

# (product, subtype, ground_floor?) -> damage ratio
DAMAGE_RATIOS = {
    ("particulares", "piso_alto",      False): 0.05,
    ("particulares", "piso_bajo",      True):  0.25,
    ("particulares", "casa",           True):  0.30,
    ("particulares", "chalet",         True):  0.32,
    ("pymes",        "comercio",       True):  0.35,
    ("pymes",        "oficina",        False): 0.20,
    ("pymes",        "nave",           True):  0.40,
    ("autos",        "coche",          True):  0.55,
    ("autos",        "moto",           True):  0.65,
    ("autos",        "furgoneta",      True):  0.50,
}
PROB_EVENT_YEAR = 0.05
THRESHOLD_OPERATIONAL = 0.614

# Legacy type mapping for backwards compat with /exposure distribution_by_type
# and the old vanilla Overview that still reads `type`.
PRODUCT_LEGACY_TYPE = {
    "particulares": "residential",
    "pymes":        "commercial",   # antes commercial+industrial → ahora pymes
    "autos":        "auto",
}

# Centros de poblacion DANA con peso (lat, lon, weight)
VALENCIA_CITY_CENTERS = [
    (39.4699, -0.3763, 25),  # Valencia ciudad
    (39.4276, -0.4153, 18),  # Paiporta
    (39.4019, -0.4006, 15),  # Catarroja
    (39.4366, -0.4665, 12),  # Torrent
    (39.3811, -0.3923, 10),  # Albal
    (39.3893, -0.4012,  8),  # Beniparrell
    (39.3675, -0.4670, 12),  # Picassent
    (39.4280, -0.4480, 10),  # Aldaia
    (39.4500, -0.4350,  8),  # Manises
    (39.4650, -0.4500,  8),  # Quart de Poblet
    (39.4140, -0.3870, 10),  # Alfafar
    (39.4200, -0.3860,  9),  # Sedavi
    (39.4178, -0.3935,  8),  # Massanassa
    (39.4127, -0.3930,  7),  # Benetusser
]

INDUSTRIAL_ZONES = [
    (39.4170, -0.3960,  4),   # Sedavi industrial
    (39.4480, -0.4480,  3),   # Manises industrial
    (39.4720, -0.4400,  3),   # Quart de Poblet industrial
    (39.3690, -0.4820,  2),   # Picassent industrial
    (39.4400, -0.4350,  2),   # Aldaia industrial
]


def _rng(seed: int) -> random.Random:
    return random.Random(seed)


def _sample_lognormal(rng: random.Random, mean_value: float,
                      vmin: float, vmax: float) -> float:
    sigma = 0.5
    mu = np.log(mean_value) - 0.5 * sigma ** 2
    while True:
        v = float(np.exp(rng.gauss(mu, sigma)))
        if vmin <= v <= vmax:
            return v


def _sample_location_weighted(rng: random.Random,
                               centers: list[tuple[float, float, int]],
                               jitter_deg: float = 0.012) -> tuple[float, float]:
    weights = [c[2] for c in centers]
    chosen = rng.choices(centers, weights=weights, k=1)[0]
    lat = chosen[0] + rng.gauss(0, jitter_deg)
    lon = chosen[1] + rng.gauss(0, jitter_deg)
    return lat, lon


def _sample_location_uniform(rng: random.Random, bbox: tuple) -> tuple[float, float]:
    return (rng.uniform(bbox[1], bbox[3]),
            rng.uniform(bbox[0], bbox[2]))


def _sample_location_multi_bbox(rng: random.Random,
                                  bboxes: list[tuple]) -> tuple[float, float]:
    """Uniform sampling restringido a una unión disjunta de bboxes.

    Elige uno de los bboxes aleatoriamente (ponderado por área en grados²) y
    muestrea dentro de él. Garantiza que el punto cae EN ALGUNO de los
    bboxes — esencial cuando queremos cubrir dos zonas no contiguas (p.ej.
    Valencia + Algemesí) sin contaminar la franja intermedia donde no
    tenemos superficie de riesgo modelada."""
    areas = [(bb[2] - bb[0]) * (bb[3] - bb[1]) for bb in bboxes]
    chosen = rng.choices(bboxes, weights=areas, k=1)[0]
    return _sample_location_uniform(rng, chosen)


def _sample_location_lookup(rng: random.Random,
                              lookup_indices: dict[str, np.ndarray],
                              lookup_df: pd.DataFrame,
                              zone_weights: dict[str, float]) -> tuple[float, float, int]:
    """Muestrea directamente de filas del lookup_df.

    GARANTIZA que el punto cae sobre un píxel modelado por el Random Forest
    (toda fila del lookup tiene risk_probability porque viene del pipeline
    SAR completo). Esto evita el problema de antes: muestrear (lat, lon)
    uniformemente en el bbox y luego buscar el nearest neighbour — si el
    bbox cubría área sin lookup (mar, montaña), el NN podía estar lejos y
    la póliza aparecía "flotando" fuera de la superficie de riesgo.

    Args:
        lookup_indices: {zone_name: np.array de índices del lookup_df que
            pertenecen a esa zona}. Precomputado una sola vez.
        zone_weights: {zone_name: peso}. Suele ser proporcional al # de
            filas de cada zona (Valencia + Algemesí ≈ 99K cada una).

    Returns: (lat, lon, lookup_row_index) — el índice se devuelve para
    que _build_client pueda reusar la fila sin volver a buscar por kd-tree.
    """
    zones = list(zone_weights.keys())
    weights = [zone_weights[z] for z in zones]
    chosen_zone = rng.choices(zones, weights=weights, k=1)[0]
    indices = lookup_indices[chosen_zone]
    nn_idx = int(indices[rng.randint(0, len(indices) - 1)])
    row = lookup_df.iloc[nn_idx]
    return float(row["lat"]), float(row["lon"]), nn_idx


def _filter_lookup_to_risk_surface(lookup_df: pd.DataFrame,
                                     zone_to_geojson: dict[str, Path]
                                     ) -> dict[str, np.ndarray]:
    """Devuelve `{zone: indices del lookup_df que caen dentro de la
    superficie de riesgo visible (geojson)}`.

    Motivación: el lookup cubre todo el grid SAR (mar incluido), pero el
    risk geojson solo cubre los píxeles agrupados en bins de probabilidad
    (terreno modelado, sin mar). Si muestreáramos lookup directamente
    aparecerían pólizas "flotando" sobre el mar o fuera de la mancha
    visible. Filtramos una sola vez al inicio y luego sampleamos solo
    índices "válidos"."""
    import geopandas as gpd  # local import — only needed for this filter

    out = {}
    for zone, gj_path in zone_to_geojson.items():
        if not gj_path.exists():
            log.warning("  no hay %s — sin filtro de superficie para %s",
                        gj_path.name, zone)
            out[zone] = lookup_df.index[lookup_df["zone"] == zone].to_numpy(
                dtype="int64")
            continue

        with open(gj_path, encoding="utf-8") as fh:
            gj = json.load(fh)
        polys = []
        for feat in gj["features"]:
            try:
                polys.append(shp_shape(feat["geometry"]))
            except Exception:  # noqa: BLE001
                continue
        if not polys:
            out[zone] = lookup_df.index[lookup_df["zone"] == zone].to_numpy(
                dtype="int64")
            continue

        # Build polygons GeoDataFrame
        poly_gdf = gpd.GeoDataFrame(geometry=polys, crs="EPSG:4326")

        # Subset lookup to this zone, build points GeoDataFrame, spatial join
        zone_mask = lookup_df["zone"] == zone
        zone_df = lookup_df.loc[zone_mask].copy()
        zone_df["__orig_idx"] = zone_df.index
        pts = gpd.points_from_xy(zone_df["lon"], zone_df["lat"], crs="EPSG:4326")
        pts_gdf = gpd.GeoDataFrame(zone_df[["__orig_idx"]], geometry=pts)

        joined = gpd.sjoin(pts_gdf, poly_gdf, how="inner", predicate="within")
        # Deduplicate (a point may sit on a polygon border and match >1)
        kept = joined["__orig_idx"].unique()
        out[zone] = np.sort(kept.astype("int64"))
        log.info("  zona %s: %d / %d lookup rows dentro de la superficie de riesgo",
                 zone, len(out[zone]), int(zone_mask.sum()))
    return out


def _load_land_mask(geojson_path: Path):
    """Returns a callable `is_land(lat, lon) -> bool` that uses the union of
    DANA-affected municipality polygons as a land mask. Anything outside the
    union (sea, irrigation lagoon, mountain to the west of the bbox we don't
    cover) returns False. The union is built once and indexed with STRtree
    so per-point membership checks are O(log n)."""
    with open(geojson_path, encoding="utf-8") as fh:
        gj = json.load(fh)
    polys = []
    for feat in gj["features"]:
        try:
            polys.append(shp_shape(feat["geometry"]))
        except Exception:  # noqa: BLE001
            continue
    if not polys:
        return lambda lat, lon: True   # nothing to filter against → permit
    land = unary_union(polys)

    def is_land(lat: float, lon: float) -> bool:
        return land.contains(Point(lon, lat))

    return is_land


def _classify_subtype_particulares(rng: random.Random,
                                    ground_floor_prob: float
                                    ) -> tuple[str, bool, int]:
    """Devuelve (subtype, ground_floor, floor_count) para particulares."""
    r = rng.random()
    if r < 0.10:
        return "chalet", True, rng.randint(1, 2)
    if r < 0.25:
        return "casa", True, rng.randint(1, 3)
    # piso
    ground_floor = rng.random() < ground_floor_prob
    floors = rng.choice([3, 4, 5, 6, 7, 8])
    return ("piso_bajo" if ground_floor else "piso_alto",
            ground_floor, floors)


def _classify_subtype_pymes(rng: random.Random) -> tuple[str, bool, int]:
    """(subtype, ground_floor, floor_count) para pymes."""
    r = rng.random()
    if r < 0.55:
        return "comercio", True, rng.randint(1, 2)        # locales calle
    if r < 0.80:
        return "oficina", False, rng.randint(2, 8)        # plantas medias
    return "nave", True, 1                                  # industrial


def _classify_subtype_autos(rng: random.Random) -> tuple[str, bool, int]:
    """(subtype, ground_floor=True siempre, floor_count=0)."""
    r = rng.random()
    if r < 0.70:
        return "coche", True, 0
    if r < 0.90:
        return "moto", True, 0
    return "furgoneta", True, 0


def _premium_factor(product: str) -> float:
    """Prima/valor asegurado anual. Autos pagan ~4% del valor del vehiculo
    (mercado español: seguro a todo riesgo medio ≈ 3-5%). Vivienda y pymes
    pagan ≈ 0.15% del capital (poliza hogar/comercio multirriesgo)."""
    if product == "autos":
        return 0.04
    return 0.0015


def _value_bounds_for(product: str, base_min: int, base_max: int,
                      base_mean: int) -> tuple[int, int, int]:
    """Autos tienen valor mucho menor que vivienda/comercio. Para no tener
    que pasar 6 parametros por cliente, sobreescribimos aquí."""
    if product == "autos":
        return 15_000, 60_000, 22_000
    return base_min, base_max, base_mean


def _build_client(idx: int, prefix: str, rng: random.Random,
                  lookup_df: pd.DataFrame, lookup_tree: cKDTree,
                  model, product: str, value_mean: float,
                  value_min: float, value_max: float,
                  ground_floor_prob: float,
                  year_min: int, year_max: int,
                  centers: list, location_mode: str = "weighted",
                  bbox: tuple | None = None,
                  bboxes: list[tuple] | None = None,
                  lookup_indices: dict | None = None,
                  zone_weights: dict | None = None,
                  is_land=None) -> dict:
    # Coordenada — dos caminos posibles:
    #
    # (A) location_mode="lookup": muestreo DIRECTO de filas del lookup_df.
    #     Garantiza que la coordenada cae sobre un píxel modelado (porque
    #     toda fila del lookup tiene risk_probability). Es el modo correcto
    #     para portfolios distribuidos uniformemente sobre las zonas de
    #     estudio — evita pólizas "flotando" en mar / huerta sin modelar.
    #
    # (B) Resto (weighted / multi_bbox / uniform): genera un (lat, lon)
    #     candidato y luego busca el lookup más cercano con kd-tree. Usado
    #     para portfolios concentrados en centros urbanos específicos
    #     (premium_residential pegado a Valencia ciudad / Paiporta) donde
    #     queremos forzar la distribución por gaussianas alrededor de
    #     coordenadas conocidas.
    if location_mode == "lookup":
        lat, lon, nn_idx = _sample_location_lookup(
            rng, lookup_indices, lookup_df, zone_weights
        )
        row = lookup_df.iloc[nn_idx]
    else:
        MAX_ATTEMPTS = 40
        for _attempt in range(MAX_ATTEMPTS):
            if location_mode == "weighted":
                lat, lon = _sample_location_weighted(rng, centers)
            elif location_mode == "multi_bbox":
                lat, lon = _sample_location_multi_bbox(rng, bboxes)
            else:
                lat, lon = _sample_location_uniform(rng, bbox)
            if is_land is None or is_land(lat, lon):
                break
        # Snap to nearest lookup pixel
        _, nn_idx = lookup_tree.query([lat, lon], k=1)
        row = lookup_df.iloc[int(nn_idx)]

    # Modelo (prediccion fresca para garantizar consistencia)
    X = row[FEATURE_COLS].to_numpy(dtype="float32").reshape(1, -1)
    risk_p = float(model.predict_proba(X)[0, 1])

    if risk_p >= 0.75:
        category = "very_high"
    elif risk_p >= 0.50:
        category = "high"
    elif risk_p >= 0.25:
        category = "moderate"
    else:
        category = "low"

    # Subtype + parámetros físicos según producto
    if product == "particulares":
        subtype, ground_floor, floor_count = _classify_subtype_particulares(
            rng, ground_floor_prob
        )
    elif product == "pymes":
        subtype, ground_floor, floor_count = _classify_subtype_pymes(rng)
    elif product == "autos":
        subtype, ground_floor, floor_count = _classify_subtype_autos(rng)
    else:
        raise ValueError(f"Unknown product: {product}")

    damage_ratio = DAMAGE_RATIOS.get((product, subtype, ground_floor),
                                      0.25)  # safety fallback

    # Valores ajustados según producto
    vmin, vmax, vmean = _value_bounds_for(
        product, int(value_min), int(value_max), int(value_mean)
    )
    insured_value = round(_sample_lognormal(rng, vmean, vmin, vmax), 0)

    if product == "autos":
        # Coches/motos/furgos: año de matriculación, no construcción.
        # Mas modernos para que el valor asegurado tenga sentido.
        construction_year = rng.randint(max(2010, year_min), year_max)
    else:
        construction_year = rng.randint(year_min, year_max)

    estimated_loss_dana = round(insured_value * risk_p * damage_ratio, 0)
    expected_annual_loss = round(estimated_loss_dana * PROB_EVENT_YEAR, 2)
    annual_premium = round(insured_value * _premium_factor(product) *
                            rng.uniform(0.8, 1.2), 0)

    start_min = date(2018, 1, 1).toordinal()
    start_max = date(2024, 9, 30).toordinal()
    policy_start = date.fromordinal(rng.randint(start_min, start_max)).isoformat()

    # Policy ID format: every policy shares the static "000001" segment
    # (Zurich-style branch/product code) and gets a random 5-char
    # alphanumeric suffix per record. The rng is seeded per portfolio
    # so the same seed → identical IDs across re-runs.
    # Numeric only: 5-digit random suffix appended directly to 000001
    # (no second dash). e.g. POL-00000142319.
    suffix = f"{rng.randint(0, 99999):05d}"

    return {
        "id": f"POL-000001{suffix}",
        "lat": round(float(row["lat"]), 5),
        "lon": round(float(row["lon"]), 5),
        # Producto + subtipo (nuevo eje)
        "product": product,
        "subtype": subtype,
        # Legacy type (back-compat con vistas existentes)
        "type": PRODUCT_LEGACY_TYPE[product],
        "insured_value": int(insured_value),
        "construction_year": construction_year,
        "floor_count": floor_count,
        "ground_floor": ground_floor,
        "policy_start": policy_start,
        "annual_premium": int(annual_premium),
        "risk_probability": round(risk_p, 4),
        "risk_category": category,
        "estimated_loss_dana": int(estimated_loss_dana),
        "expected_annual_loss": float(expected_annual_loss),
    }


def _build_portfolio(name: str, pid: str, description: str,
                      client_specs: list[dict], rng_seed: int,
                      lookup_df, lookup_tree, model,
                      prefix: str = "VLC", is_land=None,
                      lookup_indices: dict | None = None,
                      zone_weights: dict | None = None) -> dict:
    rng = _rng(rng_seed)
    clients = []
    for spec in client_specs:
        for _ in range(spec["count"]):
            c = _build_client(
                idx=len(clients) + 1,
                prefix=prefix, rng=rng,
                lookup_df=lookup_df, lookup_tree=lookup_tree,
                model=model,
                product=spec["product"],
                value_mean=spec["value_mean"],
                value_min=spec["value_min"],
                value_max=spec["value_max"],
                ground_floor_prob=spec.get("ground_floor_prob", 0.40),
                year_min=spec.get("year_min", 1970),
                year_max=spec.get("year_max", 2020),
                centers=spec.get("centers", VALENCIA_CITY_CENTERS),
                location_mode=spec.get("location_mode", "weighted"),
                bbox=spec.get("bbox"),
                bboxes=spec.get("bboxes"),
                lookup_indices=lookup_indices,
                zone_weights=zone_weights,
                is_land=is_land,
            )
            clients.append(c)
    total_value = sum(c["insured_value"] for c in clients)
    return {
        "id": pid,
        "name": name,
        "description": description,
        "n_clients": len(clients),
        "total_insured_value": total_value,
        "clients": clients,
    }


def main() -> int:
    log.info("=" * 60)
    log.info("Generando 3 carteras predefinidas (productos: particulares|pymes|autos)")
    log.info("=" * 60)

    val_lookup_path = DATA_DIR / "valencia_features_lookup.parquet"
    alg_lookup_path = DATA_DIR / "algemesi_features_lookup.parquet"
    if not val_lookup_path.exists():
        log.error("Falta %s. Ejecuta tools/02 primero.", val_lookup_path)
        return 1
    if not MODEL_PATH.exists():
        log.error("Falta %s.", MODEL_PATH)
        return 1

    # Cargar ambos lookups y concatenar — un único cKDTree para que un
    # cliente sampleado en cualquier punto del bbox combinado encuentre la
    # celda más cercana de su zona correspondiente. La columna `zone` se
    # añade para debugging/inspección, pero el modelo no la usa.
    log.info("Cargando lookup Valencia...")
    df_val = pd.read_parquet(val_lookup_path)
    df_val["zone"] = "valencia"
    log.info("  %d filas Valencia", len(df_val))

    if alg_lookup_path.exists():
        log.info("Cargando lookup Algemesí...")
        df_alg = pd.read_parquet(alg_lookup_path)
        df_alg["zone"] = "algemesi"
        log.info("  %d filas Algemesí", len(df_alg))
        df = pd.concat([df_val, df_alg], ignore_index=True)
    else:
        log.warning("No hay lookup de Algemesí — solo Valencia")
        df = df_val

    log.info("  %d filas combinadas", len(df))
    coords = df[["lat", "lon"]].to_numpy(dtype="float32")
    tree = cKDTree(coords)

    # Pre-computar índices del lookup_df por zona, filtrados a la
    # superficie de riesgo VISIBLE (el risk_geojson, no el bbox del
    # lookup). El lookup cubre todo el grid SAR — incluyendo mar y
    # zonas sin clasificar — pero el risk_geojson solo contiene los
    # píxeles agrupados en bins de probabilidad (terreno modelado). Sin
    # este filtro las pólizas terminaban en píxeles del mar / huerta
    # donde no hay color visible y daba la impresión de bug.
    log.info("Filtrando lookup a superficie de riesgo visible...")
    zone_to_geojson = {
        "valencia": DATA_DIR / "valencia_risk.geojson",
        "algemesi": DATA_DIR / "algemesi_risk.geojson",
    }
    lookup_indices = _filter_lookup_to_risk_surface(df, zone_to_geojson)
    # Pesos por zona = # filas válidas (refleja área cubierta por el
    # modelo Y por la superficie visible).
    zone_weights = {z: float(len(ix)) for z, ix in lookup_indices.items()}
    log.info("Cargando modelo Random Forest v2...")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = joblib.load(MODEL_PATH)

    # Land mask — usamos los 16 municipios DANA como máscara para que el
    # sampling uniforme no caiga en el Mediterráneo / la Albufera ni en
    # zonas montañosas sin lookup features (lo que producía pólizas
    # flotantes sobre el mar en la versión anterior).
    munis_path = DATA_DIR / "municipalities.geojson"
    if munis_path.exists():
        log.info("Cargando máscara de tierra (municipios DANA)...")
        is_land = _load_land_mask(munis_path)
    else:
        log.warning("No hay municipalities.geojson — sampling sin máscara")
        is_land = None

    # Bboxes (formato (lon_min, lat_min, lon_max, lat_max)). Estos son los
    # bounds REALES de la unión de polígonos municipales — no los del config
    # (que son aproximaciones rectangulares generosas que cubren mar /
    # montaña sin lookup features). Combinados con el land_mask, garantizan
    # que cada póliza cae sobre la superficie de riesgo modelada.
    #   Valencia : union(14 municipios L'Horta DANA-afectados)
    #   Algemesí : union(Algemesí + Alzira)
    valencia_bbox = (-0.617, 39.301, -0.330, 39.525)
    algemesi_bbox = (-0.648, 39.069, -0.304, 39.248)
    study_bboxes = [valencia_bbox, algemesi_bbox]

    # ---- PORTFOLIO 1: Premium Residential -----------------------
    # 100% particulares high-end. Mantiene el id histórico.
    p1 = _build_portfolio(
        name="Premium Residential Valencia",
        pid="premium_residential",
        description=(
            "200 viviendas premium en Valencia ciudad, Paiporta, Catarroja "
            "y Torrent. Producto unico: particulares (piso · casa · chalet)."
        ),
        client_specs=[
            {"count": 200, "product": "particulares",
             "value_mean": 350_000, "value_min": 150_000, "value_max": 1_200_000,
             "ground_floor_prob": 0.60, "year_min": 1960, "year_max": 2020,
             "centers": VALENCIA_CITY_CENTERS, "location_mode": "weighted"},
        ],
        rng_seed=42, lookup_df=df, lookup_tree=tree, model=model, prefix="VLC",
        is_land=is_land,
    )

    # ---- PORTFOLIO 2: Wide Distribution Mix ---------------------
    # 50% particulares · 30% autos · 20% pymes — el portfolio "comercial demo".
    # Distribuido sobre AMBAS zonas de estudio (Valencia + Algemesí); el
    # land mask se encarga de mantener todo dentro de los 16 municipios
    # DANA-afectados y de Algemesí/Alzira.
    p2 = _build_portfolio(
        name="Wide Distribution Mix",
        pid="wide_distribution",
        description=(
            "1.000 polizas distribuidas en las dos zonas de estudio "
            "(Valencia metropolitana + Ribera Alta del Júcar). "
            "50% particulares · 30% autos · 20% pymes. "
            "Mix realista para un underwriter generalista."
        ),
        client_specs=[
            {"count": 500, "product": "particulares",
             "value_mean": 180_000, "value_min": 50_000, "value_max": 1_500_000,
             "ground_floor_prob": 0.45, "year_min": 1970, "year_max": 2020,
             "location_mode": "lookup"},
            {"count": 300, "product": "autos",
             "value_mean": 22_000, "value_min": 15_000, "value_max": 60_000,
             "ground_floor_prob": 1.0, "year_min": 2015, "year_max": 2024,
             "location_mode": "lookup"},
            {"count": 200, "product": "pymes",
             "value_mean": 280_000, "value_min": 80_000, "value_max": 2_000_000,
             "ground_floor_prob": 0.70, "year_min": 1970, "year_max": 2020,
             "location_mode": "lookup"},
        ],
        rng_seed=43, lookup_df=df, lookup_tree=tree, model=model, prefix="MIX",
        is_land=is_land,
        lookup_indices=lookup_indices, zone_weights=zone_weights,
    )

    # ---- PORTFOLIO 3: Industrial Focus → Pymes Industrial -------
    # 80% pymes · 20% autos (flotas comerciales aparcadas en los poligonos).
    p3 = _build_portfolio(
        name="Industrial Focus",
        pid="industrial_focus",
        description=(
            "60 polizas pyme + 15 flotas comerciales en los poligonos "
            "industriales de Sedavi, Manises y Quart de Poblet."
        ),
        client_specs=[
            {"count": 60, "product": "pymes",
             "value_mean": 1_200_000, "value_min": 400_000, "value_max": 5_000_000,
             "ground_floor_prob": 1.0, "year_min": 1980, "year_max": 2015,
             "centers": INDUSTRIAL_ZONES, "location_mode": "weighted"},
            {"count": 15, "product": "autos",
             "value_mean": 35_000, "value_min": 20_000, "value_max": 60_000,
             "ground_floor_prob": 1.0, "year_min": 2015, "year_max": 2024,
             "centers": INDUSTRIAL_ZONES, "location_mode": "weighted"},
        ],
        rng_seed=44, lookup_df=df, lookup_tree=tree, model=model, prefix="IND",
        is_land=is_land,
    )

    payload = {
        "portfolios": [p1, p2, p3],
        "_meta": {
            "damage_ratios": {
                "_".join(map(str, k)): v for k, v in DAMAGE_RATIOS.items()
            },
            "prob_event_year": PROB_EVENT_YEAR,
            "threshold_operational": THRESHOLD_OPERATIONAL,
            "model": "Random Forest v2",
            "annual_premium_formula": (
                "insured_value * (0.04 if product=='autos' else 0.0015) "
                "* U(0.8, 1.2)"
            ),
            "expected_annual_loss_formula": "estimated_loss_dana * prob_event_year",
            "estimated_loss_dana_formula": "insured_value * risk_probability * damage_ratio",
            "products": ["particulares", "pymes", "autos"],
            "subtypes_per_product": {
                "particulares": ["piso_alto", "piso_bajo", "casa", "chalet"],
                "pymes":        ["comercio", "oficina", "nave"],
                "autos":        ["coche", "moto", "furgoneta"],
            },
            "notes": (
                "Carteras sinteticas con fines didacticos. Las primas y "
                "ratios son aproximaciones razonables, no reales. El campo "
                "`type` se mantiene como alias legacy para back-compat: "
                "particulares→residential, pymes→commercial, autos→auto."
            ),
        },
    }

    out_path = DATA_DIR / "predefined_portfolios.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)

    size_kb = out_path.stat().st_size / 1024
    log.info("=" * 60)
    log.info("Resumen carteras")
    for p in payload["portfolios"]:
        by_prod = {}
        for c in p["clients"]:
            by_prod[c["product"]] = by_prod.get(c["product"], 0) + 1
        breakdown = " · ".join(f"{k}={v}" for k, v in sorted(by_prod.items()))
        log.info("  %-30s n=%4d  total=%12d EUR  (%s)",
                 p["name"], p["n_clients"], p["total_insured_value"], breakdown)
    log.info("Output: %s (%.1f KB)", out_path.name, size_kb)
    log.info("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
