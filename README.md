# Wind forecast review

A small React and Python application for reviewing Great Britain wind forecasts and actual generation for January 2026. It answers two questions from the assignment:

1. What wind forecast was available before the delivery day?
2. How far did the forecast differ from recorded wind generation?

This is an interview prototype, not a complete procurement system. It does not have consumer demand, the utility's own generation or contracts, market prices, or dispatch inputs, so it cannot calculate how much power the utility should buy.

## What the assignment is asking for

The team buys power in the day-ahead market. Wind generation is uncertain, so the team needs to see the forecast it could actually have used before delivery, and understand forecast error when reviewing its decisions. The scope supplied for the exercise is deliberately narrow: national wind actuals and forecasts from Elexon only, for decision dates in January 2026.

The most important product distinction is between a forecast's delivery time and its publication time. A forecast is eligible for a decision snapshot only if it was published by the selected cut-off. Using the final revised forecast after delivery would overstate what the team knew before buying.

## Client presentation

The app gives the desk a date-by-date view of the eligible wind forecast beside the actual wind generation, with the settlement-period differences and two summary measures. This helps the desk understand how the forecast performed and where wind output was higher or lower than expected.

The interface labels the decision cut-off as an assumption. The assignment says decisions happen one day ahead but does not give an exact clock time or the client's internal gate. The current default is 10:00 GMT on the previous day and can be changed in the app. The trading team should confirm the right time before using the results to review decisions.

The application describes forecast error, not procurement exposure. Actual consumer demand and portfolio positions are outside the data scope, so a wind forecast alone cannot tell the utility its residual requirement.

## Data handling and measures

- **Forecast source:** Elexon BMRS `WINDFOR`, retrieved by publication-time window. For the selected delivery date, the backend keeps the newest row for each forecast `startTime` published on or before the cut-off.
- **Actual source:** Elexon BMRS `FUELHH`, restricted to `fuelType = WIND`, then aligned to forecast periods by `startTime`.
- **Resolution:** Elexon describes WINDFOR as an hourly forecast and FUELHH as half-hourly generation. The prototype carries each hourly forecast value to the two half-hour settlement periods it covers so the user can compare it with FUELHH actuals. This mapping should be checked against the exact raw Elexon records before operational use.
- **Error:** actual minus forecast, in MW. Positive means actual wind was higher than forecast; negative means actual was lower.
- **MAE:** mean absolute error over periods with both forecast and actual. **Mean signed error:** average of the same signed differences. Missing pairs are excluded.
- The peak figure is the maximum selected forecast value during the date. It is not demand, a shortfall, or a suggested purchase quantity.

No sample readings are fabricated or persisted. The app requests historical records from Elexon when the user selects a date. Elexon documents its [public API](https://developer.data.elexon.co.uk/) and the [WINDFOR overview](https://bmrs.elexon.co.uk/wind-generation).

## Technical review

The React/Vite client requests `/api/day/{delivery_date}?cutoff=HH:MM`. FastAPI makes concurrent reads to the two Elexon stream endpoints, filters forecast rows by delivery `startTime` and publication cut-off, filters actuals to wind, joins the readings, and returns per-period rows and metrics. The Docker image builds the React bundle and serves it with FastAPI so the sample runs as one service.

The date range is intentionally restricted to January 2026. `Europe/London` is used for the local decision time, and the selected cut-off is converted to UTC before comparing publication times. The actuals query uses a publication-time window around the selected delivery date, then filters by `startTime`.

### Interviewer review: trade-offs and next checks

- The exact decision cut-off is not specified in the brief. It is exposed as a control rather than silently treated as settled market policy.
- WINDFOR is hourly while FUELHH is half-hourly. This prototype maps one hourly forecast to two settlement periods; validate that interpretation against the January 2026 raw records and the desk's preferred scoring method.
- MAE and signed error are useful overview measures, but the desk may also want error by time of day, forecast horizon, or weather regime. Those can be added after agreeing definitions.
- Historical API reads happen on each date selection. A larger or operational deployment should cache the raw responses, show data completeness and freshness, and handle upstream limits explicitly.
- Before operational use, inspect raw API responses, confirm that the chosen WINDFOR vintages and FUELHH actuals are complete, and agree whether evaluation should use final actuals or a named settlement-data revision.
- A proper procurement recommendation requires at least demand and the utility's available supply/contract position. Those inputs are intentionally excluded by the assignment.

## Run locally

```sh
docker compose up --build
```

Open <http://localhost:8000>. For separate development servers, run the backend from the repository root:

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Then run the client in another terminal:

```sh
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:8000` for the Vite client when using separate servers.

## Deployment

The root Dockerfile is prepared for a Heroku container deployment. With an authenticated Heroku CLI and an app created in the user's account:

```sh
heroku container:login
heroku create YOUR_APP_NAME
heroku container:push web -a YOUR_APP_NAME
heroku container:release web -a YOUR_APP_NAME
```

This workspace does not have a Heroku or Vercel CLI session, so the prototype has not been published to a public URL.

## AI assistance

AI tools were used to assist with domain research and initial application implementation. The Elexon field mapping, decision-time assumption, forecast-to-settlement alignment, and metrics should be reviewed against the source records and the client's process before operational use.
# Wind_Power
