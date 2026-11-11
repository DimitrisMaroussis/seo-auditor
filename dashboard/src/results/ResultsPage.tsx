import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuditReport, LinkFinding, PageResult, ReportFile, Severity, SiteChecks } from "../types";
import { issueLabels, useI18n, type Dict, type Lang } from "../i18n";
import AuditForm from "../AuditForm";
import { GUIDE_CODE_TO_SECTION } from "../Guide";
import { clearReturnPoint, peekReturnPoint, setReturnPoint } from "../returnPoint";
import { Button, Card, Icon, LoadingCard, Notice, PageHeader, Segmented, SeverityPill, cx, inputClass, reportLabel, type IconName } from "../ui";

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

  // Back from the guide after "What is this?": reopen the same report and page.
  const [back] = useState(peekReturnPoint);
  useEffect(() => clearReturnPoint(), []);

  const [reportList, setReportList] = useState<ReportFile[]>([]);
  const [selected, setSelected] = useState(back?.selected ?? "");
  const [report, setReport] = useState<AuditReport | null>(back?.report ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PageResult | null>(() => back?.report.pages.find(pg => pg.requestedUrl === back.pageUrl) ?? null);
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

  // A restored uploaded report has no file name; keep it rather than opening the newest saved one.
  useEffect(() => { refreshReports(back?.selected); }, [refreshReports, back]);

  useEffect(() => {
    if (!selected || (back && selected === back.selected && report === back.report)) return;
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

      {detail && report && (() => {
        const root = report.rootUrl.replace(/\/$/, "") + "/";
        return <PageDetail page={detail} site={report.site} root={root} onClose={() => setDetail(null)}
          initialRow={back?.pageUrl === detail.requestedUrl ? back.row : undefined}
          onExplain={row => setReturnPoint({ report, selected, pageUrl: detail.requestedUrl, path: pathOf(detail.requestedUrl, root), row })} />;
      })()}
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
  const urlList = (urls: string[]) => linkList(urls.map(u => <li key={u} className="break-all">{path(u)}</li>));
  if (site.sitemapRobotsBlocked) checks.push({ key: "sitemapRobots", title: s.sitemapRobotsBlocked, severity: "warning",
    count: site.sitemapRobotsBlocked.length, body: urlList(site.sitemapRobotsBlocked) });
  const crawl = site.crawl;
  if (crawl) {
    // Orphans are only known when the crawl reached every linked page.
    if (crawl.complete) checks.push({ key: "orphans", title: s.orphans, severity: "warning", count: crawl.orphans.length, body: urlList(crawl.orphans) });
    if (report.sitemap.urlCount > 0) checks.push({ key: "notInSitemap", title: s.notInSitemap, severity: "info", count: crawl.notInSitemap.length, body: urlList(crawl.notInSitemap) });
    checks.push({ key: "deep", title: s.deep, severity: "info", count: crawl.deep.length, body: linkList(crawl.deep.map(p => (
      <li key={p.url}><span className="font-mono text-slate-500">{s.depthOf(p.depth)}</span> <span className="break-all">{path(p.url)}</span></li>))) });
    checks.push({ key: "robotsBlocked", title: s.robotsBlocked, severity: "info", count: crawl.robotsBlocked.length, body: linkList(crawl.robotsBlocked.map(l => (
      <li key={l.url}><span className="break-all">{path(l.url)}</span> <span className="text-slate-500">· {t.linkedFrom(l.sources.length)}</span></li>))) });
  }
  // Most serious first; within a severity, the order above.
  const failing = checks.filter(c => c.count > 0).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const passed = checks.filter(c => c.count === 0);

  return (
    <section className="min-w-0">
      <h2 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{t.siteChecks}</h2>
      <p className={`mt-1 text-sm ${muted}`}>{t.page.siteChecksLede}</p>
      {crawl && !crawl.complete && <Notice tone="info" className="mt-3">{s.crawlIncomplete(crawl.pagesReached)}</Notice>}
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

/** Outcome of a check: a failed check's severity, passed, or not checked / information only. */
type Status = Severity | "pass" | "none";
const STATUS_ORDER: Status[] = ["error", "warning", "info", "pass", "none"];
const STATUS_DOT: Record<Status, string> = {
  error: "var(--sev-error)", warning: "var(--sev-warning)", info: "var(--sev-info)", pass: "var(--sev-clean)", none: "var(--sev-failed)"
};
const STATUS_TEXT: Record<Status, string> = {
  error: "text-red-600 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-300",
  info: "text-sky-700 dark:text-sky-300",
  pass: "text-emerald-700 dark:text-emerald-400",
  none: muted
};

const WHY_BORDER: Record<Status, string> = {
  error: "border-red-400 dark:border-red-500/60",
  warning: "border-amber-400 dark:border-amber-500/60",
  info: "border-sky-400 dark:border-sky-500/60",
  pass: "border-emerald-400",
  none: "border-slate-300 dark:border-slate-700"
};

/** The most serious status in the list, or `fallback` when it is empty. */
const worstStatus = (statuses: Status[], fallback: Status): Status =>
  statuses.reduce((w, s) => STATUS_ORDER.indexOf(s) < STATUS_ORDER.indexOf(w) ? s : w, fallback);

function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span aria-hidden className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: STATUS_DOT[status] }} />;
}

type RowKey = keyof Dict["detail"]["hints"] | "structuredData" | "other";

/** A failed check, shown under the page-data row it belongs to. */
type Finding = { severity: Severity; label: string; message?: string; code?: string };

/** The page-data row an issue code is about; null for codes no row covers. */
function rowFor(code: string): RowKey | null {
  if (code === "FETCH_FAILED" || code === "HTTP_STATUS") return "status";
  if (code === "REDIRECT") return "redirects";
  if (code === "NOT_HTML") return "contentType";
  if (code === "ROBOTS_CONFLICT") return "xRobots";
  if (code === "BLOCKED_BY_BOT_PROTECTION") return "blocked";
  if (code === "NOT_IN_SITEMAP" || code === "SITEMAP_ROBOTS_BLOCKED") return "inSitemap";
  if (code === "ORPHAN_PAGE" || code === "DEEP_PAGE") return "crawl";
  if (code === "MAILTO_INVALID" || code === "TEL_INVALID" || code === "EMAIL_DOMAIN_INVALID") return "links";
  const prefixes: [string, RowKey][] = [
    ["TITLE_", "title"], ["DESCRIPTION_", "description"], ["H1_", "h1"], ["CANONICAL_", "canonical"],
    ["IMG_", "images"], ["LINK_", "links"], ["JSONLD_", "structuredData"]
  ];
  return prefixes.find(([p]) => code.startsWith(p))?.[1] ?? null;
}

/** Every failed check on the page, by row: the page's own issues plus the site-wide checks that name it. */
function pageFindings(page: PageResult, site: SiteChecks, lang: Lang, d: Dict["detail"]) {
  const found: Partial<Record<RowKey, Finding[]>> = {};
  const add = (key: RowKey, f: Finding) => (found[key] ??= []).push(f);
  const f = d.found;
  const here = page.finalUrl;

  page.issues.forEach(i => add(rowFor(i.code) ?? "other",
    { severity: i.severity, code: i.code, label: issueLabels[lang][i.code] ?? i.code, message: i.message }));

  const dupTitle = site.duplicateTitles.find(g => here !== null && g.urls.includes(here));
  if (dupTitle) add("title", { severity: "warning", label: f.dupTitle(dupTitle.urls.length - 1) });
  const dupDescription = site.duplicateDescriptions.find(g => here !== null && g.urls.includes(here));
  if (dupDescription) add("description", { severity: "warning", label: f.dupDescription(dupDescription.urls.length - 1) });
  site.canonicalIssues.filter(c => here !== null && c.sources.includes(here))
    .forEach(c => add("canonical", { severity: "warning", label: f.canonicalTarget, message: c.problems.join("; ") }));

  if (page.indexability && !page.indexability.indexable) {
    add("indexable", { severity: "info", label: f.notIndexable, message: page.indexability.reasons.join("; ") });
  }
  if (page.metaRobots.some(m => /noindex/i.test(m.content))) add("metaRobots", { severity: "info", label: f.noindex });
  if (/noindex/i.test(page.xRobotsTag.raw ?? "")) add("xRobots", { severity: "info", label: f.noindex });

  const conflict = site.indexabilityConflicts.find(c => c.url === page.requestedUrl);
  if (conflict) add("inSitemap", { severity: "warning", label: f.sitemapConflict, message: conflict.conflicts.join("; ") });
  return found;
}

/** Label with a hover / focus explanation of what the field is and why it matters. */
function HintLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <span tabIndex={0} className="group/hint relative inline-flex cursor-help items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50">
      <span className="underline decoration-slate-300 decoration-dotted underline-offset-4 dark:decoration-slate-600">{label}</span>
      <Icon name="info" className="h-3.5 w-3.5 opacity-60" />
      <span role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-72 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover/hint:visible group-hover/hint:opacity-100 group-focus/hint:visible group-focus/hint:opacity-100 dark:bg-slate-700">
        {hint}
      </span>
    </span>
  );
}

