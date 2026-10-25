import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Rating } from "../types";
import { useI18n } from "../i18n";
import { VITALS_STRINGS } from "./strings";
import { TrendChart, formatValue, rateValue } from "./charts";
import { Button, Card, Icon, Notice, Spinner, cx, inputClass } from "../ui";

/*
 * Weekly tracking: saved pages, each with the last 15 weeks of real-visitor
 * LCP, INP and CLS on phones and computers (Chrome UX Report history).
 * A chart per metric, then a week-by-week table like a tracking spreadsheet.
 */

type Metric = "lcp" | "inp" | "cls";
const METRICS: Metric[] = ["lcp", "inp", "cls"];
type DeviceWeeks = Record<Metric, (number | null)[]>;

interface WeeklyVitals {
  fetchedAt: string;
  scope: "page" | "origin" | null;
  periods: { from: string; to: string }[];
  mobile: DeviceWeeks | null;
  desktop: DeviceWeeks | null;
}
interface TrackedPage { url: string; requestedUrl?: string; addedAt: string; vitals: WeeklyVitals }

const muted = "text-slate-500 dark:text-slate-400";
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const CELL: Record<Rating, string> = {
  good: "bg-emerald-100 text-emerald-950 dark:bg-emerald-500/25 dark:text-emerald-50",
  "needs-improvement": "bg-amber-100 text-amber-950 dark:bg-amber-500/25 dark:text-amber-50",
  poor: "bg-red-100 text-red-950 dark:bg-red-500/25 dark:text-red-50"
};
const DOT: Record<Rating, string> = { good: "var(--status-good)", "needs-improvement": "var(--status-warning)", poor: "var(--status-poor)" };

/** Table number in the column's unit: LCP in seconds, INP in ms, CLS as a score. */
const tableValue = (m: Metric, v: number) => (m === "lcp" ? (v / 1000).toFixed(2) : m === "cls" ? v.toFixed(2) : String(Math.round(v)));
const lastValue = (values: (number | null)[] | undefined) => {
  if (!values) return null;
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
};

function useStrings() {
  const { lang } = useI18n();
  return { s: VITALS_STRINGS[lang], locale: lang === "el" ? "el-GR" : "en-GB" };
}

