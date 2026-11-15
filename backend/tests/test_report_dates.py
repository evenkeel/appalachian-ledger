import pytest
from conftest import post


@pytest.mark.parametrize("month", ["0001-01", "1969-12", "2026-1", "2026-01-extra", "bad"])
def test_report_routes_reject_unsupported_or_noncanonical_months(owner, month):
    for route in ("reports", "dominance", "tracking", "budgets", "budget-overview"):
        response = owner.get(f"/api/{route}", params={"month": month})
        assert response.status_code == 422, (route, month, response.text)


def test_history_stops_at_first_supported_month(owner):
    post(
        owner,
        "/accounts",
        {
            "name": "Old cash",
            "kind": "cash",
            "currency": "USD",
            "opening_balance": "100",
            "date": "1970-01-01",
        },
    )
    response = owner.get("/api/reports?month=1970-01&months=120")
    assert response.status_code == 200
    assert [row["month"] for row in response.json()["history"]] == ["1970-01"]
    assert owner.post("/api/budgets/copy-previous", json={"month": "1970-01"}).status_code == 422
