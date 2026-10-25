from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
import asyncio
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

API = "https://data.elexon.co.uk/bmrs/api/v1"
UK = ZoneInfo("Europe/London")
app = FastAPI(title="Wind forecast review", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","), allow_methods=["*"], allow_headers=["*"])


async def fetch(client: httpx.AsyncClient, dataset: str, params: dict):
    response = await client.get(f"{API}/datasets/{dataset}/stream", params=params)
    response.raise_for_status()
    payload = response.json()
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def timestamp(row, key):
    value = row.get(key)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (AttributeError, ValueError):
        return None


@app.get("/api/health")
async def health():
    return {"status": "ok", "source": "Elexon BMRS", "period": "January 2026"}


@app.get("/api/day/{delivery_date}")
async def day_data(delivery_date: date, cutoff: str = Query("10:00", pattern=r"^\d{2}:\d{2}$")):
    if delivery_date.year != 2026 or delivery_date.month != 1:
        raise HTTPException(400, "Choose a delivery date in January 2026.")
    try:
        cutoff_time = time.fromisoformat(cutoff)
    except ValueError:
        raise HTTPException(400, "Cutoff must use HH:MM.")

    delivery_start = datetime.combine(delivery_date, time.min, UK)
    delivery_end = delivery_start + timedelta(days=1)
    decision_at = datetime.combine(delivery_date - timedelta(days=1), cutoff_time, UK)
    # Raw Elexon dataset windows filter publication time, not delivery start time.
    # The forecast request spans January vintages; actuals use a narrow publication
    # window around delivery and are then filtered by startTime below.
    pub_from = datetime(2025, 12, 31, tzinfo=timezone.utc).isoformat()
    pub_to = datetime(2026, 1, 31, 23, 59, tzinfo=timezone.utc).isoformat()
    start_utc = delivery_start.astimezone(timezone.utc)
    end_utc = delivery_end.astimezone(timezone.utc)

    async with httpx.AsyncClient(timeout=45) as client:
        try:
            forecasts, actuals = await asyncio.gather(
                fetch(client, "WINDFOR", {"publishDateTimeFrom": pub_from, "publishDateTimeTo": pub_to}),
                fetch(client, "FUELHH", {
                    "publishDateTimeFrom": (start_utc - timedelta(days=1)).isoformat(),
                    "publishDateTimeTo": (end_utc + timedelta(days=2)).isoformat(),
                }),
            )
        except httpx.HTTPStatusError as exc:
            raise HTTPException(502, f"Elexon returned {exc.response.status_code} for a source dataset.")
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, f"Could not retrieve Elexon data: {exc}")

    actual_by_start = {}
    for row in actuals:
        if str(row.get("fuelType", "")).upper() != "WIND":
            continue
        start = timestamp(row, "startTime")
        if start and start_utc <= start < end_utc:
            try:
                actual_by_start[start] = float(row["generation"])
            except (KeyError, TypeError, ValueError):
                pass

    forecast_by_start = {}
    for row in forecasts:
        start, published = timestamp(row, "startTime"), timestamp(row, "publishTime")
        if not start or not published or not (start_utc <= start < end_utc) or published > decision_at.astimezone(timezone.utc):
            continue
        try:
            generation = float(row["generation"])
        except (KeyError, TypeError, ValueError):
            continue
        if start not in forecast_by_start or published > forecast_by_start[start]["published"]:
            forecast_by_start[start] = {"published": published, "generation": generation}
        # In GB markets, hourly WINDFOR forecasts (:00) span both half-hourly settlement periods (:00 and :30)
        if start.minute == 0:
            sp2 = start + timedelta(minutes=30)
            if sp2 < end_utc:
                if sp2 not in forecast_by_start or published > forecast_by_start[sp2]["published"]:
                    forecast_by_start[sp2] = {"published": published, "generation": generation}

    rows = []
    for start in sorted(set(actual_by_start) | set(forecast_by_start)):
        forecast = forecast_by_start.get(start)
        actual = actual_by_start.get(start)
        rows.append({
            "startTime": start.isoformat(),
            "forecast": forecast["generation"] if forecast else None,
            "publishTime": forecast["published"].isoformat() if forecast else None,
            "actual": actual,
            "error": actual - forecast["generation"] if actual is not None and forecast else None,
        })

    paired = [row for row in rows if row["error"] is not None]
    mae = sum(abs(row["error"]) for row in paired) / len(paired) if paired else None
    bias = sum(row["error"] for row in paired) / len(paired) if paired else None
    latest_published = max((row["publishTime"] for row in rows if row["publishTime"]), default=None)
    return {
        "deliveryDate": delivery_date.isoformat(), "decisionTime": decision_at.isoformat(),
        "rows": rows, "metrics": {"mae": mae, "bias": bias, "matchedPeriods": len(paired), "periods": len(rows)},
        "latestPublishTime": latest_published,
        "sources": {"actual": "FUELHH · fuelType WIND", "forecast": "WINDFOR · latest vintage published by decision time"},
    }


frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
