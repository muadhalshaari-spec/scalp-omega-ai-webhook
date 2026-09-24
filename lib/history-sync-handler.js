import { ensureSyncStates, getSyncStates, updateSyncState, persistHistoryRows, storeConfigured } from '../lib/history-sync-store.js';
import { fetchHistoryBatch } from '../lib/history-source-adapters.js';

export const maxDuration = 60;

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function query(req, key) { return typeof req.query?.[key] === 'string' ? req.query[key] : null; }

async function syncOne(state, signal) {
  const target = Number(state.target_rows || 100000);
  const rawCursor = num(state.cursor_ms);
  const before = rawCursor && rawCursor > 0 ? rawCursor : null;
  const limit = Math.min(1000, Math.max(100, target - Number(state.stored_rows || 0)));
  if (Number(state.stored_rows || 0) >= target) {
    await updateSyncState({ source: state.source, instrument: state.instrument, timeframe: state.timeframe, status: 'COMPLETE', completed_at: state.completed_at || new Date().toISOString(), last_error: null });
    return { ...state, status: 'COMPLETE', batchRows: 0 };
  }
  try {
    const batch = await fetchHistoryBatch({ source: state.source, instrument: state.instrument, timeframe: state.timeframe, before, limit, signal });
    const rows = batch.rows || [];
    if (!rows.length || batch.nextCursorMs == null || batch.nextCursorMs === before) {
      const exhausted = Boolean(before && !rows.length);
      await updateSyncState({ source: state.source, instrument: state.instrument, timeframe: state.timeframe, status: Number(state.stored_rows || 0) >= target ? 'COMPLETE' : exhausted ? 'SOURCE_EXHAUSTED' : 'RETRY_PENDING', last_batch_rows: rows.length, last_error: rows.length ? null : 'SOURCE_RETURNED_NO_ROWS', cursor_ms: exhausted ? before : null, completed_at: Number(state.stored_rows || 0) >= target ? new Date().toISOString() : null });
      return { ...state, status: exhausted ? 'SOURCE_EXHAUSTED' : 'RETRY_PENDING', batchRows: rows.length };
    }
    const write = await persistHistoryRows(rows);
    const stored = Math.min(target, Number(state.stored_rows || 0) + rows.length);
    await updateSyncState({ source: state.source, instrument: state.instrument, timeframe: state.timeframe, target_rows: target, stored_rows: stored, cursor_ms: batch.nextCursorMs, status: stored >= target ? 'COMPLETE' : 'RUNNING', last_batch_rows: rows.length, last_error: null, last_run_at: new Date().toISOString(), completed_at: stored >= target ? new Date().toISOString() : null });
    return { source: state.source, instrument: state.instrument, timeframe: state.timeframe, status: stored >= target ? 'COMPLETE' : 'RUNNING', batchRows: rows.length, storedRows: stored, persistedRows: write.rows || rows.length, nextCursorMs: batch.nextCursorMs };
  } catch (error) {
    await updateSyncState({ source: state.source, instrument: state.instrument, timeframe: state.timeframe, status: 'ERROR', last_error: error?.message || String(error), last_run_at: new Date().toISOString() }).catch(() => null);
    return { source: state.source, instrument: state.instrument, timeframe: state.timeframe, status: 'ERROR', error: error?.message || String(error) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!storeConfigured()) return res.status(503).json({ ok: false, dataOnly: true, error: 'History store is not configured' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 52_000);
  try {
    await ensureSyncStates();
    const source = query(req, 'source')?.toUpperCase();
    const timeframe = query(req, 'timeframe');
    const requested = (await getSyncStates(100)).rows.filter((x) => (!source || x.source === source) && (!timeframe || x.timeframe === timeframe));
    const mode = query(req, 'mode') || (source || timeframe ? 'on_demand' : 'scheduled');
    const work = mode === 'on_demand' && (source || timeframe) ? requested.slice(0, 1) : requested.filter((x) => x.status !== 'COMPLETE').slice(0, 4);
    const results = [];
    for (const state of work) results.push(await syncOne(state, controller.signal));
    const states = (await getSyncStates(100)).rows;
    return res.status(200).json({ ok: true, dataOnly: true, decision: null, decisionAuthority: 'CHATGPT_CONVERSATIONAL_ONLY', mode, targetRowsPerSourceTimeframe: 100000, sources: [...new Set(states.map((x) => x.source))], timeframes: [...new Set(states.map((x) => x.timeframe))], processed: results, coverage: states.map((x) => ({ source: x.source, instrument: x.instrument, timeframe: x.timeframe, targetRows: x.target_rows, storedRows: x.stored_rows, status: x.status, lastBatchRows: x.last_batch_rows, cursorMs: x.cursor_ms, lastRunAt: x.last_run_at, lastError: x.last_error })), policy: 'DATA_COLLECTION_ONLY_NO_TRADING_DECISION' });
  } catch (error) {
    return res.status(502).json({ ok: false, dataOnly: true, decision: null, error: error?.name === 'AbortError' ? 'History batch timed out' : error?.message || String(error) });
  } finally { clearTimeout(timer); }
}
