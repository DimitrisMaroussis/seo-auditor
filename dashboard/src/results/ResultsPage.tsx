import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuditReport, LinkFinding, PageResult, ReportFile, Severity, SiteChecks } from "../types";
import { issueLabels, useI18n } from "../i18n";
import AuditForm from "../AuditForm";
import { GUIDE_CODE_TO_SECTION } from "../Guide";
import { Button, Card, Icon, LoadingCard, Notice, PageHeader, SeverityPill, cx, inputClass, reportLabel, type IconName } from "../ui";

const muted = "text-slate-500 dark:text-slate-400";
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Path for URLs on the audited site (with or without www), host + path for anything else. */
function pathOf(url: string | null, root: string): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    const bare = (h: string) => h.replace(/^www\./, "");
    if (bare(u.hostname) === bare(new URL(root).hostname)) return u.pathname + u.search;
    return u.host + u.pathname + u.search;
  } catch {
    return url;
  }
}

// ====================================================================
// Page
// ====================================================================

export default function ResultsPage() {
  const { t, lang } = useI18n();
  const p = t.page;
  const locale = lang === "el" ? "el-GR" : "en-GB";

  const [reportList, setReportList] = useState<ReportFile[]>([]);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PageResult | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // With a report on screen the audit form folds away so the report leads; it stays mounted so a running audit keeps its progress.
  const [formOpen, setFormOpen] = useState(false);

  const [listLoaded, setListLoaded] = useState(false);

  const refreshReports = useCallback(async (select?: string) => {
    try {
      const res = await fetch("/api/reports");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list: ReportFile[] = await res.json();
      setReportList(list);
      setSelected(current => select ?? (current || list[0]?.name || ""));
    } catch {
      setReportList([]);
    } finally {
      setListLoaded(true);
    }
  }, []);

  useEffect(() => { refreshReports(); }, [refreshReports]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadError(null);
    fetch(`/api/reports/${encodeURIComponent(selected)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((r: AuditReport) => { if (!cancelled) setReport(r); })
      .catch(e => { if (!cancelled) setLoadError(`${selected}: ${e.message}`); });
    return () => { cancelled = true; };
  }, [selected]);

  const clearReports = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/reports", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReport(null);
      setSelected("");
      setDetail(null);
      await refreshReports();
      setClearNotice({ ok: true, text: t.clear.done(body.deleted ?? 0) });
    } catch (e) {
      setClearNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  const onUpload = async (file: File) => {
    try {
      setReport(JSON.parse(await file.text()));
      setSelected("");
      setLoadError(null);
    } catch (e) {
      setLoadError(`${file.name}: ${e}`);
    }
  };

  // Nothing to show: no report open and none on its way. Only then do the intro and the form lead the page.
  const empty = listLoaded && !report && !(selected && !loadError);

  return (
    <div>
      {empty && <PageHeader title={p.auditTitle} description={p.auditLede} />}

      {(reportList.length > 0 || report) && (
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="report-picker" className={`text-sm ${muted}`}>{p.report}</label>
          <select id="report-picker" value={selected} onChange={e => setSelected(e.target.value)}
            className={cx(inputClass, "h-9 w-auto min-w-0 max-w-full flex-1 sm:max-w-sm")}>
            {!selected && <option value="">{t.uploadedFile}</option>}
            {reportList.map(r => <option key={r.name} value={r.name}>{reportLabel(r.name, locale)}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-1">
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-within:ring-2 focus-within:ring-brand-500/50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">
              <Icon name="upload" />{p.openFile}
              <input type="file" accept=".json" className="sr-only" onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
            </label>
            {reportList.length > 0 && (
              <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => { setClearNotice(null); setConfirmClear(true); }}>
                {p.deleteAll}
              </Button>
            )}
            {!empty && (
              <Button size="sm" variant={formOpen ? "secondary" : "primary"} icon={formOpen ? "x" : "audit"} aria-expanded={formOpen}
                aria-controls="new-audit" onClick={() => setFormOpen(!formOpen)} className="ml-1">
                {formOpen ? t.clear.cancel : t.audit.heading}
              </Button>
            )}
          </div>
        </div>
      )}

      <div id="new-audit" hidden={!empty && !formOpen}>
        <AuditForm onFinished={file => { setFormOpen(false); refreshReports(file); }} />
      </div>

      {confirmClear && (
        <Notice tone="danger" className="mb-6" action={
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="danger" onClick={clearReports} disabled={clearing}>{t.clear.yes}</Button>
            <Button size="sm" onClick={() => setConfirmClear(false)} disabled={clearing}>{t.clear.cancel}</Button>
          </div>
        }>
          {t.clear.confirm(reportList.length)}
        </Notice>
      )}
      {clearNotice && <Notice tone={clearNotice.ok ? "success" : "danger"} className="mb-6">{clearNotice.text}</Notice>}
      {loadError && <Notice tone="danger" className="mb-6">{loadError}</Notice>}

      {report
        ? <ReportBody report={report} onOpen={setDetail} />
        : !listLoaded || (selected && !loadError) ? <LoadingCard />
        : (
          <Card className="flex flex-col items-center border-dashed px-6 py-14 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
              <Icon name="audit" className="h-5 w-5" />
            </span>
            <div className="font-semibold">{p.noReportTitle}</div>
            <p className={`mt-1 max-w-sm text-sm ${muted}`}>{p.noReport}</p>
          </Card>
        )}

      {detail && report && <PageDetail page={detail} site={report.site} root={report.rootUrl.replace(/\/$/, "") + "/"} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ====================================================================
// Report body: summary, issues, site checks, pages
// ====================================================================

function ReportBody({ report, onOpen }: { report: AuditReport; onOpen: (p: PageResult) => void }) {
  const { t, lang } = useI18n();
  const p = t.page;
  const locale = lang === "el" ? "el-GR" : "en-GB";
  const root = report.rootUrl.replace(/\/$/, "") + "/";
  const [codeFilter, setCodeFilter] = useState<string | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCodeFilter(null), [report]);

  const avgResponse = report.pages.length
    ? Math.round(report.pages.reduce((n, pg) => n + (pg.responseTimeMs ?? 0), 0) / report.pages.length)
    : 0;

  const issueCounts = useMemo(() => {
    const counts = new Map<string, { severity: Severity; pages: number }>();
    report.pages.forEach(pg => {
      const seen = new Set<string>();
      pg.issues.forEach(i => {
        if (seen.has(i.code)) return;
        seen.add(i.code);
        const c = counts.get(i.code) ?? { severity: i.severity, pages: 0 };
        c.pages++;
        counts.set(i.code, c);
      });
    });
    return [...counts.entries()].sort((a, b) =>
      SEVERITY_ORDER[a[1].severity] - SEVERITY_ORDER[b[1].severity] || b[1].pages - a[1].pages);
  }, [report]);

  const selectIssue = (code: string) => {
    setCodeFilter(prev => (prev === code ? null : code));
    requestAnimationFrame(() => pagesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const host = report.rootUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const scopeText = report.mode === "page"
    ? p.singlePage
    : `${report.summary.pagesAudited.toLocaleString(locale)} ${p.pagesHint(report.sitemap.urlCount.toLocaleString(locale))}`;
  const { errors, warnings, info } = report.summary;

  return (
    <div className="space-y-10">
      <section aria-labelledby="report-title">
        <p className={`text-sm ${muted}`}>
          {p.audited} {new Date(report.generatedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}, {scopeText}
        </p>
        <h1 id="report-title" className="font-display mt-1 break-words text-[clamp(2.25rem,7vw,4.75rem)] font-extrabold leading-[0.95] text-slate-900 dark:text-white">
          {host}
        </h1>
        <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-slate-700 dark:text-slate-300">
          {p.totals(report.summary.pagesAudited.toLocaleString(locale), errors, warnings, info)}. {avgResponse > 0 && p.avgLine(avgResponse)}
        </p>

        <SiteStrip key={report.generatedAt} pages={report.pages} root={root} onOpen={onOpen} />
      </section>

      {!!report.summary.blockedByBotProtection && (
        <Notice tone="warning">{t.blockedBanner(report.summary.blockedByBotProtection)}</Notice>
      )}

      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* issues: the main thing to act on */}
        <section className="min-w-0">
          <h2 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{p.issuesTitle}</h2>
          {issueCounts.length > 0 && <p className={`mt-1 text-sm ${muted}`}>{p.issuesLede}</p>}
          {issueCounts.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><Icon name="check" /></span>
              <div>
                <div className="font-medium">{p.noIssuesTitle}</div>
                <div className={`text-sm ${muted}`}>{p.noIssues}</div>
              </div>
            </div>
          ) : (
            <ul className="mt-4 border-t border-slate-200 dark:border-slate-800">
              {issueCounts.map(([code, { severity, pages }]) => {
                const active = codeFilter === code;
                const share = report.pages.length ? pages / report.pages.length : 0;
                return (
                  <li key={code} className={cx("relative flex items-center gap-4 border-b border-slate-200 transition-colors dark:border-slate-800", active ? "bg-brand-50/70 dark:bg-brand-500/10" : "hover:bg-slate-100/60 dark:hover:bg-slate-900")}>
                    <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full" style={{ background: `var(--sev-${severity})` }} />
                    <button type="button" onClick={() => selectIssue(code)} aria-pressed={active}
                      className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-900 dark:text-slate-100">{issueLabels[lang][code] ?? code}</span>
                        <span className={`block text-xs ${muted}`}>{p.sevName[severity]}</span>
                      </span>
                      <span aria-hidden className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-slate-200 sm:block dark:bg-slate-800">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, 3)}%`, background: `var(--sev-${severity})` }} />
                      </span>
                      <span className="w-20 shrink-0 text-right text-sm tabular-nums text-slate-700 dark:text-slate-300">{p.pagesAffected(pages)}</span>
                    </button>
                    {GUIDE_CODE_TO_SECTION[code] && (
                      <a href={`#gcode-${code}`} className="hidden shrink-0 pr-2 text-[13px] font-medium text-brand-600 hover:underline sm:inline dark:text-brand-300">{p.whatIsThis}</a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <SiteChecks report={report} root={root} />
      </div>

      <div ref={pagesRef} className="scroll-mt-20">
        <PagesTable report={report} root={root} codeFilter={codeFilter} onClearCode={() => setCodeFilter(null)} onOpen={onOpen} />
      </div>
    </div>
  );
}

// ---------- site strip: one block per page, worst first ----------

type Worst = "error" | "warning" | "info" | "clean" | "failed";
const WORST_ORDER: Worst[] = ["error", "warning", "info", "clean", "failed"];

const worstOf = (pg: PageResult): Worst =>
  pg.fetchError || pg.blocked ? "failed"
    : pg.issues.some(i => i.severity === "error") ? "error"
    : pg.issues.some(i => i.severity === "warning") ? "warning"
    : pg.issues.length ? "info" : "clean";

const swatch = (w: Worst) => w === "failed"
  ? { background: "repeating-linear-gradient(135deg, var(--strip-failed) 0 2px, transparent 2px 5px)", boxShadow: "inset 0 0 0 1px var(--strip-failed)" }
  : { background: `var(--strip-${w})` };

function SiteStrip({ pages, root, onOpen }: { pages: PageResult[]; root: string; onOpen: (p: PageResult) => void }) {
  const { t, lang } = useI18n();
  const st = t.page.strip;
  const [hover, setHover] = useState<number | null>(null);

  const cells = useMemo(() => pages
    .map(pg => ({ pg, worst: worstOf(pg) }))
    .sort((a, b) => WORST_ORDER.indexOf(a.worst) - WORST_ORDER.indexOf(b.worst) || b.pg.issues.length - a.pg.issues.length), [pages]);
  const counts = WORST_ORDER.map(w => [w, cells.filter(c => c.worst === w).length] as const).filter(([, n]) => n > 0);

  if (!cells.length) return null;
  const n = cells.length;
  const height = n <= 40 ? "h-16" : n <= 200 ? "h-10" : "h-6";
  const step = Math.min(18, 700 / n); // the whole strip fills in under a second, whatever its size
  const hovered = hover === null ? null : cells[hover];
  const by = (pg: PageResult, sev: Severity) => pg.issues.filter(i => i.severity === sev).length;

  return (
    <div className="mt-8">
      <div role="img" aria-label={`${st.label(n)}: ${counts.map(([w, c]) => `${c} ${st[w]}`).join(", ")}`}
        className="grid gap-[3px]" onMouseLeave={() => setHover(null)}
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${n > 200 ? 6 : 12}px, 1fr))` }}>
        {cells.map(({ pg, worst }, i) => (
          <div key={pg.requestedUrl} onClick={() => onOpen(pg)} onMouseEnter={() => setHover(i)}
            className={cx("strip-in cursor-pointer rounded-[2px] transition-transform duration-150", height, hover === i && "-translate-y-1")}
            style={{ ...swatch(worst), animationDelay: `${Math.round(i * step)}ms` }} />
        ))}
      </div>

      <p className="mt-3 min-h-[1.5rem] truncate text-sm" aria-hidden="true">
        {hovered ? (
          <>
            <span className="font-mono text-slate-900 dark:text-white">{pathOf(hovered.pg.requestedUrl, root)}</span>
            <span className={muted}>
              {"  "}{hovered.worst === "clean" ? st.clean
                : hovered.worst === "failed" ? (hovered.pg.fetchError?.code ?? t.blocked)
                : (["error", "warning", "info"] as Severity[]).filter(sev => by(hovered.pg, sev)).map(sev =>
                    `${by(hovered.pg, sev)} ${t.stats[sev === "error" ? "errors" : sev === "warning" ? "warnings" : "info"].toLowerCase()}`).join(", ")}
            </span>
          </>
        ) : <span className={muted}>{st.hint}</span>}
      </p>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {counts.map(([w, c]) => (
          <li key={w} className="flex items-center gap-2">
            <span aria-hidden className="h-3 w-3 rounded-[2px]" style={swatch(w)} />
            <span><b className="font-semibold tabular-nums text-slate-900 dark:text-white">{c.toLocaleString(lang === "el" ? "el-GR" : "en-GB")}</b> <span className="text-slate-600 dark:text-slate-300">{st[w]}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- site-wide checks ----------

function SiteChecks({ report, root }: { report: AuditReport; root: string }) {
  const { t, lang } = useI18n();
  const s = t.sections;
  const site = report.site;
  const linkList = (children: ReactNode) => <ul className="space-y-1.5 text-[13px] leading-snug">{children}</ul>;
  const path = (u: string | null) => pathOf(u, root);

  const checks: { key: string; title: string; severity: Severity; count: number; body: ReactNode }[] = [
    { key: "broken", title: s.broken, severity: "error", count: site.brokenInternalLinks.length, body: linkList(site.brokenInternalLinks.map(l => (
      <li key={l.url}><span className="font-mono text-red-600 dark:text-red-400">{l.status ?? l.error}</span> {path(l.url)} <span className="text-slate-500">· {t.linkedFrom(l.sources.length)}</span></li>))) },
    { key: "indexability", title: s.indexability, severity: "warning", count: site.indexabilityConflicts.length, body: linkList(site.indexabilityConflicts.map(c => (
      <li key={c.url}>{path(c.url)} <span className="text-slate-500">· {c.conflicts.join("; ")}</span></li>))) },
    { key: "canonical", title: s.canonical, severity: "warning", count: site.canonicalIssues.length, body: linkList(site.canonicalIssues.map(c => (
      <li key={c.canonical}>{path(c.canonical)} <span className="text-slate-500">· {c.problems.join("; ")} ({t.pagesCount(c.sources.length)})</span></li>))) },
    { key: "missingCanonical", title: s.missingCanonical, severity: "warning", count: site.missingCanonical.length, body: linkList(site.missingCanonical.map(u => <li key={u}>{path(u)}</li>)) },
    { key: "dupTitles", title: s.dupTitles, severity: "warning", count: site.duplicateTitles.length, body: linkList(site.duplicateTitles.map(g => (
      <li key={g.value}><div className="font-medium">"{g.value}"</div><div className="text-slate-500">{g.urls.map(path).join(", ")}</div></li>))) },
    { key: "dupDescriptions", title: s.dupDescriptions, severity: "warning", count: site.duplicateDescriptions.length, body: linkList(site.duplicateDescriptions.map(g => (
      <li key={g.value}><div className="font-medium">"{g.value}"</div><div className="text-slate-500">{g.urls.map(path).join(", ")}</div></li>))) },
    { key: "redirecting", title: s.redirecting, severity: "info", count: site.redirectingInternalLinks.length, body: linkList(site.redirectingInternalLinks.map(l => (
      <li key={l.url}>{path(l.url)} → {path(l.finalUrl)} <span className="text-slate-500">({t.pagesCount(l.sources.length)})</span></li>))) }
  ];
  // Checks added later; older reports don't have them, so they only appear when the report ran them.
  const findings = (key: string, title: string, severity: Severity, items: LinkFinding[] | undefined, note?: string) => items && checks.push({
    key, title, severity, count: items.length, body: <>
      {note && <p className="mb-2 text-[13px] text-slate-500">{note}</p>}
      {linkList(items.map(l => (
        <li key={l.url}><span className="font-mono text-red-600 dark:text-red-400">{l.reason}</span> <span className="break-all">{path(l.url)}</span> <span className="text-slate-500">· {t.linkedFrom(l.sources.length)}</span></li>)))}
    </>
  });
  findings("brokenExternal", s.brokenExternal, "error", site.brokenExternalLinks);
  findings("unverifiedExternal", s.unverifiedExternal, "info", site.unverifiedExternalLinks, t.unverifiedNote);
  if (site.invalidEmailDomains) checks.push({ key: "emailDomains", title: s.emailDomains, severity: "warning", count: site.invalidEmailDomains.length,
    body: linkList(site.invalidEmailDomains.map(d => <li key={d.domain}><span className="font-mono">@{d.domain}</span> <span className="text-slate-500">· {t.pagesCount(d.sources.length)}</span></li>)) });
  findings("brokenImages", s.brokenImages, "error", site.brokenImages);
  findings("unverifiedImages", s.unverifiedImages, "info", site.unverifiedImages, t.unverifiedNote);
  // Most serious first; within a severity, the order above.
  const failing = checks.filter(c => c.count > 0).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const passed = checks.filter(c => c.count === 0);

  return (
    <section className="min-w-0">
      <h2 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{t.siteChecks}</h2>
      <p className={`mt-1 text-sm ${muted}`}>{t.page.siteChecksLede}</p>
      <ul className="mt-4 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {failing.map(c => <SiteCheckRow key={c.key} title={c.title} severity={c.severity} count={c.count}>{c.body}</SiteCheckRow>)}
        {passed.length > 0 && (
          <li className="py-3.5">
            <div className="flex items-center gap-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-3 w-3" /></span>
              {t.page.passed(passed.length)}
            </div>
            <p className={`mt-1 pl-[1.875rem] text-[13px] ${muted}`}>{passed.map(c => c.title).join(" · ")}</p>
          </li>
        )}
      </ul>
      {lang === "el" && failing.length > 0 && <p className={`pt-2.5 text-xs ${muted}`}>{t.messagesNote}</p>}
    </section>
  );
}

const SITE_CHECK_TONE: Record<Severity, { dot: string; icon: IconName; badge: string }> = {
  error: { dot: "bg-red-500", icon: "alert", badge: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" },
  warning: { dot: "bg-amber-500", icon: "alert", badge: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" },
  info: { dot: "bg-sky-500", icon: "info", badge: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" }
};

function SiteCheckRow({ title, severity, count, children }: { title: string; severity: Severity; count: number; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tone = SITE_CHECK_TONE[severity];
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 py-3.5 text-left transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40">
        <span title={t.page.sevName[severity]} className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white", tone.dot)}><Icon name={tone.icon} className="h-3 w-3" /></span>
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">
          {title}<span className="sr-only"> ({t.page.sevName[severity]})</span>
        </span>
        <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", tone.badge)}>{count}</span>
        <Icon name="chevron" className={cx("h-4 w-4 text-slate-400 transition-transform duration-200", open && "rotate-90")} />
      </button>
      {open && <div className="break-words pb-4 pl-[1.875rem] text-slate-700 dark:text-slate-300">{children}</div>}
    </li>
  );
}

// ---------- pages table ----------

function StatusChip({ page }: { page: PageResult }) {
  const { t } = useI18n();
  if (page.fetchError) return <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-mono text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">{page.fetchError.code}</span>;
  if (page.blocked) return <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t.blocked}</span>;
  const st = page.status ?? 0;
  const tone = st >= 400 ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
    : st >= 300 || page.redirectChain.length ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
  return <span className={cx("rounded-md px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums", tone)}>{page.status}{page.redirectChain.length ? " ↪" : ""}</span>;
}

function PagesTable({ report, root, codeFilter, onClearCode, onOpen }: {
  report: AuditReport; root: string; codeFilter: string | null; onClearCode: () => void; onOpen: (p: PageResult) => void;
}) {
  const { t, lang } = useI18n();
  const p = t.page;
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | Severity | "clean">("all");

  useEffect(() => { setQuery(""); setSeverity("all"); }, [report]);

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return report.pages.filter(pg => {
      if (codeFilter && !pg.issues.some(i => i.code === codeFilter)) return false;
      if (q && !`${pg.requestedUrl} ${pg.title.text ?? ""}`.toLowerCase().includes(q)) return false;
      if (severity === "clean") return pg.issues.length === 0;
      if (severity !== "all") return pg.issues.some(i => i.severity === severity);
      return true;
    });
  }, [report, query, severity, codeFilter]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-slate-800">
        <h2 className="font-display-soft mr-auto text-xl font-semibold text-slate-900 dark:text-white">{p.pagesTitle} <span className={`text-base font-normal tabular-nums ${muted}`}>{pages.length}</span></h2>
        <span className="relative w-full sm:w-64">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} className={cx(inputClass, "h-9 pl-9")} />
        </span>
        <select value={severity} onChange={e => setSeverity(e.target.value as typeof severity)} aria-label={t.cols.issues} className={cx(inputClass, "h-9 !w-auto")}>
          <option value="all">{t.filter.all}</option>
          <option value="error">{t.filter.error}</option>
          <option value="warning">{t.filter.warning}</option>
          <option value="info">{t.filter.info}</option>
          <option value="clean">{t.filter.clean}</option>
        </select>
      </div>
      {codeFilter && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-brand-50/50 px-4 py-2 text-sm sm:px-5 dark:border-slate-800 dark:bg-brand-500/5">
          <span className={muted}>{p.filteredBy}:</span>
          <span className="font-medium">{issueLabels[lang][codeFilter] ?? codeFilter}</span>
          <Button size="sm" variant="ghost" icon="x" onClick={onClearCode} className="ml-auto">{p.clearFilter}</Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left text-sm">
          {/* On phones the load-time column is hidden so the page column keeps its room. */}
          <colgroup><col /><col className="w-[4.5rem] sm:w-24" /><col className="w-24 sm:w-40" /><col className="hidden sm:table-column sm:w-36" /></colgroup>
          <thead className="text-xs font-medium text-slate-500 dark:text-slate-400">
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-2.5 font-medium sm:px-5">{p.cols.page}</th>
              <th className="px-3 py-2.5 font-medium">{p.cols.status}</th>
              <th className="px-3 py-2.5 font-medium">{p.cols.issues}</th>
              <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell sm:px-5">{p.cols.time}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {pages.map(pg => {
              const by = (sev: Severity) => pg.issues.filter(i => i.severity === sev).length;
              return (
                <tr key={pg.requestedUrl} tabIndex={0} onClick={() => onOpen(pg)} onKeyDown={e => e.key === "Enter" && onOpen(pg)}
                  className="cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-brand-50/60 focus-visible:outline-none dark:hover:bg-slate-800/40 dark:focus-visible:bg-brand-500/10">
                  <td className="px-4 py-2.5 sm:px-5">
                    <div className="truncate font-medium text-slate-800 dark:text-slate-100" title={pg.title.text ?? ""}>{pg.title.text || "—"}</div>
                    <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400" title={pg.requestedUrl}>{pathOf(pg.requestedUrl, root)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5"><StatusChip page={pg} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <div className="flex gap-1">
                      {by("error") > 0 && <SeverityPill severity="error">{by("error")}</SeverityPill>}
                      {by("warning") > 0 && <SeverityPill severity="warning">{by("warning")}</SeverityPill>}
                      {by("info") > 0 && <SeverityPill severity="info">{by("info")}</SeverityPill>}
                      {pg.issues.length === 0 && <Icon name="check" className="h-4 w-4 text-emerald-500" />}
                    </div>
                  </td>
                  <td className={`hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums sm:table-cell sm:px-5 ${muted}`}>{pg.responseTimeMs != null ? `${pg.responseTimeMs} ms` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pages.length === 0 && <p className={`px-5 py-8 text-center text-sm ${muted}`}>{p.noMatch}</p>}
      </div>
    </Card>
  );
}

// ====================================================================
// Page detail drawer
// ====================================================================

type LinkRow = { key: string; target: string; href?: string; detail: ReactNode };
type LinkGroup = { key: string; title: string; tone: "bad" | "warn" | "note"; note?: string; rows: LinkRow[] };

/**
 * Every link and image problem on one page, item by item. Network findings
 * come from the site-wide lists (each records the pages it was found on);
 * email, phone and unreadable links come from the page itself.
 */
function LinksAndImages({ page, site, root }: { page: PageResult; site: SiteChecks; root: string }) {
  const { t } = useI18n();
  const d = t.detail;
  const g = d.linksGroups;
  const here = page.finalUrl;
  const onPage = <T extends { sources: string[] }>(items: T[] | undefined) => (items ?? []).filter(i => here !== null && i.sources.includes(here));
  const finding = (l: LinkFinding): LinkRow => ({ key: l.url, target: pathOf(l.url, root), href: l.url, detail: l.reason });
  const other = page.otherLinks;
  const check = site.linkCheck;

  const allGroups: LinkGroup[] = [
    { key: "broken", title: g.brokenLinks, tone: "bad", rows: [
      ...onPage(site.brokenInternalLinks).map(l => ({ key: l.url, target: pathOf(l.url, root), href: l.url, detail: l.status ? `HTTP ${l.status}` : l.error ?? "" })),
      ...onPage(site.brokenExternalLinks).map(finding)
    ] },
    { key: "brokenImages", title: g.brokenImages, tone: "bad", rows: onPage(site.brokenImages).map(finding) },
    { key: "emailDomains", title: g.emailDomains, tone: "warn",
      rows: onPage(site.invalidEmailDomains).map(e => ({ key: e.domain, target: `@${e.domain}`, detail: "" })) },
    { key: "invalidEmail", title: g.invalidEmail, tone: "warn", rows: (other?.invalidEmail ?? []).map(l => ({ key: l.href, target: l.href, detail: l.reason })) },
    { key: "invalidPhone", title: g.invalidPhone, tone: "warn", rows: (other?.invalidPhone ?? []).map(l => ({ key: l.href, target: l.href, detail: l.reason })) },
    { key: "malformed", title: g.malformed, tone: "warn", rows: (other?.malformed ?? []).map((l, i) => ({ key: `${l.href}-${i}`, target: l.href || "href=\"\"", detail: l.reason })) },
    { key: "missingAlt", title: g.missingAlt, tone: "warn",
      rows: page.images.missingAlt.map((img, i) => ({ key: `${img.src}-${i}`, target: img.src ? pathOf(normalizeImage(img.src, page.finalUrl), root) : d.noSrc, href: img.src ? normalizeImage(img.src, page.finalUrl) : undefined, detail: "" })) },
    { key: "redirecting", title: g.redirecting, tone: "note",
      rows: onPage(site.redirectingInternalLinks).map(l => ({ key: l.url, target: pathOf(l.url, root), href: l.url, detail: <>→ {pathOf(l.finalUrl, root)}</> })) },
    { key: "refusedLinks", title: g.refusedLinks, tone: "note", note: d.refusedNote, rows: onPage(site.unverifiedExternalLinks).map(finding) },
    { key: "refusedImages", title: g.refusedImages, tone: "note", note: d.refusedNote, rows: onPage(site.unverifiedImages).map(finding) },
    { key: "javascript", title: g.javascript, tone: "note", rows: (other?.javascript ?? []).map((href, i) => ({ key: `${href}-${i}`, target: href, detail: "" })) }
  ];
  const groups = allGroups.filter(group => group.rows.length > 0);

  const skipped = [
    check.skipped && d.notCheckedParts.internal,
    check.externalSkipped !== false && d.notCheckedParts.external,
    check.imagesSkipped !== false && d.notCheckedParts.images
  ].filter(Boolean) as string[];
  const linkCount = page.links.internal.length + page.links.external.length;
  const imageCount = page.images.urls?.length ?? page.images.count;

  const toneDot = { bad: "var(--sev-error)", warn: "var(--sev-warning)", note: "var(--sev-info)" };

  return (
    <div className="space-y-4">
      {groups.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Icon name="check" />{d.allWork(linkCount, imageCount)}</p>
      )}
      {groups.map(group => (
        <section key={group.key}>
          <h4 className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: toneDot[group.tone] }} />
            {group.title}
            <span className={`tabular-nums ${muted}`}>{group.rows.length}</span>
          </h4>
          {group.note && <p className={`mt-0.5 pl-4 text-xs ${muted}`}>{group.note}</p>}
          <ul className="mt-1.5 divide-y divide-slate-100 border-l border-slate-200 pl-4 text-[13px] dark:divide-slate-800 dark:border-slate-800">
            {group.rows.map(row => (
              <li key={row.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                {row.href && /^https?:/i.test(row.href)
                  ? <a href={row.href} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-mono text-slate-800 hover:text-brand-600 hover:underline dark:text-slate-200 dark:hover:text-brand-300">{row.target}</a>
                  : <span className="min-w-0 break-all font-mono text-slate-800 dark:text-slate-200">{row.target}</span>}
                {row.detail && <span className={`shrink-0 text-xs ${muted}`}>{row.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {skipped.length > 0 && <p className={`text-xs ${muted}`}>{d.notChecked(skipped.join(", "))}</p>}
    </div>
  );
}

/** Absolute URL for an image src as written in the page, for display and opening. */
function normalizeImage(src: string, base: string | null): string {
  try {
    return new URL(src, base ?? undefined).href;
  } catch {
    return src;
  }
}

function PageDetail({ page, site, root, onClose }: { page: PageResult; site: SiteChecks; root: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const d = t.detail;
  const sd = page.structuredData;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 py-2.5 text-sm">
      <dt className={muted}>{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words text-slate-800 dark:text-slate-200">{value ?? "—"}</dd>
    </div>
  );
  const heading = (text: string) => <h3 className="mb-2 mt-7 text-sm font-semibold text-slate-900 first:mt-0 dark:text-white">{text}</h3>;
  const verdictTone = (v: string) => v === "requiredPropertiesPresent" ? "text-emerald-700 dark:text-emerald-400"
    : v === "missingRequiredProperties" ? "text-red-600 dark:text-red-400" : muted;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="fade-in absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={pathOf(page.requestedUrl, root)}
        className="drawer-in relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="font-display-soft line-clamp-2 text-lg font-semibold leading-snug text-slate-900 dark:text-white">{page.title.text || pathOf(page.requestedUrl, root)}</div>
            <a href={page.finalUrl ?? page.requestedUrl} target="_blank" rel="noopener noreferrer"
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-[13px] text-brand-600 hover:underline dark:text-brand-300">
              <span className="truncate font-mono">{pathOf(page.requestedUrl, root)}</span><Icon name="external" className="h-3.5 w-3.5" />
            </a>
          </div>
          <Button size="sm" variant="ghost" icon="x" onClick={onClose} aria-label={t.page.close} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {heading(d.issues)}
          {page.issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Icon name="check" />{d.noIssues}</p>
          ) : (
            <ul className="space-y-2">
              {page.issues.map((i, n) => (
                <li key={n} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityPill severity={i.severity}>{issueLabels[lang][i.code] ?? i.code}</SeverityPill>
                    {GUIDE_CODE_TO_SECTION[i.code] && (
                      <a href={`#gcode-${i.code}`} className="ml-auto text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">{t.page.whatIsThis}</a>
                    )}
                  </div>
                  <p className={`mt-1.5 text-sm ${muted}`}>{i.message}</p>
                </li>
              ))}
            </ul>
          )}

          {page.analyzed && (
            <>
              {heading(d.linksImages)}
              <LinksAndImages page={page} site={site} root={root} />
            </>
          )}

          {heading(d.pageData)}
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            {row(d.status, page.fetchError ? `${page.fetchError.code}: ${page.fetchError.message}` : page.status)}
            {row(`${d.title} (${page.title.length})`, page.title.text)}
            {row(`${d.description} (${page.metaDescription.length})`, page.metaDescription.text)}
            {row(`H1 (${page.h1.count})`, page.h1.texts.join(" / ") || null)}
            {row(d.canonical, page.canonical.url)}
            {row(d.indexable, page.indexability
              ? (page.indexability.indexable ? d.yes : `${d.no} — ${page.indexability.reasons.join("; ")}`)
              : d.unknown)}
            {row(d.images, d.imagesValue(page.images.count, page.images.missingAlt.length, page.images.emptyAlt))}
            {row(d.links, d.linksValue(page.links.internal.length, page.links.external.length))}
            {row(d.redirects, page.redirectChain.length ? page.redirectChain.map(h => `${h.status} → ${h.location}`).join("\n") : d.none)}
            {row(d.finalUrl, page.finalUrl)}
            {row(d.responseTime, page.responseTimeMs != null ? `${page.responseTimeMs} ms` : null)}
            {row(d.contentType, page.contentType)}
            {row(d.metaRobots, page.metaRobots.map(m => `${m.name}: ${m.content}`).join(" | ") || null)}
            {row(d.xRobots, page.xRobotsTag.raw)}
            {row(d.inSitemap, page.inSitemap == null ? null : page.inSitemap ? d.yes : d.no)}
            {row(d.blocked, page.blocked ? page.blocked.vendor : d.no)}
          </dl>

          {sd && sd.google.features.length > 0 && (
            <>
              {heading(d.structuredData(sd.blockCount))}
              <ul className="space-y-2 text-sm">
                {sd.google.features.map((f, n) => (
                  <li key={n} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{f.type}</span>
                      <span className={`text-xs ${verdictTone(f.verdict)}`}>{t.verdicts[f.verdict] ?? f.verdict}</span>
                    </div>
                    {[...f.errors, ...f.warnings].map((m, k) => <div key={k} className={`mt-1 text-xs ${muted}`}>{m}</div>)}
                    {f.statusNote && <div className={`mt-1 text-xs ${muted}`}>{f.statusNote}</div>}
                  </li>
                ))}
              </ul>
              <p className={`mt-3 text-xs ${muted}`}>{d.sdDisclaimer}</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
