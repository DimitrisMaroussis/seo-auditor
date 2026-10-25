import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FieldDevice, FieldScope, LabResult, Rating, ReportFile, VitalId, VitalsReport } from "../types";
import { useI18n, type Lang } from "../i18n";
import { VITALS_STRINGS } from "./strings";
import { METRIC_INFO } from "./metricInfo";
import TrackingView from "./TrackingView";
import { ADVICE } from "./advice";
import { Gauge, LIMITS, RatingPill, Sparkline, TrendChart, formatValue, rateValue } from "./charts";
import { Button, Card, Disclosure, Icon, LoadingCard, Notice, PageHeader, SectionTitle, Segmented, Spinner, cx, inputClass, reportLabel } from "../ui";

/*
 * Core Web Vitals page. Reading order, top to bottom:
 *   1. verdict: does the page pass Google's assessment on this device?
 *   2. the three vitals in plain language, each with a gauge and trend
 *   3. what to fix first (from Google's lab test, ranked by what needs work)
 *   4. details on demand: other metrics, history, lab test, how to read
 */

type Device = "mobile" | "desktop";
type Group = "lcp" | "inp" | "cls";
const CORE: Group[] = ["lcp", "inp", "cls"];

const hasCurrent = (scope: FieldScope | null) => Boolean(scope && (scope.mobile.current || scope.desktop.current));
const muted = "text-slate-500 dark:text-slate-400";

function useStrings() {
  const { lang } = useI18n();
  return { lang, s: VITALS_STRINGS[lang], locale: lang === "el" ? "el-GR" : "en-GB" };
}

// ====================================================================
// Page: run form, progress, saved checks
// ====================================================================

