import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, AlertTriangle, Clock, PackageCheck, TrendingDown, ArrowUp, ArrowDown, RotateCcw, Loader2, Undo2 } from "lucide-react";
import {
  getCutReco, fetchCutReco, refreshCutReco, groupByProduct, buildRuns, summarize,
  applySent, loadSent, saveSent, sendRowToCut, cutRecoLive,
  type CutRecoRow, type SentMap,
} from "../lib/cutReco";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

type CutModal = { row: CutRecoRow; qty: number };

export const CutRecoTable = () => {
  const qc = useQueryClient();
  const { data = getCutReco(), refetch, isFetching } = useQuery({
    queryKey: ["cutReco"],
    queryFn: fetchCutReco,
    // Вбудований знімок — лише щоб було що показати в першу мить. Позначаємо його
    // застарілим (updatedAt = 0), інакше staleTime тримав би статичний JSON 5 хв
    // і живі дані з n8n не тягнулись би до ручного «Оновити».
    initialData: getCutReco(),
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  async function onRefresh() {
    setRefreshing(true);
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    try { await refreshCutReco(); await refetch(); }
    catch (e) { console.error("[cutReco] refresh failed", e); }
    finally { clearInterval(t); setRefreshing(false); }
  }
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // --- Уже кинуте в розкрій із цього знімка (локально, до наступного перерахунку) ---
  const [sent, setSent] = useState<SentMap>(() => loadSent(data.generatedAt));
  // Новий знімок може бути старшим за відмітку (його порахували до кліку) — тоді
  // відмітка лишається, інакше позиція повернулась би в таблицю.
  useEffect(() => { setSent(loadSent(data.generatedAt)); }, [data.generatedAt]);
  const sentTotal = useMemo(() => Object.values(sent).reduce((s, e) => s + e.qty, 0), [sent]);
  const resetSent = () => { setSent({}); saveSent({}); };

  // Усі похідні розрахунки — на скоригованих даних, тому позиція одразу зменшується/зникає.
  const view = useMemo(() => applySent(data, sent), [data, sent]);

  const [cutModal, setCutModal] = useState<CutModal | null>(null);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const openCut = (row: CutRecoRow) => {
    setSendErr(null);
    setCutModal({ row, qty: row.deficit > 0 ? row.deficit : (row.box || 1) });
  };

  async function confirmCut() {
    if (!cutModal) return;
    const { row, qty } = cutModal;
    setSending(true);
    setSendErr(null);
    try {
      await sendRowToCut(row, qty);
      setSent((prev) => {
        const next: SentMap = { ...prev, [row.sku]: { qty: (prev[row.sku]?.qty || 0) + qty, at: new Date().toISOString() } };
        saveSent(next);
        return next;
      });
      setCutModal(null);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["orders"] }), 3000);
    } catch (e) {
      console.error("[cutReco] send to cut failed", e);
      setSendErr("Не вдалося створити задачу — перевір зв'язок і спробуй ще раз.");
    } finally {
      setSending(false);
    }
  }

  const groups = useMemo(() => groupByProduct(view), [view]);
  const kpi = useMemo(() => summarize(view), [view]);
  const [onlyProblem, setOnlyProblem] = useState(true);
  const [pivotSort, setPivotSort] = useState<{ key: "name" | "total"; dir: "asc" | "desc" }>({ key: "total", dir: "desc" });
  const togglePivotSort = (key: "name" | "total") =>
    setPivotSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  // Перехресна матриця «лише проблемні»: рядки = виріб+колір, колонки = розміри, тільки дефіцитні клітинки.
  const problemMatrix = useMemo(() => {
    const pr = view.rows.filter((r) => r.deficit > 0);
    const sizes = view.sizeOrder.filter((s) => pr.some((r) => r.size === s));
    const map = new Map<string, { key: string; label: string; cells: Map<string, CutRecoRow>; total: number; worst: string }>();
    for (const r of pr) {
      const key = `${r.productKey}|${r.colorKey}`;
      let g = map.get(key);
      if (!g) { g = { key, label: `${r.product} — ${r.color}`, cells: new Map(), total: 0, worst: "yellow" }; map.set(key, g); }
      g.cells.set(r.size, r); g.total += r.deficit; if (r.status === "red") g.worst = "red";
    }
    return { sizes, list: [...map.values()] };
  }, [view]);

  const sortedProblem = useMemo(() => {
    const dir = pivotSort.dir === "asc" ? 1 : -1;
    return [...problemMatrix.list].sort((a, b) =>
      pivotSort.key === "name" ? a.label.localeCompare(b.label, "uk") * dir : (a.total - b.total) * dir);
  }, [problemMatrix, pivotSort]);

  const PivotSortIcon = ({ k }: { k: "name" | "total" }) =>
    pivotSort.key !== k ? null : pivotSort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;

  const seasonal = useMemo(() => {
    const rows = view.rows.filter((r) => r.driver === "seasonal");
    if (!rows.length) return null;
    return {
      skus: rows.length,
      products: [...new Set(rows.map((r) => r.product))],
      minCover: Math.min(...rows.map((r) => r.coverDays)),
      deficit: rows.reduce((s, r) => s + r.deficit, 0),
    };
  }, [view]);

  return (
    <div className="analytics-section cutreco-section">
      {refreshing && (
        <div className="cutreco-overlay">
          <Loader2 size={34} className="cutreco-spin" />
          <div className="cutreco-overlay-title">Перераховую рекомендації… {mmss}</div>
          <div className="cutreco-overlay-sub">
            Тягну склад, продажі за 30 днів і торішній сезон із KeyCRM. Зазвичай ~2–2.5 хв — не закривай вкладку.
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 className="analytics-title">
          <Scissors size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          Рекомендований крій на склад
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>знімок {fmtDate(data.generatedAt)} · {kpi.skuCount} SKU</span>
          {!cutRecoLive.get && (
            <span className="cutreco-offline-badge" title="VITE_N8N_CUTRECO_GET не заданий у цьому білді — показано вбудований знімок, не живі дані">
              офлайн-знімок
            </span>
          )}
          <button
            className="btn mini ghost"
            onClick={onRefresh}
            disabled={refreshing || isFetching || !cutRecoLive.refresh}
            title={cutRecoLive.refresh ? "Перерахувати зараз (n8n)" : "Перерахунок недоступний: у цьому білді не заданий VITE_N8N_CUTRECO_REFRESH"}
          >
            {refreshing ? <Loader2 size={14} className="cutreco-spin" /> : <RotateCcw size={14} />}
            <span className="btn-label">{refreshing ? "Оновлюю…" : "Оновити"}</span>
          </button>
        </div>
      </div>
      <p className="analytics-subtitle">
        DDMRP (echelon): ціль {view.horizons.target} дн · пора кроїти &lt;{view.horizons.reorder} дн ·
        терміново &lt;{view.horizons.red} дн. Покриття = весь ланцюг (готове + шиється + крій + розкрій) ÷ денний продаж.
      </p>

      {/* --- KPI --- */}
      <div className="cutreco-kpis">
        <div className="cutreco-kpi cutreco-kpi--red"><AlertTriangle size={18} /><span className="cutreco-kpi-val">{kpi.red}</span><span className="cutreco-kpi-lbl">Терміново (&lt;10 дн)</span></div>
        <div className="cutreco-kpi cutreco-kpi--yellow"><Clock size={18} /><span className="cutreco-kpi-val">{kpi.yellow}</span><span className="cutreco-kpi-lbl">Пора кроїти</span></div>
        <div className="cutreco-kpi cutreco-kpi--green"><PackageCheck size={18} /><span className="cutreco-kpi-val">{kpi.green}</span><span className="cutreco-kpi-lbl">Достатньо</span></div>
        <div className="cutreco-kpi"><TrendingDown size={18} /><span className="cutreco-kpi-val">{kpi.totalDeficit}</span><span className="cutreco-kpi-lbl">Дефіцит, шт</span></div>
      </div>

      {seasonal && (
        <div className="cutreco-seasonal-note">
          🍂 <b>Зимова підготовка активна</b> — {seasonal.skus} SKU ({seasonal.products.join(", ")}) під форвард-наглядом
          за торішнім сезоном (+ріст, погляд на {view.lookahead ?? 60} дн уперед).{" "}
          {seasonal.deficit > 0
            ? <>Уже треба готувати <b>{seasonal.deficit} шт</b> зимового.</>
            : <>Запасу поки вистачає (мін. покриття <b>{seasonal.minCover} дн</b> за зимовим темпом) — крій увімкнеться, щойно просяде.</>}
        </div>
      )}

      {/* --- Світлофор по товарах --- */}
      <div className="cutreco-h3-row">
        <h3 className="cutreco-h3">{onlyProblem ? "Що кроїти — усі вироби" : "Буфер по товарах"}</h3>
        <div className="cutreco-h3-tools">
          {sentTotal > 0 && (
            <span className="cutreco-sent-badge" title="Ці позиції вже мають задачу «В РОЗКРОЇ». Лічильник скинеться сам після наступного перерахунку.">
              ↘ кинуто в розкрій: {sentTotal} шт
              <button className="btn mini ghost" onClick={resetSent} title="Повернути позиції в таблицю (задачі в роботі не видаляються)">
                <Undo2 size={13} /><span className="btn-label">показати</span>
              </button>
            </span>
          )}
          <label className="cutreco-toggle">
            <input type="checkbox" checked={onlyProblem} onChange={(e) => setOnlyProblem(e.target.checked)} />
            лише проблемні
          </label>
        </div>
      </div>

      {onlyProblem ? (
        problemMatrix.list.length === 0 ? (
          <p className="muted">Немає позицій, що потребують крою — усе зелене. 🎉</p>
        ) : (
          <div className="matrix-scroll">
            <table className="matrix-table cutreco-table">
              <thead>
                <tr>
                  <th className="matrix-header matrix-header--label matrix-header--sortable" onClick={() => togglePivotSort("name")}>
                    <span className="matrix-header-inner">Виріб — колір <PivotSortIcon k="name" /></span>
                  </th>
                  {problemMatrix.sizes.map((s) => <th key={s} className="matrix-header">{s}</th>)}
                  <th className="matrix-header matrix-header--total matrix-header--sortable" onClick={() => togglePivotSort("total")}>
                    <span className="matrix-header-inner matrix-header-inner--center">Σ <PivotSortIcon k="total" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProblem.map((row) => (
                  <tr key={row.key}>
                    <td className="matrix-label">
                      <span className="matrix-label-name">{row.label}</span>
                    </td>
                    {problemMatrix.sizes.map((s) => {
                      const r = row.cells.get(s);
                      if (!r || r.deficit <= 0) return <td key={s} className="matrix-cell matrix-cell--empty" />;
                      const seasonalCell = r.driver === "seasonal";
                      return (
                        <td key={s} className={`matrix-cell cutreco-cell cutreco-cell--${r.status} cutreco-cell--click`}
                          role="button" tabIndex={0}
                          onClick={() => openCut(r)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCut(r); } }}
                          title={`${row.label} · ${s} · вистачить на ${r.coverDays} дн · ланцюг ${r.position} шт · темп ${r.adu}/дн${seasonalCell ? " (зимовий, форвард)" : ""}\nКлік — кинути в розкрій`}>
                          {seasonalCell && <span className="cutreco-season-mark" title="сезонна підготовка">🍂</span>}
                          <span className="cutreco-deficit">+{r.deficit}</span>
                          <span className="cutreco-cover">{r.coverDays}дн</span>
                        </td>
                      );
                    })}
                    <td className="matrix-total-col">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : groups.map((g) => {
        const cell = new Map<string, CutRecoRow>();
        for (const r of g.rows) cell.set(`${r.color}|${r.size}`, r);
        const runsForRatio = buildRuns(g, view);
        const isSeasonal = g.rows.some((r) => r.driver === "seasonal");
        return (
          <div key={g.productKey} className="cutreco-product">
            <div className="cutreco-product-head">
              <span className="cutreco-product-name">{g.product}</span>
              {isSeasonal && <span className="cutreco-season-badge" title="Сезонний товар — потреба рахується за торішнім сезоном (форвард)">🍂 сезонний</span>}
              <span className={`cutreco-dot cutreco-dot--${g.status}`} />
              <span className="muted">мін. покриття {g.worstCover} дн{isSeasonal ? " (зимовий темп)" : ""}</span>
              {runsForRatio.length > 0 && (
                <span className="muted cutreco-product-runs">
                  · заходи: {runsForRatio.map((r) => `${r.template} ${r.total}${r.viable ? "✅" : "⏳"}`).join(" · ")}
                </span>
              )}
            </div>
            <div className="matrix-scroll">
              <table className="matrix-table cutreco-table">
                <thead>
                  <tr>
                    <th className="matrix-header matrix-header--label">Розмір</th>
                    {g.colors.map((c) => <th key={c} className="matrix-header">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.sizeOrder.map((size) => {
                    if (!g.rows.some((r) => r.size === size)) return null;
                    return (
                      <tr key={size}>
                        <td className="matrix-label"><span className="matrix-label-name">{size}</span></td>
                        {g.colors.map((color) => {
                          const r = cell.get(`${color}|${size}`);
                          if (!r) return <td key={color} className="matrix-cell matrix-cell--empty" />;
                          const seasonalCell = r.driver === "seasonal";
                          const title = seasonalCell
                            ? `${color} ${size} · вистачить на ${r.coverDays} дн (зимовий темп ${r.adu}/дн) · сезонна підготовка: торік ~${r.aduForward}/дн ×ріст, поточний темп ${r.aduTrailing}/дн · ланцюг ${r.position} шт`
                            : `${color} ${size} · вистачить на ${r.coverDays} дн · ланцюг ${r.position} шт · продаж ${r.adu}/дн`;
                          return (
                            <td key={color} className={`matrix-cell cutreco-cell cutreco-cell--${r.status} cutreco-cell--click`}
                              role="button" tabIndex={0}
                              onClick={() => openCut(r)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCut(r); } }}
                              title={`${title}\nКлік — кинути в розкрій`}>
                              {seasonalCell && <span className="cutreco-season-mark" title="сезонна підготовка">🍂</span>}
                              {r.deficit > 0 ? <span className="cutreco-deficit">+{r.deficit}</span> : <span className="cutreco-ok">✓</span>}
                              <span className="cutreco-cover">{r.coverDays}дн</span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="cutreco-legend">
        <span><i className="cutreco-dot cutreco-dot--red" /> терміново &lt;{view.horizons.red} дн</span>
        <span><i className="cutreco-dot cutreco-dot--yellow" /> пора кроїти &lt;{view.horizons.reorder} дн</span>
        <span><i className="cutreco-dot cutreco-dot--green" /> достатньо</span>
        <span>🍂 сезонна підготовка (темп із торішнього сезону +ріст)</span>
        <span className="muted">+N = докроїти · Nдн = на скільки вистачить · клік по клітинці — у розкрій</span>
      </div>

      {cutModal && (() => {
        const { row, qty } = cutModal;
        const box = row.box && row.box > 0 ? row.box : 0;
        return (
          <div className="modal-overlay" onClick={() => !sending && setCutModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">В розкрій — {row.product} · {row.color} · {row.size}</div>
              <div className="cutreco-modal-sku">{row.sku} · {row.template}</div>
              <div className="modal-field">
                <label>Кількість у розкрій (шт)</label>
                <input
                  type="number"
                  min={1}
                  autoFocus
                  value={qty}
                  onChange={(e) => setCutModal((m) => m && { ...m, qty: Math.max(1, Number(e.target.value) || 1) })}
                />
                <div className="cutreco-modal-chips">
                  {row.deficit > 0 && (
                    <button type="button" className="cutreco-chip-btn" onClick={() => setCutModal((m) => m && { ...m, qty: row.deficit })}>
                      увесь дефіцит {row.deficit}
                    </button>
                  )}
                  {row.deficit > 1 && (
                    <button type="button" className="cutreco-chip-btn" onClick={() => setCutModal((m) => m && { ...m, qty: Math.ceil(row.deficit / 2) })}>
                      половина {Math.ceil(row.deficit / 2)}
                    </button>
                  )}
                  {box > 0 && (
                    <button type="button" className="cutreco-chip-btn" onClick={() => setCutModal((m) => m && { ...m, qty: Math.max(box, Math.round(m.qty / box) * box) })}>
                      округлити до ящика ({box})
                    </button>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 12, marginTop: 6, display: "block" }}>
                  Дефіцит {row.deficit} шт · покриття {row.coverDays} дн · ланцюг {row.position} шт · темп {row.adu}/дн
                  {box > 0 && <> · ≈{Math.round(qty / box)} ящ.</>}
                </span>
              </div>
              {sendErr && <div className="cutreco-modal-err">{sendErr}</div>}
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setCutModal(null)} disabled={sending}>Скасувати</button>
                <button className="btn primary" onClick={confirmCut} disabled={sending || qty < 1}>
                  {sending ? <><Loader2 size={14} className="cutreco-spin" /> Створюю…</> : "У розкрій"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
