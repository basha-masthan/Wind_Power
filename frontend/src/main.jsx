import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, RefreshCw, Wind } from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || '';
const DELIVERY_DATES = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
const CUTOFFS = ['08:00', '09:00', '10:00', '11:00', '12:00'];
const number = (value, digits = 0) => value == null
  ? '—'
  : new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
const clock = value => value
  ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  : '—';
const longDate = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const previousDate = value => new Date(new Date(`${value}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

function ProfileChart({ rows }) {
  const width = 960, height = 260, pad = { left: 55, right: 20, top: 18, bottom: 34 };
  const plotRows = rows.filter(row => row.forecast != null || row.actual != null);
  if (!plotRows.length) return <div className="chart-empty">No generation data is available for this date.</div>;
  const highest = Math.max(...plotRows.flatMap(row => [row.forecast, row.actual]).filter(value => value != null), 0);
  const ceiling = Math.ceil(highest / 5000) * 5000 || 5000;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = index => pad.left + index * plotWidth / Math.max(plotRows.length - 1, 1);
  const y = value => pad.top + plotHeight - value * plotHeight / ceiling;
  const pathFor = field => {
    let penDown = false;
    return plotRows.map((row, index) => {
      if (row[field] == null) { penDown = false; return ''; }
      const command = penDown ? 'L' : 'M';
      penDown = true;
      return `${command}${x(index)},${y(row[field])}`;
    }).filter(Boolean).join(' ');
  };
  const labels = [0, 12, 24, 36, 47].filter(index => index < plotRows.length);
  return (
    <div className="chart-frame">
      <div className="chart-legend">
        <span><i className="swatch forecast-swatch"/> Decision-time forecast</span>
        <span><i className="swatch actual-swatch"/> Wind generation actual</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hourly wind forecast compared with half-hourly wind generation">
        {[0, .25, .5, .75, 1].map(fraction => {
          const value = ceiling * fraction;
          const yPos = pad.top + plotHeight - fraction * plotHeight;
          return <g key={fraction}>
            <line x1={pad.left} x2={width - pad.right} y1={yPos} y2={yPos} className="chart-grid"/>
            <text x={pad.left - 10} y={yPos + 4} textAnchor="end" className="chart-label">{number(value / 1000, 0)} GW</text>
          </g>;
        })}
        <path d={pathFor('forecast')} className="forecast-line"/>
        <path d={pathFor('actual')} className="actual-line"/>
        {labels.map(index => <text key={index} x={x(index)} y={height - 9}
          textAnchor={index === 0 ? 'start' : index === plotRows.length - 1 ? 'end' : 'middle'} className="chart-label">
          {clock(plotRows[index]?.startTime)}
        </text>)}
      </svg>
      <p className="chart-caption">The forecast is hourly. Each hourly value is shown against the two half-hour periods it covers.</p>
    </div>
  );
}

function App() {
  const [deliveryDate, setDeliveryDate] = useState('2026-01-25');
  const [cutoff, setCutoff] = useState('10:00');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(''); setData(null);
      try {
        const response = await fetch(`${API}/api/day/${deliveryDate}?cutoff=${cutoff}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || 'Elexon data could not be loaded.');
        setData(body);
      } catch (problem) {
        if (problem.name !== 'AbortError') { setData(null); setError(problem.message); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [deliveryDate, cutoff, refreshIndex]);

  const rows = data?.rows || [];
  const lastPublication = useMemo(() => rows.reduce((latest, row) => {
    if (!row.publishTime) return latest;
    return !latest || row.publishTime > latest ? row.publishTime : latest;
  }, null), [rows]);
  const peakForecast = rows.reduce((peak, row) => Math.max(peak, row.forecast ?? 0), 0);
  const exportData = () => {
    if (!data) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    link.download = `wind-review-${deliveryDate}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="page">
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Wind review home"><span className="mark"><Wind size={18}/></span> Power trading <span className="wordmark-divider">/</span> Renewables</a>
        <div className="masthead-right"><span>HISTORICAL REVIEW</span><span className="masthead-period">JANUARY 2026</span></div>
      </header>

      <section className="intro-block" id="top">
        <div className="section-label">DAY-AHEAD WIND · GREAT BRITAIN</div>
        <h1>What did the forecast say?</h1>
        <p>Review the wind forecast available before delivery, then compare it with the recorded generation.</p>
      </section>

      <section className="filters" aria-label="Review settings">
        <label className="filter-item"><span>Delivery date</span>
          <select value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)}>
            {DELIVERY_DATES.map(day => <option key={day} value={day}>{longDate(day)}</option>)}
          </select>
        </label>
        <label className="filter-item cutoff-select"><span>Forecast cut-off <em>working assumption</em></span>
          <select value={cutoff} onChange={event => setCutoff(event.target.value)}>
            {CUTOFFS.map(time => <option value={time} key={time}>{time} GMT · previous day</option>)}
          </select>
        </label>
        <button className="refresh-button" onClick={() => setRefreshIndex(value => value + 1)} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spinning' : ''}/><span>Refresh</span>
        </button>
        <button className="download-button" onClick={exportData} disabled={!data || loading}><Download size={15}/> Export data</button>
      </section>

      <div className="assumption-note"><span className="note-mark">i</span>
        <p>The assignment does not specify an exact market decision time. The selected cut-off is an assumption for this prototype; adjust it to match the desk’s process.</p>
      </div>
      {error && <div className="error-message" role="alert"><strong>Could not load source data.</strong> {error}</div>}

      <section className="summary-row" aria-label="Forecast summary">
        <div className="summary-main">
          <span className="summary-label">SELECTED DAY</span>
          <h2>{longDate(deliveryDate)}</h2>
          <p>Snapshot at {cutoff} GMT on {longDate(previousDate(deliveryDate))}</p>
        </div>
        <div className="summary-stat"><span>Peak wind forecast</span><strong>{loading ? '…' : data && rows.some(row => row.forecast != null) ? <>{number(peakForecast / 1000, 1)} <small>GW</small></> : '—'}</strong></div>
        <div className="summary-stat"><span>Mean absolute error</span><strong>{loading ? '…' : data?.metrics?.mae != null ? <>{number(data.metrics.mae)} <small>MW</small></> : '—'}</strong></div>
        <div className="summary-stat"><span>Mean signed error · actual − forecast</span><strong className="signed-value">{loading ? '…' : data?.metrics?.bias != null ? <>{number(data.metrics.bias)} <small>MW</small></> : '—'}</strong></div>
      </section>

      <section className="content-panel">
        <div className="panel-header">
          <div><div className="section-label">FORECAST AND OUTTURN</div><h2>Generation through the day</h2></div>
          <div className="publication"><span>Latest included forecast publication</span><strong>{loading ? 'Loading' : lastPublication ? `${new Date(lastPublication).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })} · ${clock(lastPublication)} GMT` : 'No forecast found'}</strong></div>
        </div>
        {loading ? <div className="loading-message">Retrieving Elexon records…</div> : <ProfileChart rows={rows}/>}
      </section>

      <section className="content-panel table-panel">
        <div className="panel-header table-title">
          <div><div className="section-label">SETTLEMENT DETAIL</div><h2>Half-hourly actuals and forecast</h2></div>
          <span className="table-unit">MW · Error = actual − forecast</span>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Period starts (GMT)</th><th>Forecast available at cut-off</th><th>Actual wind generation</th><th>Error</th><th>Forecast published</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${row.startTime}-${index}`}>
            <td>{clock(row.startTime)}</td><td>{number(row.forecast)}</td><td>{number(row.actual)}</td>
            <td className={row.error == null ? 'no-error' : row.error > 0 ? 'error-positive' : 'error-negative'}>{row.error == null ? '—' : `${row.error > 0 ? '+' : ''}${number(row.error)}`}</td>
            <td>{row.publishTime ? `${clock(row.publishTime)} GMT` : '—'}</td>
          </tr>)}</tbody>
        </table>
        {!loading && !rows.length && <div className="table-empty">No data returned for this date and cut-off.</div>}</div>
      </section>

      <aside className="scope-note"><strong>Scope</strong><p>This review covers wind generation forecasts and actuals only. It does not calculate consumer demand or a procurement recommendation.</p></aside>
      <footer className="page-footer"><span>Source: Elexon BMRS · WINDFOR and FUELHH</span><span>{data?.metrics?.matchedPeriods ?? '—'} periods with both forecast and actual data</span></footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
