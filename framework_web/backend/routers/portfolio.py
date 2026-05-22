"""Endpoints /api/portfolios/*"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..schemas.portfolio import (
    CustomPortfolioRequest, Portfolio, PortfolioExposure, PortfolioListResponse,
)
from ..services.portfolio_generator import (
    compute_exposure, generate_custom_portfolio, get_portfolio_store,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


@router.get("/predefined", response_model=PortfolioListResponse,
             summary="Listado ligero de las 3 carteras predefinidas")
def list_predefined_portfolios() -> PortfolioListResponse:
    store = get_portfolio_store()
    items = store.list_predefined()
    if not items:
        raise HTTPException(503, "Predefined portfolios no cargados")
    return PortfolioListResponse(portfolios=items)


@router.post("/custom", response_model=Portfolio,
              summary="Genera una cartera custom on-the-fly")
def create_custom_portfolio(req: CustomPortfolioRequest) -> Portfolio:
    if req.value_range[0] >= req.value_range[1]:
        raise HTTPException(400, "value_range debe ser [min, max] con min < max")
    try:
        portfolio = generate_custom_portfolio(
            n_clients=req.n_clients,
            value_range=tuple(req.value_range),
            type_distribution=req.type_distribution,
            geographic_focus=req.geographic_focus,
            seed=req.seed,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    store = get_portfolio_store()
    store.store_custom(portfolio)
    return portfolio


@router.get("/{portfolio_id}", response_model=Portfolio,
             summary="Cartera completa con todos los clientes")
def get_portfolio(portfolio_id: str) -> Portfolio:
    store = get_portfolio_store()
    p = store.get_portfolio(portfolio_id)
    if p is None:
        raise HTTPException(404, f"Portfolio '{portfolio_id}' no encontrado")
    return p


@router.get("/{portfolio_id}/exposure", response_model=PortfolioExposure,
             summary="KPIs de exposicion agregados de la cartera")
def get_portfolio_exposure(portfolio_id: str) -> PortfolioExposure:
    store = get_portfolio_store()
    p = store.get_portfolio(portfolio_id)
    if p is None:
        raise HTTPException(404, f"Portfolio '{portfolio_id}' no encontrado")
    return compute_exposure(p, threshold=settings.THRESHOLD_OPERATIONAL)