/** Why a row passed or failed: each failed check in its severity colour, or one line saying what passed. */
function Verdict({ findings, status, passText, onExplain }: { findings: Finding[]; status: Status; passText: string; onExplain?: () => void }) {
  const { t } = useI18n();
  if (findings.length === 0) {
    return (
      <p className={cx("mt-1 flex items-start gap-1.5 text-xs", STATUS_TEXT[status])}>
        {status === "pass" && <Icon name="check" className="mt-px h-3.5 w-3.5" />}{passText}
      </p>
    );
  }
  return (
    <ul className="mt-1 space-y-1">
      {findings.map((f, n) => (
        <li key={n} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
          <span className={cx("font-medium", STATUS_TEXT[f.severity])}>{f.label}</span>
          {f.message && <span className={muted}>— {f.message}</span>}
          {f.code && GUIDE_CODE_TO_SECTION[f.code] && (
            <a href={`#gcode-${f.code}`} onClick={onExplain} className="font-medium text-brand-600 hover:underline dark:text-brand-300">{t.page.whatIsThis}</a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Absolute URL for a src as written in the page, normalised like the auditor's checks (no fragment). */
function resolveUrl(src: string, base: string | null): string {
  try {
    const url = new URL(src, base ?? undefined);
    url.hash = "";
    return url.href;
  } catch {
    return src;
  }
}

/** One check on an element: its outcome, a short result, and for problems why it matters. */
type ElementNote = { status: Status; text: ReactNode; why?: string };
type ElementRow = { key: string; kind: string; target: string; href?: string; html?: string; notes: ElementNote[]; status: Status };

const elementRow = (r: Omit<ElementRow, "status">): ElementRow => ({ ...r, status: worstStatus(r.notes.map(n => n.status), "none") });

/**
 * Every link and image element on the page with the outcome of each check. Network results come
 * from the site-wide lists (each records the pages it was found on); alt text, email, phone and
 * unreadable links come from the page itself. Reports saved before elements were recorded fall
 * back to one row per distinct URL.
 */
function pageElements(page: PageResult, site: SiteChecks, root: string, e: Dict["detail"]["elements"]) {
  const here = page.finalUrl;
  const check = site.linkCheck;
  const onPage = <T extends { url: string; sources: string[] }>(items: T[] | undefined) =>
    new Map((items ?? []).filter(i => here !== null && i.sources.includes(here)).map(i => [i.url, i]));

  const brokenInternal = onPage(site.brokenInternalLinks);
  const redirecting = onPage(site.redirectingInternalLinks);
  const brokenExternal = onPage(site.brokenExternalLinks);
  const refusedExternal = onPage(site.unverifiedExternalLinks);
  const brokenImages = onPage(site.brokenImages);
  const refusedImages = onPage(site.unverifiedImages);
  const badDomains = onPage(site.invalidEmailDomains?.map(x => ({ ...x, url: x.domain.toLowerCase() })));
  const other = page.otherLinks;

  const internalNote = (url: string): ElementNote => {
    const b = brokenInternal.get(url), r = redirecting.get(url);
    return b ? { status: "error", text: b.status ? `HTTP ${b.status}` : b.error ?? e.broken, why: e.why.brokenInternal }
      : r ? { status: "info", text: <>{e.redirectsTo} {pathOf(r.finalUrl, root)}</>, why: e.why.redirect }
      : check.skipped ? { status: "none", text: e.notChecked } : { status: "pass", text: e.works };
  };
  const externalNote = (url: string): ElementNote => {
    const b = brokenExternal.get(url), r = refusedExternal.get(url);
    return b ? { status: "error", text: b.reason, why: e.why.brokenExternal }
      : r?.reason === "ETIMEDOUT" ? { status: "info", text: e.timedOut, why: e.why.timedOut }
      : r ? { status: "info", text: e.refused, why: e.why.refused }
      : check.externalSkipped !== false ? { status: "none", text: e.notChecked } : { status: "pass", text: e.works };
  };
  // mailto:, tel:, javascript:, #anchors and other schemes, judged by the href as written.
  const otherNote = (href: string): [string, ElementNote] => {
    if (href.startsWith("#")) return [e.kinds.anchor, { status: "none", text: e.anchor }];
    if (/^mailto:/i.test(href)) {
      const bad = other?.invalidEmail.find(l => l.href === href);
      const domain = /@([^?&,>\s]+)/.exec(href)?.[1]?.toLowerCase();
      return [e.kinds.email, bad ? { status: "warning", text: bad.reason, why: e.why.email }
        : domain && badDomains.has(domain) ? { status: "warning", text: e.noDomain, why: e.why.emailDomain } : { status: "pass", text: e.valid }];
    }
    if (/^(tel|sms):/i.test(href)) {
      const bad = other?.invalidPhone.find(l => l.href === href);
      return [e.kinds.phone, bad ? { status: "warning", text: bad.reason, why: e.why.phone } : { status: "pass", text: e.valid }];
    }
    if (/^javascript:/i.test(href)) return [e.kinds.js, { status: "info", text: e.jsLink, why: e.why.js }];
    return [e.kinds.link, { status: "none", text: e.notChecked }];
  };

  const links: ElementRow[] = page.links.all
    ? page.links.all.map(a => {
      const base = { key: `a-${a.index}`, html: a.html, target: a.href, href: a.url ?? undefined };
      if (a.kind === "internal" && a.url) return elementRow({ ...base, kind: e.kinds.internal, notes: [internalNote(a.url)] });
      if (a.kind === "external" && a.url) return elementRow({ ...base, kind: e.kinds.external, notes: [externalNote(a.url)] });
      if (a.kind === "other") {
        const [kind, note] = otherNote(a.href);
        return elementRow({ ...base, kind, notes: [note] });
      }
      const bad = other?.malformed.find(l => l.href === a.href);
      return elementRow({ ...base, kind: e.kinds.link, notes: [{ status: "warning", text: bad?.reason ?? e.unreadable, why: e.why.malformed }] });
    })
    : [
      ...page.links.internal.map(url => elementRow({ key: `i-${url}`, kind: e.kinds.internal, target: pathOf(url, root), href: url, notes: [internalNote(url)] })),
      ...page.links.external.map(url => elementRow({ key: `x-${url}`, kind: e.kinds.external, target: url, href: url, notes: [externalNote(url)] })),
      ...([[other?.invalidEmail, e.kinds.email, e.why.email], [other?.invalidPhone, e.kinds.phone, e.why.phone], [other?.malformed, e.kinds.link, e.why.malformed]] as const)
        .flatMap(([items, kind, why]) => (items ?? []).map((l, i) =>
          elementRow({ key: `o-${kind}-${i}`, kind, target: l.href || "href=\"\"", notes: [{ status: "warning", text: l.reason, why }] }))),
      ...(other?.javascript ?? []).map((href, i) =>
        elementRow({ key: `j-${i}`, kind: e.kinds.js, target: href, notes: [{ status: "info", text: e.jsLink, why: e.why.js }] }))
    ];

  // Network status of one image file, by its resolved URL.
  const seenFiles = new Set<string>();
  const fileNote = (url: string): ElementNote => {
    seenFiles.add(url);
    const b = brokenImages.get(url), r = refusedImages.get(url);
    return b ? { status: "error", text: b.reason, why: e.why.brokenImage }
      : r ? { status: "info", text: e.refused, why: e.why.refused }
      : check.imagesSkipped !== false ? { status: "none", text: e.fileNotChecked } : { status: "pass", text: e.loads };
  };
  const altNote = (altStatus: "missing" | "empty" | "present"): ElementNote =>
    altStatus === "missing" ? { status: "warning", text: e.altMissing, why: e.why.alt }
      : altStatus === "empty" ? { status: "pass", text: e.altEmpty }
      : { status: "pass", text: e.altPresent };

  const images: ElementRow[] = page.images.all
    ? page.images.all.map(img => {
      const url = img.src ? resolveUrl(img.src, here) : null;
      return elementRow({ key: `img-${img.index}`, kind: e.kinds.img, html: img.html, target: img.src ?? e.noSrc, href: url ?? undefined,
        notes: [url ? fileNote(url) : { status: "warning", text: e.noSrc, why: e.why.noSrc }, altNote(img.altStatus)] });
    })
    // Reports saved before every <img> was recorded: the image files, plus the ones without alt.
    : (page.images.urls ?? []).map(url => {
      const noAlt = page.images.missingAlt.some(m => m.src && resolveUrl(m.src, here) === url);
      return elementRow({ key: `img-${url}`, kind: e.kinds.img, target: pathOf(url, root), href: url,
        notes: [fileNote(url), ...(noAlt ? [altNote("missing")] : [])] });
    });
  // Files only reachable through srcset or <picture> that a check flagged.
  [...brokenImages.keys(), ...refusedImages.keys()].filter(url => !seenFiles.has(url)).forEach(url =>
    images.push(elementRow({ key: `set-${url}`, kind: e.kinds.srcset, target: pathOf(url, root), href: url, notes: [fileNote(url)] })));

  return { links, images };
}

/** An element's markup with tag, attribute names, values and text in distinct colours. */
function HtmlCode({ html }: { html: string }) {
  const end = html.indexOf(">") + 1;
  const open = end > 0 ? html.slice(0, end) : html;
  const rest = end > 0 ? html.slice(end) : "";
  const close = /<\/[\w-]+>$/.exec(rest)?.[0] ?? "";
  const text = rest.slice(0, rest.length - close.length);
  const name = /^<([\w-]+)/.exec(open)?.[1] ?? "";
  const attrs = [...open.slice(name.length + 1, open.endsWith(">") ? -1 : undefined).matchAll(/\s+([^\s=>]+)(?:="([^"]*)")?/g)];
  const punct = "text-slate-400 dark:text-slate-500";
  const tag = "text-rose-600 dark:text-rose-300";
  return (
    <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed">
      <span className={punct}>&lt;</span><span className={tag}>{name}</span>
      {attrs.map(([, attr, value], i) => (
        <Fragment key={i}>
          {" "}<span className="text-sky-700 dark:text-sky-300">{attr}</span>
          {value !== undefined && <><span className={punct}>="</span><span className="text-emerald-700 dark:text-emerald-300">{value.replace(/&quot;/g, "\"")}</span><span className={punct}>"</span></>}
        </Fragment>
      ))}
      <span className={punct}>&gt;</span>
      {text && <span className="text-slate-800 dark:text-slate-200">{text}</span>}
      {close && <><span className={punct}>&lt;/</span><span className={tag}>{close.slice(2, -1)}</span><span className={punct}>&gt;</span></>}
    </code>
  );
}

/** Collapsible list of elements under a page-data row, with counts per outcome and a problems filter. */
function ElementDropdown({ label, rows }: { label: string; rows: ElementRow[] }) {
  const { t } = useI18n();
  const e = t.detail.elements;
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState<"all" | "problems">("all");
  const id = useId();
  if (rows.length === 0) return null;
  const problem = (r: ElementRow) => r.status === "error" || r.status === "warning" || r.status === "info";
  const visible = show === "all" ? rows : rows.filter(problem);
  const counts = STATUS_ORDER.map(s => [s, rows.filter(r => r.status === s).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={id}
        className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-brand-300">
        <Icon name="chevron" className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        {label}
        <span className={`inline-flex items-center gap-2 font-normal ${muted}`}>
          {counts.map(([s, n]) => <span key={s} className="inline-flex items-center gap-1"><StatusDot status={s} className="h-1.5 w-1.5" />{n}</span>)}
        </span>
      </button>
      {open && (
        <div id={id} className="mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <div className={`flex flex-wrap items-center gap-3 text-xs ${muted}`}>
              {counts.map(([s, n]) => <span key={s} className="inline-flex items-center gap-1.5"><StatusDot status={s} />{n} {e.statusNames[s]}</span>)}
            </div>
            {rows.some(problem) && (
              <div className="ml-auto">
                <Segmented size="sm" label={label} value={show} onChange={setShow}
                  options={[{ value: "all", label: e.all }, { value: "problems", label: e.problems }]} />
              </div>
            )}
          </div>
          <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto text-[13px] dark:divide-slate-800">
            {visible.map(r => (
              <li key={r.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <StatusDot status={r.status} className="translate-y-[-1px]" />
                <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{r.kind}</span>
                {r.html ? <HtmlCode html={r.html} /> : <span className="min-w-0 flex-1 break-all font-mono text-slate-800 dark:text-slate-200">{r.target}</span>}
                <span className="flex flex-wrap items-baseline justify-end gap-x-3 text-xs">
                  {r.notes.map((n, i) => <span key={i} className={cx("break-all", STATUS_TEXT[n.status])}>{n.text}</span>)}
                  {r.href && /^https?:/i.test(r.href) && (
                    <a href={r.href} target="_blank" rel="noopener noreferrer" aria-label={e.open} title={e.open}
                      className="self-center text-slate-400 hover:text-brand-600 dark:hover:text-brand-300"><Icon name="external" className="h-3.5 w-3.5" /></a>
                  )}
                </span>
                {r.notes.some(n => n.why) && (
                  <ul className="basis-full space-y-0.5 text-xs sm:pl-[6.25rem]">
                    {r.notes.filter(n => n.why).map((n, i) => (
                      <li key={i} className={cx("border-l-2 pl-2 leading-relaxed text-slate-600 dark:text-slate-300", WHY_BORDER[n.status])}>{n.why}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PageDetail({ page, site, root, onClose, onExplain, initialRow }: {
  page: PageResult; site: SiteChecks; root: string; onClose: () => void;
  /** Called with the row's key when "What is this?" leaves for the guide. */
  onExplain: (row: string) => void;
  /** Row to scroll to on open (when coming back from the guide). */
  initialRow?: string;
}) {
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

  useEffect(() => {
    if (initialRow) document.getElementById(`detail-row-${initialRow}`)?.scrollIntoView({ block: "center" });
  }, [initialRow]);

  const found = pageFindings(page, site, lang, d);
  const elements = page.analyzed ? pageElements(page, site, root, d.elements) : null;
  // Why a row has no checks of its own: fields shown for information, or content never analysed.
  const fetched = !page.fetchError;
  const notRun = (ran: boolean) => ran ? undefined : d.found.notAnalysed;

  const row = (key: keyof Dict["detail"]["hints"], label: string, value: ReactNode, unchecked?: string, extra?: ReactNode) => {
    const findings = found[key] ?? [];
    const status = worstStatus(findings.map(f => f.severity), unchecked ? "none" : "pass");
    return (
      <div id={`detail-row-${key}`} className="grid grid-cols-[minmax(0,11rem)_1fr] gap-3 py-3 text-sm">
        <dt className={cx("flex items-start gap-2", muted)}>
          <StatusDot status={status} className="mt-1.5" />
          <HintLabel label={label} hint={d.hints[key]} />
        </dt>
        <dd className="min-w-0">
          <div className="whitespace-pre-line break-words text-slate-800 dark:text-slate-200">{value ?? "—"}</div>
          <Verdict findings={findings} status={status} passText={unchecked ?? d.pass[key]} onExplain={() => onExplain(key)} />
          {extra}
        </dd>
      </div>
    );
  };
  const heading = (text: string, status?: Status) => (
    <h3 className="mb-2 mt-7 flex items-center gap-2 text-sm font-semibold text-slate-900 first:mt-0 dark:text-white">
      {status && <StatusDot status={status} />}{text}
    </h3>
  );
  const verdictTone = (v: string) => v === "requiredPropertiesPresent" ? "text-emerald-700 dark:text-emerald-400"
    : v === "missingRequiredProperties" ? "text-red-600 dark:text-red-400" : muted;
  const sdFindings = found.structuredData ?? [];
  const sdStatus = worstStatus(sdFindings.map(f => f.severity), "pass");

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="fade-in absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={pathOf(page.requestedUrl, root)}
        className="drawer-in relative flex h-full w-full flex-col bg-white shadow-2xl dark:bg-slate-900">
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
          {heading(d.pageData)}
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            {row("status", d.status, page.fetchError ? `${page.fetchError.code}: ${page.fetchError.message}` : page.status)}
            {row("title", `${d.title} (${page.title.length})`, page.title.text, notRun(page.analyzed))}
            {row("description", `${d.description} (${page.metaDescription.length})`, page.metaDescription.text, notRun(page.analyzed))}
            {row("h1", `H1 (${page.h1.count})`, page.h1.texts.join(" / ") || null, notRun(page.analyzed))}
            {row("canonical", d.canonical, page.canonical.url, notRun(page.analyzed))}
            {row("indexable", d.indexable, page.indexability ? (page.indexability.indexable ? d.yes : d.no) : d.unknown, notRun(!!page.indexability))}
            {row("images", d.images, d.imagesValue(page.images.count, page.images.missingAlt.length, page.images.emptyAlt), notRun(page.analyzed),
              elements && <ElementDropdown label={d.elements.showImages(elements.images.length)} rows={elements.images} />)}
            {row("links", d.links, d.linksValue(page.links.internal.length, page.links.external.length), notRun(page.analyzed),
              elements && <ElementDropdown label={d.elements.showLinks(elements.links.length)} rows={elements.links} />)}
            {row("redirects", d.redirects, page.redirectChain.length ? page.redirectChain.map(h => `${h.status} → ${h.location}`).join("\n") : d.none, notRun(fetched))}
            {row("finalUrl", d.finalUrl, page.finalUrl, d.found.infoOnly)}
            {row("responseTime", d.responseTime, page.responseTimeMs != null ? `${page.responseTimeMs} ms` : null, d.found.infoOnly)}
            {row("contentType", d.contentType, page.contentType, notRun(fetched))}
            {row("metaRobots", d.metaRobots, page.metaRobots.map(m => `${m.name}: ${m.content}`).join(" | ") || null, notRun(page.analyzed))}
            {row("xRobots", d.xRobots, page.xRobotsTag.raw, notRun(fetched))}
            {row("inSitemap", d.inSitemap, page.inSitemap == null ? null : page.inSitemap ? d.yes : d.no, page.inSitemap == null ? d.found.notInAudit : undefined)}
            {row("crawl", d.crawl,
              page.crawlDepth == null ? (page.crawlDepth === null ? d.found.notReached(page.inlinks ?? 0) : null) : d.found.crawlValue(page.crawlDepth, page.inlinks ?? 0),
              page.crawlDepth === undefined ? d.found.crawlOff : undefined)}
            {row("blocked", d.blocked, page.blocked ? page.blocked.vendor : d.no, notRun(fetched))}
            {(found.other ?? []).length > 0 && (
              <div id="detail-row-other" className="grid grid-cols-[minmax(0,11rem)_1fr] gap-3 py-3 text-sm">
                <dt className={cx("flex items-start gap-2", muted)}>
                  <StatusDot status={worstStatus(found.other!.map(f => f.severity), "pass")} className="mt-1.5" />{d.found.other}
                </dt>
                <dd className="min-w-0"><Verdict findings={found.other!} status="pass" passText="" onExplain={() => onExplain("other")} /></dd>
              </div>
            )}
          </dl>

          {sd && sd.blockCount > 0 && (
            <>
              {heading(d.structuredData(sd.blockCount), sdStatus)}
              <div id="detail-row-structuredData"><Verdict findings={sdFindings} status={sdStatus} passText={d.pass.structuredData} onExplain={() => onExplain("structuredData")} /></div>
            </>
          )}
          {sd && sd.google.features.length > 0 && (
            <>
              <ul className="mt-3 space-y-2 text-sm">
                {sd.google.features.map((f, n) => (
                  <li key={n} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{f.type}</span>
                      <span className={`text-xs ${verdictTone(f.verdict)}`}>{t.verdicts[f.verdict] ?? f.verdict}</span>
                    </div>
                    {f.errors.map((m, k) => (
                      <div key={`e${k}`} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                        <Icon name="alert" className="mt-px h-3.5 w-3.5" />{m}
                      </div>
                    ))}
                    {f.warnings.map((m, k) => (
                      <div key={`w${k}`} className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                        <Icon name="info" className="mt-px h-3.5 w-3.5" />{m}
                      </div>
                    ))}
                    {f.statusNote && <div className={`mt-1 text-xs ${muted}`}>{f.statusNote}</div>}
                  </li>
                ))}
              </ul>
              <p className={`mt-3 text-xs ${muted}`}>{d.sdDisclaimer}</p>
            </>
          )}
          {sd?.blocks && sd.blocks.length > 0 && (
            <>
              <h4 className={`mb-2 mt-5 text-xs font-semibold uppercase tracking-wide ${muted}`}>{d.sdSource}</h4>
              <div className="space-y-4">
                {sd.blocks.map(b => <JsonLdBlock key={b.index} block={b} />)}
              </div>
            </>
          )}

        </div>
      </aside>
    </div>
  );
}

type SdBlock = NonNullable<NonNullable<PageResult["structuredData"]>["blocks"]>[number];

// JSON tokens: string (a key when followed by ":"), number, literal, punctuation.
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;

function highlightJson(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(JSON_TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    const [, str, colon, num, lit, punct] = m;
    if (str && colon) {
      const tone = str.startsWith("\"@") ? "text-violet-600 dark:text-violet-300" : "text-sky-700 dark:text-sky-300";
      out.push(<span key={i} className={tone}>{str}</span>, <span key={`${i}:`} className="text-slate-400 dark:text-slate-500">{colon}</span>);
    } else if (str) out.push(<span key={i} className="text-emerald-700 dark:text-emerald-300">{str}</span>);
    else if (num) out.push(<span key={i} className="text-amber-700 dark:text-amber-300">{num}</span>);
    else if (lit) out.push(<span key={i} className="text-rose-600 dark:text-rose-300">{lit}</span>);
    else if (punct) out.push(<span key={i} className="text-slate-400 dark:text-slate-500">{punct}</span>);
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** One JSON-LD script, shown as code: pretty-printed by default, or exactly as the page publishes it. */
function JsonLdBlock({ block }: { block: SdBlock }) {
  const { t } = useI18n();
  const d = t.detail;
  const formatted = block.validJson && block.data !== undefined ? JSON.stringify(block.data, null, 2) : null;
  const raw = block.raw ?? null;
  const [view, setView] = useState<"formatted" | "raw">(formatted != null ? "formatted" : "raw");
  const [copied, setCopied] = useState(false);
  const text = view === "formatted" ? formatted : raw;
  const lines = text ? text.split(/\r?\n/) : [];

  const copy = () => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <figcaption className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Icon name="code" className={`h-4 w-4 ${muted}`} />
        <span className="text-sm font-semibold text-slate-900 dark:text-white">{d.sdBlock(block.index)}</span>
        {block.types?.map(type => (
          <span key={type} className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{type}</span>
        ))}
        {!block.validJson && (
          <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {raw === "" ? d.sdEmpty : d.sdInvalid}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {formatted != null && raw != null && (
            <Segmented size="sm" label={d.sdView} value={view} onChange={setView}
              options={[{ value: "formatted", label: d.sdFormatted }, { value: "raw", label: d.sdRaw }]} />
          )}
          {text && (
            <Button size="sm" variant="ghost" icon={copied ? "check" : "copy"} onClick={copy}>{copied ? d.sdCopied : d.sdCopy}</Button>
          )}
        </div>
      </figcaption>
      {block.error && raw !== "" && (
        <p className="border-b border-red-100 bg-red-50/60 px-4 py-2 font-mono text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-300">{block.error}</p>
      )}
      {text ? (
        <pre className="max-h-[32rem] overflow-auto py-3 font-mono text-[12.5px] leading-relaxed text-slate-800 dark:text-slate-200">
          <code className="grid grid-cols-[auto_1fr]">
            {lines.map((line, n) => (
              <Fragment key={n}>
                <span className="select-none border-r border-slate-200 pl-4 pr-3 text-right text-slate-400 dark:border-slate-800 dark:text-slate-600">{n + 1}</span>
                <span className="whitespace-pre-wrap break-all pl-4 pr-4">{highlightJson(line)}{"\n"}</span>
              </Fragment>
            ))}
          </code>
        </pre>
      ) : raw !== "" && (
        <p className={`px-4 py-3 text-xs ${muted}`}>{d.sdNoSource}</p>
      )}
    </figure>
  );
}
