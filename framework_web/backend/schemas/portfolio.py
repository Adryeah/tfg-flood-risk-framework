"""Schemas Pydantic para el endpoint /api/portfolios."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Client(BaseModel):
    id: str
    lat: float
    lon: float
    # ── Producto C1+ ────────────────────────────────────────────
    product: str = Field(
        default="particulares",
        description="particulares | pymes | autos",
    )
    subtype: str = Field(
        ...,
        description=(
            "particulares: piso_alto | piso_bajo | casa | chalet · "
            "pymes: comercio | oficina | nave · "
            "autos: coche | moto | furgoneta · "
            "(legacy: apartment | house | shop | warehouse)"
        ),
    )
    # ── Legacy type (back-compat con vistas anteriores) ─────────
    type: str = Field(..., description="residential | commercial | industrial | auto")
    insured_value: int = Field(..., ge=0)
    construction_year: int
    floor_count: int = Field(..., ge=0)
    ground_floor: bool
    policy_start: str = Field(..., description="ISO date YYYY-MM-DD")
    annual_premium: int = Field(..., ge=0)
    risk_probability: float = Field(..., ge=0.0, le=1.0)
    risk_category: str = Field(..., description="low | moderate | high | very_high")
    estimated_loss_dana: int = Field(..., ge=0)
    expected_annual_loss: float = Field(..., ge=0)


class Portfolio(BaseModel):
    id: str
    name: str
    description: str
    n_clients: int
    total_insured_value: int
    clients: List[Client]


class PortfolioListItem(BaseModel):
    """Version ligera (sin clients) para el listado."""
    id: str
    name: str
    description: str
    n_clients: int
    total_insured_value: int


class PortfolioListResponse(BaseModel):
    portfolios: List[PortfolioListItem]


class CustomPortfolioRequest(BaseModel):
    n_clients: int = Field(..., ge=1, le=10000)
    value_range: List[int] = Field(
        ...,
        min_length=2, max_length=2,
        description="[min, max] insured_value en EUR",
    )
    type_distribution: Dict[str, float] = Field(
        ...,
        description=(
            "Probabilidades por tipo. Claves: residential, commercial, "
            "industrial. La suma debe ser 1.0 (se normaliza si no)."
        ),
    )
    geographic_focus: Literal["valencia", "algemesi", "both"] = "valencia"
    seed: Optional[int] = None


class PortfolioExposure(BaseModel):
    portfolio_id: str
    n_clients: int
    total_insured_value: int
    value_at_risk: int = Field(..., description="Suma de insured_value de clientes con prob >= threshold")
    exposure_high_risk: int = Field(..., description="Numero clientes con risk_category high o very_high")
    expected_total_loss: float = Field(..., description="Suma de expected_annual_loss")
    estimated_total_loss_dana: int = Field(..., description="Suma de estimated_loss_dana")
    distribution_by_category: Dict[str, int] = Field(
        ...,
        description="Conteo de clientes por risk_category",
    )
    distribution_by_type: Dict[str, int] = Field(
        ...,
        description="Conteo de clientes por type (legacy)",
    )
    distribution_by_product: Dict[str, int] = Field(
        default_factory=dict,
        description="Conteo de clientes por product (particulares | pymes | autos)",
    )
    distribution_by_subtype: Dict[str, int] = Field(
        default_factory=dict,
        description="Conteo de clientes por subtype (piso_alto, comercio, coche, …)",
    )
    avg_risk_probability: float
    threshold_used: float
