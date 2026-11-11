import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuditEvent } from "./types";
import { useI18n } from "./i18n";
import { Button, Card, Icon, Notice, Segmented, Spinner, cx, inputClass } from "./ui";

type Mode = "site" | "page";

interface Progress {
  phase: "starting" | "sitemap" | "crawl" | "pages" | "siteChecks";
  done: number;
  total: number;
  url?: string;
}

// Firewall allowlisting settings, remembered on this computer.
const ALLOWLIST_KEY = "auditAllowlist";
type Allowlist = { userAgent: string; headerName: string; headerValue: string };
const readAllowlist = (): Allowlist => {
  try {
    return { userAgent: "", headerName: "", headerValue: "", ...JSON.parse(localStorage.getItem(ALLOWLIST_KEY) || "{}") };
  } catch {
    return { userAgent: "", headerName: "", headerValue: "" };
  }
};

export default function AuditForm({ onFinished }: { onFinished: (file: string) => void }) {
  const { t } = useI18n();
  const a = t.audit;
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("site");
  const [maxPages, setMaxPages] = useState("20");
  const [checkLinks, setCheckLinks] = useState(true);
  const [checkExternalLinks, setCheckExternalLinks] = useState(true);
  const [checkImages, setCheckImages] = useState(true);
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [crawl, setCrawl] = useState(true);
  const [allowlist, setAllowlist] = useState(readAllowlist);
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(allowlist.userAgent || allowlist.headerName));
  useEffect(() => {
    try { localStorage.setItem(ALLOWLIST_KEY, JSON.stringify(allowlist)); } catch { /* storage unavailable */ }
  }, [allowlist]);
  const setAllow = (key: keyof Allowlist) => (e: React.ChangeEvent<HTMLInputElement>) => setAllowlist(a => ({ ...a, [key]: e.target.value }));
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = progress !== null;

  const stop = () => {
    controller.current?.abort();
  };

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    // Accept "insurancemarket.gr" by assuming https://
    const target = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;

    controller.current = new AbortController();
    setProgress({ phase: "starting", done: 0, total: 0 });

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: target,
          mode,
          maxUrls: mode === "site" && maxPages ? Number(maxPages) : undefined,
          checkLinks,
          checkExternalLinks,
          checkImages,
          includeSubdomains,
          crawl: mode === "site" && crawl,
          userAgent: allowlist.userAgent.trim() || undefined,
          siteHeader: allowlist.headerName.trim() ? { name: allowlist.headerName.trim(), value: allowlist.headerValue.trim() } : undefined
        }),
        signal: controller.current.signal
      });

      if (res.status === 409) throw new Error(a.busy);
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? a.unreachable);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AuditEvent;
          if (event.type === "phase") {
            setProgress(p => ({ phase: event.phase, done: p?.done ?? 0, total: event.total ?? p?.total ?? 0, url: p?.url }));
          } else if (event.type === "progress") {
            setProgress(p => ({ phase: p?.phase === "crawl" ? "crawl" : "pages", done: event.done, total: event.total, url: event.url }));
          } else if (event.type === "done") {
            setMessage({ tone: "ok", text: a.finished });
            onFinished(event.file);
            finished = true;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const text = aborted ? a.stopped
        : err instanceof TypeError ? a.unreachable
        : err instanceof Error ? err.message : String(err);
      setMessage({ tone: "error", text });
    } finally {
      setProgress(null);
      controller.current = null;
    }
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const phaseText = progress
    ? progress.phase === "starting" ? a.starting
      : progress.phase === "pages" ? `${a.phases.pages} · ${progress.done} / ${progress.total}`
      : progress.phase === "crawl" ? `${a.phases.crawl} · ${a.crawled(progress.done)}`
      : a.phases[progress.phase]
    : "";

  return (
    <Card className="mb-6 p-4 sm:p-5">
      <form onSubmit={run}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1" htmlFor="audit-url">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{a.urlLabel}</span>
            <span className="relative block">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="audit-url" type="text" inputMode="url" required value={url} disabled={running}
                onChange={e => setUrl(e.target.value)} placeholder="https://www.insurancemarket.gr/" className={cx(inputClass, "pl-9")} />
            </span>
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{a.modeLabel}</span>
            <Segmented<Mode> label={a.modeLabel} value={mode} onChange={setMode} options={[
              { value: "site", label: a.modeSite, title: a.modeSiteHint, disabled: running },
              { value: "page", label: a.modePage, title: a.modePageHint, disabled: running }
            ]} />
          </div>

          {mode === "site" && (
            <label className="lg:w-32" htmlFor="audit-max" title={a.maxPagesHint}>
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{a.maxPages}</span>
              <input id="audit-max" type="number" min={1} value={maxPages} disabled={running}
                onChange={e => setMaxPages(e.target.value)} placeholder="∞" className={inputClass} />
            </label>
          )}

          {running
            ? <Button onClick={stop} icon="x">{a.stop}</Button>
            : <Button type="submit" variant="primary" icon="audit">{a.run}</Button>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input id="audit-links" type="checkbox" checked={checkLinks} disabled={running}
              onChange={e => setCheckLinks(e.target.checked)} className="h-4 w-4 rounded accent-brand-500" />
            {a.checkLinks}
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2" title={a.checkExternalHint}>
            <input id="audit-external" type="checkbox" checked={checkExternalLinks} disabled={running}
              onChange={e => setCheckExternalLinks(e.target.checked)} className="h-4 w-4 rounded accent-brand-500" />
            {a.checkExternal}
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input id="audit-images" type="checkbox" checked={checkImages} disabled={running}
              onChange={e => setCheckImages(e.target.checked)} className="h-4 w-4 rounded accent-brand-500" />
            {a.checkImages}
          </label>
          {mode === "site" && (
            <label className="inline-flex cursor-pointer items-center gap-2" title={a.crawlHint}>
              <input id="audit-crawl" type="checkbox" checked={crawl} disabled={running}
                onChange={e => setCrawl(e.target.checked)} className="h-4 w-4 rounded accent-brand-500" />
              {a.crawl}
            </label>
          )}
          {mode === "site" && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input id="audit-subdomains" type="checkbox" checked={includeSubdomains} disabled={running}
                onChange={e => setIncludeSubdomains(e.target.checked)} className="h-4 w-4 rounded accent-brand-500" />
              {a.includeSubdomains}
            </label>
          )}
          {mode === "site" && !maxPages && <span className="text-xs text-slate-500 dark:text-slate-400">{a.largeSiteTip}</span>}
        </div>

        <div className="mt-3">
          <button type="button" onClick={() => setAdvancedOpen(o => !o)} aria-expanded={advancedOpen}
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-slate-300 dark:hover:text-white">
            <Icon name="chevron" className={cx("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")} />
            {a.advanced}
            {(allowlist.userAgent || allowlist.headerName) && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
          </button>
          {advancedOpen && (
            <div className="mt-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <p className="mb-3 max-w-prose text-xs text-slate-500 dark:text-slate-400">{a.advancedIntro}</p>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <label htmlFor="audit-ua" className="min-w-0">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{a.userAgent}</span>
                  <input id="audit-ua" type="text" value={allowlist.userAgent} disabled={running} onChange={setAllow("userAgent")}
                    placeholder="MagentaSEOAuditor/1.0 (+https://github.com/)" spellCheck={false} className={cx(inputClass, "font-mono text-[13px]")} />
                </label>
                <fieldset className="min-w-0">
                  <legend className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{a.siteHeader}</legend>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input aria-label={a.headerName} type="text" value={allowlist.headerName} disabled={running} onChange={setAllow("headerName")}
                      placeholder={a.headerName} spellCheck={false} className={cx(inputClass, "font-mono text-[13px] sm:w-56")} />
                    <input aria-label={a.headerValue} type="password" value={allowlist.headerValue} disabled={running} onChange={setAllow("headerValue")}
                      placeholder={a.headerValue} autoComplete="off" className={cx(inputClass, "min-w-0 flex-1 font-mono text-[13px]")} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{a.headerNote}</p>
                </fieldset>
              </div>
            </div>
          )}
        </div>
      </form>

      {running && (
        <div className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/40" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-medium"><Spinner />{phaseText}</span>
            {progress?.phase === "pages" && <span className="tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className={cx("h-full rounded-full bg-brand-500 transition-all duration-300", progress?.phase !== "pages" && "w-1/3 animate-pulse")}
              style={progress?.phase === "pages" ? { width: `${pct}%` } : undefined} />
          </div>
          {progress?.url && <p className="mt-2 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{progress.url}</p>}
        </div>
      )}

      {message && <Notice tone={message.tone === "ok" ? "success" : "danger"} className="mt-4">{message.text}</Notice>}
    </Card>
  );
}