export default function VitalsPage() {
  const { s } = useStrings();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyStatus | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [keyNotice, setKeyNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [mode, setModeState] = useState<"check" | "track">(() => {
    try { return localStorage.getItem("vitals-mode") === "track" ? "track" : "check"; } catch { return "check"; }
  });
  const setMode = (m: "check" | "track") => {
    setModeState(m);
    try { localStorage.setItem("vitals-mode", m); } catch { /* not remembered */ }
  };
  const [serverOutdated, setServerOutdated] = useState(false);
  const [list, setList] = useState<ReportFile[]>([]);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<VitalsReport | null>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"start" | "lab" | "field" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const [listLoaded, setListLoaded] = useState(false);

  const refresh = useCallback(async (select?: string) => {
    try {
      const res = await fetch("/api/vitals-reports");
      const items: ReportFile[] = res.ok ? await res.json() : [];
      setList(items);
      setSelected(cur => select ?? (cur || items[0]?.name || ""));
    } catch {
      setList([]);
    } finally {
      setListLoaded(true);
    }
  }, []);

  // A server started before this feature existed answers 404 here; that means
  // "restart the dashboard", not "no key".
  useEffect(() => {
    fetch("/api/vitals/status")
      .then(r => {
        if (r.status === 404) { setServerOutdated(true); return null; }
        return r.json();
      })
      .then(b => {
        if (!b) return;
        setConfigured(Boolean(b.configured));
        setKeyInfo(b);
      })
      .catch(() => setServerOutdated(true));
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) { setReport(null); return; }
    let cancelled = false;
    fetch(`/api/vitals-reports/${encodeURIComponent(selected)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(r => { if (!cancelled) setReport(r); })
      .catch(e => { if (!cancelled) setMessage(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [selected]);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const target = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    controller.current = new AbortController();
    setPhase("start");
    try {
      const res = await fetch("/api/vitals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
        signal: controller.current.signal
      });
      if (res.status === 404) { setServerOutdated(true); return; }
      if (res.status === 412) { setConfigured(false); return; }
      if (res.status === 409) throw new Error(s.busy);
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const ev = JSON.parse(line);
          if (ev.type === "phase") setPhase(ev.phase);
          else if (ev.type === "done") await refresh(ev.file);
          else if (ev.type === "error") throw new Error(ev.message);
        }
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setMessage(aborted ? s.stopped : err instanceof Error ? err.message : String(err));
    } finally {
      setPhase(null);
      controller.current = null;
    }
  };

  const running = phase !== null;
  const disabled = configured === false || serverOutdated;

  return (
    <div>
      <PageHeader title={s.heading} description={s.lede} />

      {serverOutdated && <Notice tone="warning" title={s.restartTitle} className="mb-4">{s.restart}</Notice>}
      {!serverOutdated && (configured === false || editingKey) && (
        <ApiKeyForm
          onCancel={configured ? () => setEditingKey(false) : undefined}
          onSaved={(status, verified) => {
            setConfigured(true);
            setKeyInfo(status);
            setEditingKey(false);
            setKeyNotice({ tone: verified ? "success" : "warning", text: verified ? s.key.saved : s.key.savedUnverified });
          }} />
      )}
      {keyNotice && <Notice tone={keyNotice.tone} className="mb-4">{keyNotice.text}</Notice>}

      {!serverOutdated && (
        <div className="mb-6">
          <Segmented<"check" | "track"> label={s.modeLabel} value={mode} onChange={setMode} options={[
            { value: "check", label: s.modes.check, icon: "gauge" },
            { value: "track", label: s.modes.track, icon: "spark" }
          ]} />
        </div>
      )}

      {mode === "track" && !serverOutdated ? <TrackingView configured={configured} /> : <>
      <Card className="mb-8 p-4 sm:p-5">
        <form onSubmit={run} className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="min-w-0 flex-1" htmlFor="vitals-url">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{s.urlLabel}</span>
            <span className="relative block">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="vitals-url" type="text" inputMode="url" required value={url} disabled={running || disabled}
                onChange={e => setUrl(e.target.value)} placeholder="https://www.magentainsurance.gr/" className={cx(inputClass, "pl-9")} />
            </span>
          </label>
          {running
            ? <Button onClick={() => controller.current?.abort()} icon="x">{s.stop}</Button>
            : <Button type="submit" variant="primary" icon="gauge" disabled={disabled}>{s.run}</Button>}
        </form>
        {running && <Progress phase={phase} />}
        {message && <Notice tone="danger" className="mt-4">{message}</Notice>}
        {configured && keyInfo?.last4 && !editingKey && (
          <KeyLine info={keyInfo} disabled={running}
            onChange={() => { setKeyNotice(null); setEditingKey(true); }}
            onRemoved={status => { setConfigured(false); setKeyInfo(status); setKeyNotice({ tone: "success", text: s.key.removed }); }} />
        )}
      </Card>

      {report
        ? <ReportView report={report} list={list} selected={selected} onSelect={setSelected} />
        : !running && !disabled && !message && (!listLoaded || selected) ? <LoadingCard />
        : !running && !disabled && (
          <Card className="flex flex-col items-center border-dashed px-6 py-14 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
              <Icon name="gauge" className="h-5 w-5" />
            </span>
            <div className="font-semibold">{s.emptyTitle}</div>
            <p className={`mt-1 max-w-sm text-sm ${muted}`}>{s.empty}</p>
          </Card>
        )}
      </>}
    </div>
  );
}

// ---------- Google API key ----------

type KeyStatus = { configured: boolean; source: "env" | "file" | "custom" | null; last4: string | null };

/** Paste a key; the server tests it with Google before saving it to this computer. */
function ApiKeyForm({ onSaved, onCancel }: { onSaved: (status: KeyStatus, verified: boolean) => void; onCancel?: () => void }) {
  const { s } = useStrings();
  const k = s.key;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/vitals/key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: value })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = body.code as string | undefined;
        const known = code && code in k.errors && code !== "other" && code !== "server" ? k.errors[code as "EFORMAT"] : null;
        setError(known ?? k.errors.other(body.error ?? `HTTP ${res.status}`));
        return;
      }
      setValue("");
      onSaved(body, body.verified === true);
    } catch {
      setError(k.errors.server);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6 p-5 sm:p-6">
      <h2 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{k.title}</h2>
      <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">{k.intro}</p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{k.howTitle}</h3>
          <ol className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300">
            {k.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
            {k.console}<Icon name="external" className="h-3.5 w-3.5" />
          </a>
        </div>

        <form onSubmit={save} className="min-w-0 self-start">
          <label htmlFor="api-key" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{k.label}</label>
          <input id="api-key" type="password" required value={value} disabled={saving} onChange={e => setValue(e.target.value)}
            autoComplete="off" spellCheck={false} placeholder="AIza…" className={cx(inputClass, "font-mono")} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={saving || !value.trim()}>
              {saving ? <><Spinner className="h-4 w-4 text-white" />{k.saving}</> : k.save}
            </Button>
            {onCancel && <Button onClick={onCancel} disabled={saving}>{k.cancel}</Button>}
          </div>
          {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
        </form>
      </div>
    </Card>
  );
}

/** Which key is in use (last 4 characters only), with change and remove. */
function KeyLine({ info, disabled, onChange, onRemoved }: {
  info: KeyStatus; disabled: boolean; onChange: () => void; onRemoved: (status: KeyStatus) => void;
}) {
  const { s } = useStrings();
  const k = s.key;
  const [confirming, setConfirming] = useState(false);
  const fixed = info.source === "env" || info.source === "custom";

  const remove = async () => {
    const res = await fetch("/api/vitals/key", { method: "DELETE" }).catch(() => null);
    if (res?.ok) onRemoved(await res.json());
    setConfirming(false);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-[13px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <Icon name="check" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
      <span>{fixed ? k.fromEnv(info.last4 ?? "") : k.current(info.last4 ?? "")}</span>
      {!fixed && !confirming && (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onChange} disabled={disabled}>{k.change}</Button>
          <Button size="sm" variant="danger-ghost" onClick={() => setConfirming(true)} disabled={disabled}>{k.remove}</Button>
        </span>
      )}
      {confirming && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-slate-700 dark:text-slate-200">{k.removeConfirm}</span>
          <Button size="sm" variant="danger" onClick={remove}>{k.remove}</Button>
          <Button size="sm" onClick={() => setConfirming(false)}>{k.cancel}</Button>
        </span>
      )}
    </div>
  );
}

function Progress({ phase }: { phase: "start" | "lab" | "field" | null }) {
  const { s } = useStrings();
  const steps: { key: "lab" | "field"; label: string }[] = [
    { key: "lab", label: s.steps.lab },
    { key: "field", label: s.steps.field }
  ];
  const index = phase === "field" ? 1 : 0;
  return (
    <div aria-live="polite" className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{s.progressTitle}</span>
        <span className={`text-xs ${muted}`}>{s.progressNote}</span>
      </div>
      <ol className="space-y-2.5">
        {steps.map((st, i) => (
          <li key={st.key} className="flex items-center gap-3 text-sm">
            {i < index
              ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-3 w-3" /></span>
              : i === index ? <Spinner className="h-5 w-5" />
              : <span className="h-5 w-5 rounded-full border-2 border-slate-300 dark:border-slate-600" />}
            <span className={i > index ? muted : "text-slate-800 dark:text-slate-100"}>{st.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ====================================================================
// One saved check
// ====================================================================

function assess(d: FieldDevice | null | undefined): { passed: boolean | null; failing: Group[] } {
  const m = d?.current?.metrics;
  if (!m || (!m.lcp && !m.cls)) return { passed: null, failing: [] };
  const failing = CORE.filter(id => m[id] && m[id]!.rating !== "good");
  return { passed: failing.length === 0, failing };
}

function ReportView({ report, list, selected, onSelect }: {
  report: VitalsReport; list: ReportFile[]; selected: string; onSelect: (name: string) => void;
}) {
  const { s, lang, locale } = useStrings();
  const [device, setDevice] = useState<Device>("mobile");
  const pageHasData = hasCurrent(report.field.page);
  const [scopeKey, setScopeKey] = useState<"page" | "site">(pageHasData ? "page" : "site");
  useEffect(() => setScopeKey(hasCurrent(report.field.page) ? "page" : "site"), [report]);

  const scope = report.field[scopeKey];
  const dev = scope ? scope[device] : null;
  const lab = report.lab[device];
  const other: Device = device === "mobile" ? "desktop" : "mobile";

  // Field rating per vital, falling back to the lab test where field data is missing.
  const ratingOf = (g: Group): Rating | null =>
    dev?.current?.metrics[g]?.rating
      ?? (g === "lcp" ? rateValue("lcp", lab?.lab.lcp) : g === "cls" ? rateValue("cls", lab?.lab.cls) : rateValue("tbt", lab?.lab.tbt));

  const fmtDate = (iso: string | null | undefined) => iso
    ? new Date(iso + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }) : "—";

  return (
    <div className="space-y-8">
      {/* header: which page, when, and which saved check */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-display-soft flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white">
            <span className="truncate">{report.finalUrl.replace(/^https?:\/\//, "")}</span>
            <a href={report.finalUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-brand-600" aria-label={report.finalUrl}>
              <Icon name="external" className="h-4 w-4" />
            </a>
          </div>
          <p className={`text-sm ${muted}`}>
            {s.checked} {new Date(report.generatedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
            {report.requestedUrl !== report.finalUrl && <> · {report.requestedUrl.replace(/^https?:\/\//, "")} {s.redirectedTo} {report.finalUrl.replace(/^https?:\/\//, "")}</>}
          </p>
        </div>
        {list.length > 1 && (
          <label className="flex w-full min-w-0 flex-col gap-1.5 text-sm sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <span className={muted}>{s.saved}</span>
            <select id="vitals-picker" value={selected} onChange={e => onSelect(e.target.value)} className={cx(inputClass, "min-w-0 sm:!w-auto sm:max-w-xs")}>
              {list.map(r => <option key={r.name} value={r.name}>{reportLabel(r.name, locale)}</option>)}
            </select>
          </label>
        )}
      </div>

      {report.errors.length > 0 && (
        <Notice tone="warning" title={s.partial}>
          <ul className="mt-1 list-disc pl-5">{report.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Notice>
      )}

      {/* toolbar: device and data scope */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${muted}`}>{s.device}</span>
          <Segmented<Device> label={s.device} value={device} onChange={setDevice} options={[
            { value: "mobile", label: s.mobile, icon: "mobile" },
            { value: "desktop", label: s.desktop, icon: "desktop" }
          ]} />
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${muted}`}>{s.scope}</span>
          <Segmented<"page" | "site"> label={s.scope} value={scopeKey} onChange={setScopeKey} options={[
            { value: "page", label: s.scopePage, disabled: !pageHasData },
            { value: "site", label: s.scopeSite }
          ]} />
        </div>
        {device === "mobile" && <span className={`text-xs ${muted}`}>{s.mobileFirst}</span>}
      </div>
      {!pageHasData && hasCurrent(report.field.site) && <p className={`-mt-5 text-sm ${muted}`}>{s.noPageData}</p>}

      <Verdict device={device} dev={dev} otherDev={scope ? scope[other] : null} otherLabel={other === "mobile" ? s.mobile : s.desktop}
        period={dev?.current?.period ? s.verdict.basedOn(fmtDate(dev.current.period.from), fmtDate(dev.current.period.to)) : null} />

      <div className="grid gap-4 lg:grid-cols-3">
        {CORE.map(id => <MetricCard key={id} id={id} dev={dev} lab={lab} />)}
      </div>

      <Fixes lab={lab} ratingOf={ratingOf} lang={lang} />

      <section>
        <SectionTitle>{s.details}</SectionTitle>
        <div className="space-y-3">
          <Disclosure title={s.otherMetrics} subtitle={s.otherMetricsSub}>
            <OtherMetrics dev={dev} />
          </Disclosure>
          {dev?.current?.lcpSubparts && (
            <Disclosure title={s.lcpParts} subtitle={s.lcpPartsSub}>
              <LcpParts parts={dev.current.lcpSubparts} />
            </Disclosure>
          )}
          {scope && (scope.mobile.history || scope.desktop.history) && (
            <Disclosure title={s.history} subtitle={s.historySub}>
              <History scope={scope} />
            </Disclosure>
          )}
          <Disclosure title={s.lab} subtitle={s.labSub}>
            <LabDetails lab={lab} />
          </Disclosure>
          <Disclosure title={s.about} subtitle={s.aboutSub}>
            <div className="max-w-prose space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {s.aboutText.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </Disclosure>
        </div>
      </section>
    </div>
  );
}

// ---------- verdict ----------

function Verdict({ device, dev, otherDev, otherLabel, period }: {
  device: Device; dev: FieldDevice | null; otherDev: FieldDevice | null; otherLabel: string; period: string | null;
}) {
  const { s, lang } = useStrings();
  const { passed, failing } = assess(dev);
  const otherPassed = assess(otherDev).passed;
  const names = failing.map(g => METRIC_INFO[lang][g].name.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${lang === "el" ? "και" : "and"} ${names.at(-1)}` : names[0] ?? "";

  const tone = passed === null ? "none" : passed ? "pass" : "fail";
  const styles = {
    pass: { ring: "border-emerald-500", tile: "bg-emerald-500 text-white", icon: "check" as const },
    fail: { ring: "border-red-500", tile: "bg-red-500 text-white", icon: "x" as const },
    none: { ring: "border-slate-300 dark:border-slate-700", tile: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200", icon: "info" as const }
  }[tone];

  return (
    <section className={cx("flex flex-col gap-5 border-l-4 py-1 pl-5 sm:flex-row sm:items-end sm:pl-6", styles.ring)}>
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-2 text-sm font-medium ${muted}`}>
          <span className={cx("flex h-5 w-5 items-center justify-center rounded-full", styles.tile)}><Icon name={styles.icon} className="h-3 w-3" /></span>
          {device === "mobile" ? s.mobile : s.desktop}
        </div>
        <h2 className="font-display mt-2 text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-[1.05] text-slate-900 dark:text-white">
          {passed === null ? s.verdict.noData : passed ? s.verdict.pass : s.verdict.fail}
        </h2>
        <p className="mt-2 max-w-[62ch] text-base leading-relaxed text-slate-600 dark:text-slate-300">
          {passed === null ? s.verdict.noDataText : passed ? s.verdict.passText : s.verdict.failText(list)}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 text-sm sm:items-end">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[13px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Icon name={device === "mobile" ? "desktop" : "mobile"} className="h-3.5 w-3.5" />
          {s.verdict.other(otherLabel, otherPassed)}
        </span>
        {period && <span className={`text-xs ${muted}`}>{period}</span>}
      </div>
    </section>
  );
}

// ---------- metric card ----------

function trendOf(values: (number | null)[]): { first: number; last: number } | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length >= 2 ? { first: nums[0], last: nums[nums.length - 1] } : null;
}

function MetricCard({ id, dev, lab }: { id: Group; dev: FieldDevice | null; lab: LabResult | null }) {
  const { s, lang } = useStrings();
  const info = METRIC_INFO[lang][id];
  const m = dev?.current?.metrics[id];
  const value = m?.p75 ?? null;
  const rating = m?.rating ?? null;
  const history = dev?.history?.metrics[id] ?? [];
  const trend = trendOf(history);
  const labValue = id === "lcp" ? lab?.lab.lcp : id === "cls" ? lab?.lab.cls : null;

  let trendText: string | null = null;
  if (trend) {
    const a = formatValue(id, trend.first), b = formatValue(id, trend.last);
    const change = (trend.last - trend.first) / (trend.first || 1);
    const small = id === "cls" ? Math.abs(trend.last - trend.first) < 0.02 : Math.abs(change) < 0.05;
    trendText = small ? s.card.same(b) : trend.last < trend.first ? s.card.better(a, b) : s.card.worse(a, b);
  }

  // Real visitors see layout shifts the lab test (first seconds only) can't.
  const clsGap = id === "cls" && rating && rating !== "good" && lab && rateValue("cls", lab.lab.cls) === "good";
  const goodShare = m?.distribution.good;

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display-soft text-lg font-semibold text-slate-900 dark:text-white">{info.name}</h3>
          <div className={`text-xs ${muted}`} title={s.metricNames[id]}>{id.toUpperCase()} · {s.metricNames[id]}</div>
        </div>
      </div>

      {value !== null ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="font-display text-[2.25rem] font-bold leading-none tabular-nums text-slate-900 dark:text-white">{formatValue(id, value)}</span>
            <RatingPill rating={rating} label={rating ? s.rating[rating] : ""} size="md" />
          </div>
          <div className="mt-4"><Gauge metricId={id} value={value} labels={s.rating} /></div>
          <div className={`text-xs ${muted}`}>
            {s.card.good(formatValue(id, LIMITS[id].good))}
            {typeof goodShare === "number" && <> · {s.card.visitsGood(Math.round(goodShare * 100))}</>}
          </div>
        </>
      ) : (
        <p className={`mt-4 text-sm ${muted}`}>
          {s.card.noField} {typeof labValue === "number" && s.card.labValue(formatValue(id, labValue))}
        </p>
      )}

      <dl className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
        <div>
          <dt className={`text-xs font-medium ${muted}`}>{s.card.feel}</dt>
          <dd className="mt-0.5 leading-relaxed text-slate-700 dark:text-slate-300">{info.what}</dd>
        </div>
        <div>
          <dt className={`text-xs font-medium ${muted}`}>{s.card.matters}</dt>
          <dd className="mt-0.5 leading-relaxed text-slate-700 dark:text-slate-300">{info.affects}</dd>
        </div>
      </dl>

      {clsGap && <Notice tone="info" className="mt-4 text-[13px]">{s.card.clsGap}</Notice>}

      <div className="mt-auto space-y-3 pt-4">
        {trendText && (
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <Sparkline values={history} rating={rating} label={trendText} />
            <span>{trendText}</span>
          </div>
        )}
        <InlineDisclosure label={s.card.howTo}>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {info.fixes.map((f, i) => (
              <li key={i} className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 text-brand-500" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          {id === "inp" && <p className={`mt-2 text-xs ${muted}`}>{s.card.inpLab}</p>}
        </InlineDisclosure>
      </div>
    </Card>
  );
}

function InlineDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:text-brand-200">
        <Icon name="chevron" className={cx("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")} />
        {label}
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

// ---------- what to fix ----------

type Impact = "high" | "medium" | "low";

interface Fix {
  id: string;
  title: string;
  fix: string;
  groups: Group[];
  impact: Impact;
  saving: string | null;
  items: { label: string; timeMs?: number; bytes?: number }[];
  score: number;
  needsWork: boolean;
}

const RATING_WEIGHT = (r: Rating | null) => (r === "poor" ? 3 : r === "needs-improvement" ? 2 : r === "good" ? 0.4 : 1.5);
const groupOf = (metric: string): Group => (metric === "TBT" || metric === "INP" ? "inp" : metric === "CLS" ? "cls" : "lcp");

/**
 * Rank Lighthouse findings for one device. A fix ranks higher when it targets
 * a vital that real visitors rate poorly and when Google estimates a bigger
 * saving. Fixes for vitals that are already good go to "other suggestions".
 */
function buildFixes(lab: LabResult | null, ratingOf: (g: Group) => Rating | null, lang: Lang): { top: Fix[]; rest: Fix[] } {
  if (!lab) return { top: [], rest: [] };
  const fixes: Fix[] = lab.findings.map(f => {
    const groups = [...new Set(f.metrics.map(groupOf))];
    if (!groups.length) groups.push("lcp");
    let best = 0;
    let saving: string | null = null;
    for (const [metric, v] of Object.entries(f.savings)) {
      const scaled = metric === "CLS" ? v * 10000 : v;
      if (scaled > best) { best = scaled; saving = metric === "CLS" ? `${v.toFixed(2)} CLS` : formatValue("lcp", v); }
    }
    const anyPoor = groups.some(g => ratingOf(g) === "poor");
    const impact: Impact = best >= 1000 ? "high" : best >= 300 ? "medium" : best > 0 ? "low" : anyPoor ? "medium" : "low";
    const advice = ADVICE[f.id]?.[lang];
    return {
      id: f.id,
      title: advice?.title ?? f.title,
      fix: advice?.fix ?? f.description,
      groups,
      impact,
      saving,
      items: f.items,
      score: Math.max(...groups.map(g => RATING_WEIGHT(ratingOf(g)))) * (best || 150),
      needsWork: groups.some(g => ratingOf(g) !== "good")
    };
  }).sort((a, b) => b.score - a.score);

  const top = fixes.filter(f => f.needsWork && f.impact !== "low").slice(0, 5);
  if (top.length < 3) {
    for (const f of fixes) if (top.length < 3 && f.needsWork && !top.includes(f)) top.push(f);
  }
  return { top, rest: fixes.filter(f => !top.includes(f)) };
}

const IMPACT_STYLE: Record<Impact, string> = {
  high: "bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/25",
  medium: "bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/25",
  low: "bg-slate-50 text-slate-500 ring-slate-400/15 dark:bg-slate-800/50 dark:text-slate-400 dark:ring-slate-600/25"
};

function Fixes({ lab, ratingOf, lang }: { lab: LabResult | null; ratingOf: (g: Group) => Rating | null; lang: Lang }) {
  const { s } = useStrings();
  const { top, rest } = useMemo(() => buildFixes(lab, ratingOf, lang), [lab, ratingOf, lang]);

  return (
    <section>
      <SectionTitle>{s.fixFirst}</SectionTitle>
      <p className={`-mt-1 mb-4 max-w-prose text-sm ${muted}`}>{s.fixFirstLede}</p>
      {top.length === 0
        ? <Card className={`p-5 text-sm ${muted}`}>{s.noFixes}</Card>
        : (
          <ol className="space-y-3">
            {top.map((f, i) => (
              <li key={f.id}>
                <Card className="flex gap-4 p-4 sm:p-5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[13px] font-semibold text-white dark:bg-white dark:text-slate-900">{i + 1}</span>
                  <FixBody fix={f} />
                </Card>
              </li>
            ))}
          </ol>
        )}
      {rest.length > 0 && (
        <Disclosure className="mt-3" title={s.moreSuggestions(rest.length)} subtitle={s.moreSuggestionsSub}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rest.map(f => <li key={f.id} className="py-3 first:pt-0 last:pb-0"><FixBody fix={f} /></li>)}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

function FixBody({ fix }: { fix: Fix }) {
  const { s, lang } = useStrings();
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-semibold text-slate-900 dark:text-white">{fix.title}</h3>
        <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", IMPACT_STYLE[fix.impact])}>{s.impact[fix.impact]}</span>
      </div>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{fix.fix}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
        <span className={muted}>{s.improves}</span>
        {fix.groups.map(g => (
          <span key={g} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {METRIC_INFO[lang][g].name}
          </span>
        ))}
        {fix.saving && <span className={muted}>· {s.saves(fix.saving)}</span>}
      </div>
      {fix.items.length > 0 && (
        <div className="mt-3">
          <InlineDisclosure label={s.files(fix.items.length)}>
            <ul className="space-y-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
              {fix.items.map((it, i) => (
                <li key={i} className="flex min-w-0 justify-between gap-4 text-xs">
                  <span className="min-w-0 truncate font-mono text-slate-700 dark:text-slate-300" title={it.label}>{it.label}</span>
                  <span className={`shrink-0 tabular-nums ${muted}`}>
                    {[typeof it.timeMs === "number" ? formatValue("lcp", it.timeMs) : null,
                      typeof it.bytes === "number" ? `${Math.round(it.bytes / 1024)} KB` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </InlineDisclosure>
        </div>
      )}
    </div>
  );
}

// ---------- details ----------

function OtherMetrics({ dev }: { dev: FieldDevice | null }) {
  const { s, lang } = useStrings();
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {(["fcp", "ttfb"] as VitalId[]).map(id => {
        const m = dev?.current?.metrics[id];
        const info = METRIC_INFO[lang][id];
        return (
          <div key={id} className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_16rem] md:items-center md:gap-8">
            <div className="min-w-0">
              <div className="font-medium">{info.name} <span className={`text-xs font-normal ${muted}`}>{id.toUpperCase()}</span></div>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{info.what} {info.affects}</p>
            </div>
            {m && m.p75 !== null ? (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">{formatValue(id, m.p75)}</span>
                  <RatingPill rating={m.rating} label={m.rating ? s.rating[m.rating] : ""} />
                </div>
                <Gauge metricId={id} value={m.p75} labels={s.rating} />
              </div>
            ) : <span className={`text-sm ${muted}`}>{s.noData}</span>}
          </div>
        );
      })}
    </div>
  );
}

function LcpParts({ parts }: { parts: NonNullable<NonNullable<FieldDevice["current"]>["lcpSubparts"]> }) {
  const { s } = useStrings();
  const rows = (["ttfb", "loadDelay", "loadDuration", "renderDelay"] as const).filter(k => typeof parts[k] === "number");
  const max = Math.max(...rows.map(k => parts[k] as number), 1);
  return (
    <div className="space-y-2.5">
      {rows.map(k => (
        <div key={k} className="grid grid-cols-[minmax(0,15rem)_1fr_4.5rem] items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">{s.lcpPart[k]}</span>
          <span className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <span className="block h-2 rounded-full" style={{ width: `${((parts[k] as number) / max) * 100}%`, background: "var(--series-mobile)" }} />
          </span>
          <span className="text-right font-medium tabular-nums">{formatValue("lcp", parts[k] as number)}</span>
        </div>
      ))}
    </div>
  );
}

function History({ scope }: { scope: FieldScope }) {
  const { s, lang, locale } = useStrings();
  const periods = scope.mobile.history?.periods ?? scope.desktop.history?.periods ?? [];
  return (
    <div>
      <p className={`mb-4 text-xs ${muted}`}>{s.trendNote}</p>
      <div className="grid gap-6 xl:grid-cols-3">
        {CORE.map(id => {
          const series = (["mobile", "desktop"] as Device[])
            .filter(d => scope[d].history?.metrics[id])
            .map(d => ({
              key: d,
              label: d === "mobile" ? s.mobile : s.desktop,
              color: d === "mobile" ? "var(--series-mobile)" : "var(--series-desktop)",
              values: scope[d].history!.metrics[id]!
            }));
          return (
            <div key={id} className="min-w-0">
              <div className="mb-2 text-sm font-semibold">{METRIC_INFO[lang][id].name} <span className={`font-normal ${muted}`}>{id.toUpperCase()}</span></div>
              {series.length
                ? <TrendChart metricId={id} series={series} periods={periods} locale={locale}
                    labels={{ good: s.rating.good, poor: s.rating.poor, week: s.week, showTable: s.showTable }} />
                : <p className={`text-sm ${muted}`}>{s.noData}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LabDetails({ lab }: { lab: LabResult | null }) {
  const { s } = useStrings();
  if (!lab) return <p className={`text-sm ${muted}`}>{s.noData}</p>;
  const score = lab.performanceScore === null ? null : Math.round(lab.performanceScore * 100);
  const scoreRating: Rating | null = score === null ? null : score >= 90 ? "good" : score >= 50 ? "needs-improvement" : "poor";
  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm leading-relaxed text-slate-600 dark:text-slate-300">{s.labIntro}</p>
      {lab.challengeSuspected && <Notice tone="warning">{s.challenge}</Notice>}
      {lab.redirected && <p className={`text-xs ${muted}`}>{s.redirectWarning}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-sm ${muted}`}>{s.score}</span>
        <span className="text-2xl font-semibold tabular-nums">{score ?? "—"}<span className={`text-sm font-normal ${muted}`}>/100</span></span>
        <RatingPill rating={scoreRating} label={scoreRating ? s.rating[scoreRating] : ""} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {(["lcp", "fcp", "tbt", "cls", "si"] as const).map(id => {
          const v = lab.lab[id];
          const r = rateValue(id, v);
          return (
            <div key={id} className="min-w-0">
              <dt className={`text-xs ${muted}`}>{s.labMetric[id]}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">{formatValue(id, v)}</span>
                <RatingPill rating={r} label={r ? s.rating[r] : ""} />
              </dd>
            </div>
          );
        })}
      </dl>
      <p className={`text-xs ${muted}`}>{s.tbtNote}</p>

      <div className="grid gap-5 lg:grid-cols-2">
        {lab.lcp.element && (
          <div className="min-w-0">
            <div className="mb-1.5 text-sm font-medium">{s.lcpElement}</div>
            {lab.lcp.element.label && <p className="mb-1.5 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{lab.lcp.element.label}</p>}
            <code className="block overflow-x-auto whitespace-pre rounded-lg bg-slate-100 p-2.5 font-mono text-xs dark:bg-slate-800">{lab.lcp.element.snippet}</code>
            {lab.lcp.breakdown.length > 0 && (
              <p className={`mt-1.5 text-xs ${muted}`}>{lab.lcp.breakdown.map(b => `${b.label} ${formatValue("lcp", b.durationMs)}`).join(" · ")}</p>
            )}
          </div>
        )}
        {lab.thirdParties.length > 0 && (
          <div className="min-w-0">
            <div className="mb-1.5 text-sm font-medium">{s.thirdParties}</div>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {lab.thirdParties.slice(0, 5).map(t => (
                <li key={t.name} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate">{t.name}</span>
                  <span className={`shrink-0 tabular-nums ${muted}`}>{formatValue("tbt", t.mainThreadMs)} {s.mainThread}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
