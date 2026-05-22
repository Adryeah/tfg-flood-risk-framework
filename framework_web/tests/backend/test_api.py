"""Tests de los 8 endpoints del backend.

Usa TestClient de FastAPI sobre la app real (lifespan = startup completo).
Requiere que tools/01-05 hayan generado los datos en data_processed/ y
que models/random_forest_v2.joblib exista.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Permite ejecutar pytest desde cualquier cwd anadiendo framework_web/
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert "endpoints" in body
    assert len(body["endpoints"]) == 8


def test_health_endpoint(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert "valencia" in body["lookup_zones"]


def test_get_valencia_geojson(client):
    r = client.get("/api/risk/valencia.geojson")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert "features" in body
    assert len(body["features"]) > 0


def test_get_algemesi_geojson(client):
    r = client.get("/api/risk/algemesi.geojson")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) > 0


def test_predict_risk_valid_coord(client):
    # Paiporta
    r = client.get("/api/risk/predict",
                    params={"lat": 39.4276, "lon": -0.4153})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["zone"] == "valencia"
    assert 0.0 <= body["probability"] <= 1.0
    assert body["category"] in ("low", "moderate", "high", "very_high")
    assert "features" in body
    assert len(body["features"]) == 14


def test_predict_risk_invalid_coord(client):
    # Madrid (fuera de bbox)
    r = client.get("/api/risk/predict",
                    params={"lat": 40.4168, "lon": -3.7038})
    assert r.status_code == 404


def test_predict_risk_invalid_lat(client):
    r = client.get("/api/risk/predict", params={"lat": 100.0, "lon": 0})
    assert r.status_code == 422


def test_get_predefined_portfolios(client):
    r = client.get("/api/portfolios/predefined")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "portfolios" in body
    assert len(body["portfolios"]) == 3
    ids = {p["id"] for p in body["portfolios"]}
    assert ids == {"premium_residential", "wide_distribution",
                   "industrial_focus"}


def test_get_portfolio_detail(client):
    r = client.get("/api/portfolios/premium_residential")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == "premium_residential"
    assert body["n_clients"] == 200
    assert len(body["clients"]) == 200
    c0 = body["clients"][0]
    expected_keys = {
        "id", "lat", "lon", "type", "subtype", "insured_value",
        "construction_year", "floor_count", "ground_floor",
        "policy_start", "annual_premium", "risk_probability",
        "risk_category", "estimated_loss_dana", "expected_annual_loss",
    }
    assert expected_keys.issubset(c0.keys())


def test_get_portfolio_not_found(client):
    r = client.get("/api/portfolios/does-not-exist")
    assert r.status_code == 404


def test_post_custom_portfolio(client):
    body = {
        "n_clients": 30,
        "value_range": [100000, 500000],
        "type_distribution": {"residential": 0.7, "commercial": 0.3},
        "geographic_focus": "valencia",
        "seed": 123,
    }
    r = client.post("/api/portfolios/custom", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["id"].startswith("custom-")
    assert 1 <= out["n_clients"] <= 30
    # Verificar que la cartera se cachea
    r2 = client.get(f"/api/portfolios/{out['id']}")
    assert r2.status_code == 200
    assert r2.json()["id"] == out["id"]


def test_get_portfolio_exposure(client):
    r = client.get("/api/portfolios/premium_residential/exposure")
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["portfolio_id"] == "premium_residential"
    assert e["n_clients"] == 200
    assert e["total_insured_value"] > 0
    assert "distribution_by_category" in e
    assert "distribution_by_type" in e


def test_get_metrics_valencia(client):
    r = client.get("/api/metrics/valencia")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "model_metrics" in body
    assert "buffer_metrics" in body
    assert "feature_importance" in body
    auc = body["model_metrics"]["auc_mean"]
    assert 0.90 <= auc <= 0.94


def test_get_metrics_algemesi(client):
    r = client.get("/api/metrics/algemesi")
    assert r.status_code == 200
    body = r.json()
    assert "model_metrics" in body
    auc = body["model_metrics"]["auc_mean"]
    assert 0.78 <= auc <= 0.85


def test_get_metrics_transferability(client):
    r = client.get("/api/metrics/transferability")
    assert r.status_code == 200
    body = r.json()
    assert "feature_drift" in body


def test_get_metrics_leakage(client):
    r = client.get("/api/metrics/leakage")
    assert r.status_code == 200
    body = r.json()
    assert "test1_urban_mask" in body
    assert "test2_temporal_leakage" in body


def test_get_metrics_invalid_section(client):
    r = client.get("/api/metrics/invalid_section")
    assert r.status_code == 422   # Literal validation


def test_get_methodology_leakage(client):
    r = client.get("/api/methodology/leakage_audit")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "narrative" in body
    assert "tables" in body
    assert "winter_features_diff" in body["tables"]
    assert any(
        row["feature"] == "winter_min_sigma0_vv"
        for row in body["tables"]["winter_features_diff"]
    )
    assert "code_references" in body
    assert body["code_references"]["bug_location"].endswith(
        "extract_advanced_features_v3.py:162"
    )
