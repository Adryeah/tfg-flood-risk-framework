"""Generador de carteras custom + cache de portfolios servidos.

Las carteras predefinidas ya estan generadas como JSON estatico por
tools/05_generate_predefined_portfolios.py. Este servicio:
  - Carga las predefinidas en memoria al iniciar.
  - Genera carteras custom on-the-fly via generate_custom_portfolio().
  - Mantiene cache in-memory de carteras custom (UUID -> portfolio).
"""
from __future__ import annotations

import json
import logging
import random
import threading
import uuid
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .feature_extractor import FeatureExtractor, categorize_probability
from .model_service import FEATURE_NAMES_V2, ModelService

log = logging.getLogger(__name__)


DAMAGE_RATIOS = {
    "residential_apartment_upper_floor": 0.05,
    "residential_apartment_ground_floor": 0.25,
    "residential_house_ground_floor":    0.30,
    "commercial":                        0.35,
    "industrial":                        0.40,
}
PROB_EVENT_YEAR = 0.05

VALENCIA_BBOX = (-0.55, 39.30, -0.25, 39.55)
ALGEMESI_BBOX = (-0.698, 39.007, -0.166, 39.365)


class PortfolioStore:
    _instance: Optional["PortfolioStore"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._predefined: Dict[str, dict] = {}
        self._predefined_meta: dict = {}
        self._custom_cache: Dict[str, dict] = {}

    @classmethod
    def get_instance(cls) -> "PortfolioStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = PortfolioStore()
        return cls._instance

    def load_predefined(self, data_dir: Path) -> None:
        path = data_dir / "predefined_portfolios.json"
        if not path.exists():
            log.warning("predefined_portfolios.json no existe en %s", data_dir)
            return
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        for p in payload.get("portfolios", []):
            self._predefined[p["id"]] = p
        self._predefined_meta = payload.get("_meta", {})
        log.info("Predefined portfolios cargados: %d",
                 len(self._predefined))

    def list_predefined(self) -> List[dict]:
        out = []
        for p in self._predefined.values():
            out.append({
                "id": p["id"],
                "name": p["name"],
                "description": p["description"],
                "n_clients": p["n_clients"],
                "total_insured_value": p["total_insured_value"],
            })
        return out

    def get_portfolio(self, portfolio_id: str) -> Optional[dict]:
        if portfolio_id in self._predefined:
            return self._predefined[portfolio_id]
        if portfolio_id in self._custom_cache:
            return self._custom_cache[portfolio_id]
        return None

    def store_custom(self, portfolio: dict) -> str:
        pid = portfolio["id"]
        self._custom_cache[pid] = portfolio
        return pid


def get_portfolio_store() -> PortfolioStore:
    return PortfolioStore.get_instance()


# -----------------------------------------------------------------------------
# Generacion custom
# -----------------------------------------------------------------------------

def _sample_lognormal(rng: random.Random, mean_value: float,
                      vmin: float, vmax: float) -> float:
    sigma = 0.5
    mu = np.log(mean_value) - 0.5 * sigma ** 2
    for _ in range(100):
        v = float(np.exp(rng.gauss(mu, sigma)))
        if vmin <= v <= vmax:
            return v
    return float(min(max(mean_value, vmin), vmax))


def _classify_subtype(rng: random.Random, ctype: str,
                       ground_floor_prob: float = 0.45):
    if ctype == "residential":
        if rng.random() < 0.20:
            return "house", True, rng.randint(1, 3)
        ground = rng.random() < ground_floor_prob
        floors = rng.choice([3, 4, 5, 6, 7, 8])
        return "apartment", ground, floors
    if ctype == "commercial":
        return "shop", True, rng.randint(1, 3)
    return "warehouse", True, 1


def _damage_ratio_for(ctype: str, subtype: str, ground_floor: bool) -> float:
    if ctype == "industrial":
        return DAMAGE_RATIOS["industrial"]
    if ctype == "commercial":
        return DAMAGE_RATIOS["commercial"]
    if subtype == "house":
        return DAMAGE_RATIOS["residential_house_ground_floor"]
    if subtype == "apartment" and ground_floor:
        return DAMAGE_RATIOS["residential_apartment_ground_floor"]
    return DAMAGE_RATIOS["residential_apartment_upper_floor"]


def generate_custom_portfolio(
    n_clients: int,
    value_range: tuple[int, int],
    type_distribution: Dict[str, float],
    geographic_focus: str = "valencia",
    seed: Optional[int] = None,
) -> dict:
    """Genera una cartera custom y la devuelve con UUID."""
    rng = random.Random(seed if seed is not None else random.randint(0, 1 << 31))

    # Normalizar distribution
    total = sum(type_distribution.values())
    if total <= 0:
        raise ValueError("type_distribution con suma <= 0")
    norm = {k: v / total for k, v in type_distribution.items()}
    types = list(norm.keys())
    weights = [norm[t] for t in types]

    bbox = VALENCIA_BBOX if geographic_focus == "valencia" \
        else ALGEMESI_BBOX
    if geographic_focus == "both":
        bbox = (-0.698, 39.007, -0.166, 39.555)

    extractor = FeatureExtractor.get_instance()
    model = ModelService.get_instance()

    value_min, value_max = value_range
    value_mean = (value_min + value_max) / 2.5  # log-normal mean approx

    clients: List[dict] = []
    attempts = 0
    while len(clients) < n_clients and attempts < n_clients * 5:
        attempts += 1
        lat = rng.uniform(bbox[1], bbox[3])
        lon = rng.uniform(bbox[0], bbox[2])
        feats = extractor.get_features_at(lat, lon, max_distance_m=300.0)
        if feats is None:
            continue
        ctype = rng.choices(types, weights=weights, k=1)[0]
        subtype, ground_floor, floor_count = _classify_subtype(rng, ctype)
        insured = round(_sample_lognormal(rng, value_mean,
                                            value_min, value_max), 0)
        # predict
        x = np.array([feats["features"][f] for f in FEATURE_NAMES_V2],
                     dtype="float32")
        risk_p = model.predict(x)
        category = categorize_probability(risk_p)
        damage_ratio = _damage_ratio_for(ctype, subtype, ground_floor)
        loss_dana = round(insured * risk_p * damage_ratio, 0)
        annual_premium = round(insured * 0.0015 * rng.uniform(0.8, 1.2), 0)
        eal = round(loss_dana * PROB_EVENT_YEAR, 2)
        construction = rng.randint(1960, 2024)
        from datetime import timedelta
        d_start = date(2018, 1, 1)
        d_end = date(2024, 9, 30)
        delta_days = (d_end - d_start).days
        policy_start = (d_start + timedelta(
            days=rng.randint(0, delta_days))).isoformat()

        clients.append({
            "id": f"POL-CUSTOM-{len(clients) + 1:05d}",
            "lat": round(feats["nearest_lat"], 5),
            "lon": round(feats["nearest_lon"], 5),
            "type": ctype,
            "subtype": subtype,
            "insured_value": int(insured),
            "construction_year": construction,
            "floor_count": floor_count,
            "ground_floor": ground_floor,
            "policy_start": policy_start,
            "annual_premium": int(annual_premium),
            "risk_probability": round(risk_p, 4),
            "risk_category": category,
            "estimated_loss_dana": int(loss_dana),
            "expected_annual_loss": float(eal),
        })

    portfolio_id = f"custom-{uuid.uuid4().hex[:12]}"
    return {
        "id": portfolio_id,
        "name": "Custom Portfolio",
        "description": (
            f"Custom portfolio: n={n_clients}, "
            f"focus={geographic_focus}, "
            f"value_range={value_range}, "
            f"type_dist={norm}"
        ),
        "n_clients": len(clients),
        "total_insured_value": int(sum(c["insured_value"] for c in clients)),
        "clients": clients,
    }


# -----------------------------------------------------------------------------
# Calculo de exposure
# -----------------------------------------------------------------------------

def compute_exposure(portfolio: dict, threshold: float = 0.614) -> dict:
    clients = portfolio.get("clients", [])
    n = len(clients)
    if n == 0:
        return {
            "portfolio_id": portfolio.get("id", "unknown"),
            "n_clients": 0,
            "total_insured_value": 0,
            "value_at_risk": 0,
            "exposure_high_risk": 0,
            "expected_total_loss": 0.0,
            "estimated_total_loss_dana": 0,
            "distribution_by_category": {},
            "distribution_by_type": {},
            "avg_risk_probability": 0.0,
            "threshold_used": threshold,
        }

    total_value = sum(c["insured_value"] for c in clients)
    value_at_risk = sum(
        c["insured_value"] for c in clients
        if c["risk_probability"] >= threshold
    )
    high_risk_n = sum(
        1 for c in clients
        if c["risk_category"] in ("high", "very_high")
    )
    expected_loss = sum(c["expected_annual_loss"] for c in clients)
    loss_dana = sum(c["estimated_loss_dana"] for c in clients)

    by_category: Dict[str, int] = {}
    by_type: Dict[str, int] = {}
    by_product: Dict[str, int] = {}
    by_subtype: Dict[str, int] = {}
    for c in clients:
        by_category[c["risk_category"]] = by_category.get(c["risk_category"], 0) + 1
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
        # `product` y `subtype` solo existen tras la migracion C1+; defensive
        # fallback al `type` legacy si el cliente viene de un portfolio viejo.
        prod = c.get("product") or c.get("type", "unknown")
        sub = c.get("subtype", "unknown")
        by_product[prod] = by_product.get(prod, 0) + 1
        by_subtype[sub] = by_subtype.get(sub, 0) + 1
    avg_p = sum(c["risk_probability"] for c in clients) / n

    return {
        "portfolio_id": portfolio["id"],
        "n_clients": n,
        "total_insured_value": int(total_value),
        "value_at_risk": int(value_at_risk),
        "exposure_high_risk": int(high_risk_n),
        "expected_total_loss": round(float(expected_loss), 2),
        "estimated_total_loss_dana": int(loss_dana),
        "distribution_by_category": by_category,
        "distribution_by_type": by_type,
        "distribution_by_product": by_product,
        "distribution_by_subtype": by_subtype,
        "avg_risk_probability": round(avg_p, 4),
        "threshold_used": threshold,
    }
