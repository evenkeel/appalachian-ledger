"""Local scenario persistence and read-only planning APIs."""

import json
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import func, select
from .auth import authenticate
from .db import get_db
from .schemas import StrictModel
from .models import PlanningScenario, now
from .forecasting import ForecastInput, project, earliest_retirement
from .reports import accounts_report, add_nullable, flow
from .accounting import audit, current_rate, active_transactions


def non_negative(value):
    """The forecast accepts only non-negative starting amounts (an overdrawn account starts at zero)."""
    return "0.00" if value is not None and str(value).startswith("-") else value


router = APIRouter(prefix="/api/planning", dependencies=[Depends(authenticate)])


class ScenarioInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    assumptions: ForecastInput

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Give the scenario a name")
        return value.strip()


class CompareInput(StrictModel):
    ids: list[int] = Field(min_length=1, max_length=4)


def scenario_dict(row):
    return {
        "id": row.id,
        "name": row.name,
        "version": row.version,
        "assumptions": json.loads(row.assumptions),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def scenario(db, id):
    row = db.get(PlanningScenario, id)
    if not row:
        raise HTTPException(404, "Scenario not found")
    if row.version != 1:
        raise ValueError("This scenario uses an unsupported planning version")
    return row


@router.post("/project")
def projection(data: ForecastInput):
    return project(data)


@router.post("/earliest-retirement")
def earliest(data: ForecastInput):
    return earliest_retirement(data)


@router.get("/starting-position")
def starting_position(db=Depends(get_db, scope="function")):
    today = date.today()
    accounts = accounts_report(db)
    selected = [a for a in accounts if not a["archived"]]
    previous_end = today.replace(day=1) - timedelta(days=1)
    previous_start = previous_end.replace(day=1)
    activity = flow(db, previous_start, previous_end, "USD")
    rate = current_rate(db)
    return {
        "as_of": today.isoformat(),
        "bitcoin": add_nullable(a["balance"] for a in selected if a["holding_type"] == "bitcoin"),
        "cash_usd": non_negative(add_nullable(a["usd"] for a in selected if a["holding_type"] == "dollars")),
        "other_assets_usd": add_nullable(a["usd"] for a in selected if a["holding_type"] == "valued_asset"),
        "liabilities_usd": non_negative(add_nullable(a["usd"] for a in selected if a["holding_type"] == "debt")),
        "price_usd": rate.usd_per_btc if rate else None,
        "rate_source": rate.source if rate else None,
        "rate_day": rate.day if rate else None,
        "previous_month": previous_start.strftime("%Y-%m"),
        "previous_month_spending_usd": activity["expenses"],
        "previous_month_income_usd": activity["income"],
        "previous_month_entries": len(active_transactions(db, previous_start, previous_end)),
    }


@router.get("/scenarios")
def list_scenarios(db=Depends(get_db, scope="function")):
    return [scenario_dict(row) for row in db.scalars(select(PlanningScenario).order_by(PlanningScenario.id))]


@router.post("/scenarios")
def create_scenario(data: ScenarioInput, db=Depends(get_db, scope="function")):
    if db.scalar(select(func.count()).select_from(PlanningScenario)) >= 40:
        raise ValueError("Keep at most 40 saved scenarios; delete an unused scenario first")
    project(data.assumptions)  # Reject an uncomputable scenario before saving it.
    row = PlanningScenario(name=data.name, assumptions=data.assumptions.model_dump_json(), version=1)
    db.add(row)
    db.flush()
    audit(db, "planning.create", row.id, {"name": row.name})
    return scenario_dict(row)


@router.put("/scenarios/{id}")
def update_scenario(id: int, data: ScenarioInput, db=Depends(get_db, scope="function")):
    row = scenario(db, id)
    project(data.assumptions)
    row.name, row.assumptions, row.updated_at = data.name, data.assumptions.model_dump_json(), now()
    audit(db, "planning.update", row.id, {"name": row.name})
    return scenario_dict(row)


@router.delete("/scenarios/{id}")
def delete_scenario(id: int, db=Depends(get_db, scope="function")):
    row = scenario(db, id)
    db.delete(row)
    audit(db, "planning.delete", id, {})
    return {"ok": True}


@router.post("/compare")
def compare(data: CompareInput, db=Depends(get_db, scope="function")):
    return [
        {"id": row.id, "name": row.name, "result": project(ForecastInput.model_validate_json(row.assumptions))}
        for row in (scenario(db, id) for id in dict.fromkeys(data.ids))
    ]