export default function TrackingView({ configured }: { configured: boolean | null }) {
  const { s } = useStrings();
  const t = s.track;
  const [pages, setPages] = useState<TrackedPage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorText = (body: { code?: string; error?: string }) => {
    const code = body.code as keyof typeof t.errors | undefined;
    if (code && typeof t.errors[code] === "string") return t.errors[code] as string;
    return t.errors.google(body.error ?? "");
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tracked-pages");
      const body = await res.json();
      setPages(body.pages ?? []);
      setSelected(cur => cur ?? body.pages?.[0]?.url ?? null);
    } catch {
      setPages([]);
      setError(t.errors.server);
    }
  }, [t.errors.server]);

  useEffect(() => { load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/tracked-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.page) {
        setSelected(body.page.url);
        setError(t.errors.EEXISTS);
        return;
      }
      if (!res.ok) { setError(errorText(body)); return; }
      setPages(list => [...(list ?? []), body.page]);
      setSelected(body.page.url);
      setUrl("");
    } catch {
      setError(t.errors.server);
    } finally {
      setAdding(false);
    }
  };

  const replace = (page: TrackedPage) => setPages(list => (list ?? []).map(p => (p.url === page.url ? page : p)));
  const removed = (gone: string) => {
    setPages(list => {
      const next = (list ?? []).filter(p => p.url !== gone);
      setSelected(next[0]?.url ?? null);
      return next;
    });
  };

  const current = pages?.find(p => p.url === selected) ?? null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      {/* saved pages */}
      <section className="min-w-0 lg:sticky lg:top-20">
        <h2 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{t.pages}</h2>
        <form onSubmit={add} className="mt-3">
          <label htmlFor="track-url" className="sr-only">{t.addLabel}</label>
          <div className="flex gap-2">
            <input id="track-url" type="text" inputMode="url" required value={url} disabled={adding || !configured}
              onChange={e => setUrl(e.target.value)} placeholder="https://www.magentainsurance.gr/car" className={cx(inputClass, "min-w-0")} />
            <Button type="submit" variant="primary" icon={adding ? undefined : "plus"} disabled={adding || !configured || !url.trim()} aria-label={t.add} title={t.add}>
              {adding ? <Spinner className="h-4 w-4 text-white" /> : <span className="hidden sm:inline lg:hidden">{t.add}</span>}
            </Button>
          </div>
          {adding && <p className={`mt-2 text-xs ${muted}`} aria-live="polite">{t.adding}</p>}
        </form>
        {error && <Notice tone="warning" className="mt-3">{error}</Notice>}

        {pages === null ? (
          <div className="mt-6 flex justify-center"><Spinner className="h-5 w-5" /></div>
        ) : pages.length === 0 ? (
          <p className={`mt-5 text-sm ${muted}`}>{t.empty}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {pages.map(p => {
              const active = p.url === selected;
              return (
                <li key={p.url}>
                  <button type="button" onClick={() => setSelected(p.url)} aria-current={active ? "true" : undefined}
                    className={cx("relative block w-full px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50",
                      active ? "bg-brand-50/70 dark:bg-brand-500/10" : "hover:bg-slate-100/60 dark:hover:bg-slate-900")}>
                    {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand-500" />}
                    <span className="block truncate font-mono text-[13px] text-slate-900 dark:text-slate-100" title={p.url}>{shortUrl(p.url)}</span>
                    <LatestChips page={p} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* the selected page */}
      <section className="min-w-0">
        {current
          ? <PageWeeks key={current.url} page={current} onUpdated={replace} onRemoved={removed} />
          : pages && pages.length > 0 && <p className={`text-sm ${muted}`}>{t.pick}</p>}
      </section>
    </div>
  );
}

/** The latest phone week for each metric, as small coloured chips under a saved page. */
function LatestChips({ page }: { page: TrackedPage }) {
  const { s } = useStrings();
  const weeks = page.vitals.mobile ?? page.vitals.desktop;
  if (!weeks) return <span className={`mt-1 block text-xs ${muted}`}>{s.track.na}</span>;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5" aria-label={s.track.latest}>
      {METRICS.map(m => {
        const v = lastValue(weeks[m]);
        const r = rateValue(m, v);
        return (
          <span key={m} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            title={r ? `${m.toUpperCase()} ${formatValue(m, v)}: ${s.rating[r]}` : `${m.toUpperCase()}: ${s.track.na}`}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: r ? DOT[r] : "var(--sev-failed)" }} />
            {m.toUpperCase()}
            <span className="sr-only">{r ? `${formatValue(m, v)}, ${s.rating[r]}` : s.track.na}</span>
          </span>
        );
      })}
    </span>
  );
}

function PageWeeks({ page, onUpdated, onRemoved }: { page: TrackedPage; onUpdated: (p: TrackedPage) => void; onRemoved: (url: string) => void }) {
  const { s, locale } = useStrings();
  const t = s.track;
  const v = page.vitals;
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ddmm = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
  // A week is the last 7 days of each 28-day window.
  const weekOf = useMemo(() => Object.fromEntries(v.periods.map(p => {
    const start = new Date(Date.parse(p.to + "T00:00:00Z") - 6 * 864e5).toISOString().slice(0, 10);
    return [p.to, t.week(ddmm(start), ddmm(p.to))];
  })), [v.periods, locale]);  // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/tracked-pages/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.code === "ENOKEY" ? t.errors.ENOKEY : t.errors.google(body.error ?? `HTTP ${res.status}`));
      else onUpdated(body.page);
    } catch {
      setError(t.errors.server);
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async () => {
    const res = await fetch(`/api/tracked-pages?url=${encodeURIComponent(page.url)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) onRemoved(page.url);
    else setError(t.errors.server);
    setConfirming(false);
  };

  const devices = ([["mobile", s.mobile, "var(--series-mobile)"], ["desktop", s.desktop, "var(--series-desktop)"]] as const)
    .filter(([key]) => v[key]);
  const periods = v.periods.map(p => p.to);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-display-soft flex items-center gap-2 break-all text-2xl font-semibold text-slate-900 dark:text-white">
            {shortUrl(page.url)}
            <a href={page.url} target="_blank" rel="noopener noreferrer" aria-label={page.url} className="shrink-0 text-slate-400 hover:text-brand-600">
              <Icon name="external" className="h-4 w-4" />
            </a>
          </h2>
          <p className={`mt-1 text-sm ${muted}`}>
            {t.updated(new Date(v.fetchedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!confirming ? (
            <>
              <Button size="sm" icon={refreshing ? undefined : "refresh"} onClick={refresh} disabled={refreshing}>
                {refreshing ? <><Spinner className="h-3.5 w-3.5" />{t.refreshing}</> : t.refresh}
              </Button>
              <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => setConfirming(true)} disabled={refreshing}>{t.remove}</Button>
            </>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{t.removeConfirm}</span>
              <Button size="sm" variant="danger" onClick={remove}>{t.remove}</Button>
              <Button size="sm" onClick={() => setConfirming(false)}>{t.cancel}</Button>
            </span>
          )}
        </div>
      </div>

      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      {page.requestedUrl && <Notice tone="info" className="mt-4">{t.redirected(shortUrl(page.requestedUrl))}</Notice>}
      {v.scope === "origin" && <Notice tone="warning" className="mt-4">{t.originScope}</Notice>}

      {v.scope === null || !devices.length ? (
        <p className={`mt-6 text-sm ${muted}`}>{t.noData}</p>
      ) : (
        <>
          <h3 className="font-display-soft mt-8 text-xl font-semibold text-slate-900 dark:text-white">{t.chartsTitle}</h3>
          <p className={`mt-1 max-w-[70ch] text-sm ${muted}`}>{t.chartsNote}</p>
          {devices.length < 2 && (
            <p className={`mt-1 text-sm ${muted}`}>{t.deviceGap(v.mobile ? s.desktop : s.mobile)}</p>
          )}

          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300" aria-label={t.zonesLabel}>
            {(["good", "needs-improvement", "poor"] as Rating[]).map(r => (
              <li key={r} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-3 rounded-[3px]" style={{ background: DOT[r], opacity: 0.55 }} />{s.rating[r]}
              </li>
            ))}
          </ul>

          <div className="mt-6 space-y-10">
            {METRICS.map(m => (
              <figure key={m} className="m-0 min-w-0">
                <figcaption className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{t.names[m]}</figcaption>
                <TrendChart metricId={m} periods={periods} locale={locale} zones hideTable height={210}
                  formatPeriod={(iso) => weekOf[iso] ?? iso} formatTick={ddmm}
                  series={devices.map(([key, label, color]) => ({ key, label, color, values: v[key]![m] }))}
                  labels={{ good: s.rating.good, poor: s.rating.poor, week: t.weekCol, showTable: s.showTable }} />
              </figure>
            ))}
          </div>

          <WeekTable vitals={v} weekOf={weekOf} />
        </>
      )}
    </div>
  );
}

/** The spreadsheet view: one row per week, desktop then mobile, each cell coloured by Google's rating. */
function WeekTable({ vitals, weekOf }: { vitals: WeeklyVitals; weekOf: Record<string, string> }) {
  const { s } = useStrings();
  const t = s.track;
  const groups = ([["desktop", s.desktop], ["mobile", s.mobile]] as const);

  return (
    <>
      <h3 className="font-display-soft mt-10 text-xl font-semibold text-slate-900 dark:text-white">{t.tableTitle}</h3>
      {/* relative: keeps the cells' screen-reader labels inside this scroll box on narrow screens */}
      <div className="relative mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[40rem] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="bg-slate-100/70 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <th rowSpan={2} scope="col" className="border-b border-slate-200 px-3 py-2 text-left font-semibold dark:border-slate-800">{t.weekCol}</th>
              {groups.map(([key, label]) => (
                <th key={key} colSpan={3} scope="colgroup" className="border-b border-l border-slate-200 px-3 py-1.5 text-center font-semibold dark:border-slate-800">{label}</th>
              ))}
            </tr>
            <tr className="bg-slate-100/70 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              {groups.flatMap(([key]) => METRICS.map((m, i) => (
                <th key={key + m} scope="col" className={cx("border-b border-slate-200 px-3 py-1.5 text-right font-medium dark:border-slate-800", i === 0 && "border-l")}>
                  {m.toUpperCase()}{t.units[m] && <span className="font-normal"> ({t.units[m]})</span>}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {vitals.periods.map((p, row) => (
              <tr key={p.to} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal text-slate-700 dark:text-slate-300">{weekOf[p.to]}</th>
                {groups.flatMap(([key]) => METRICS.map((m, i) => {
                  const value = vitals[key]?.[m][row] ?? null;
                  const rating = rateValue(m, value);
                  return (
                    <td key={key + m} className={cx("px-3 py-1.5 text-right", i === 0 && "border-l border-slate-200 dark:border-slate-800",
                      rating ? CELL[rating] : "text-slate-400 dark:text-slate-500")}>
                      {value === null ? t.na : tableValue(m, value)}
                      {rating && <span className="sr-only">, {s.rating[rating]}</span>}
                    </td>
                  );
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
