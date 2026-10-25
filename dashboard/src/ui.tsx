import { useId, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import type { Severity } from "./types";

/*
 * Shared UI primitives so every page looks and behaves the same.
 * Icons are inline SVG (24×24 grid, 1.75 stroke) and inherit currentColor.
 */

// ---------- icons ----------

const paths = {
  audit: "M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.44 1.06-1.06-4.44-4.43A6.5 6.5 0 0 0 10.5 4Zm-2 6.5 1.5 1.5 3-3",
  gauge: "M4.5 16.5a8 8 0 1 1 15 0M12 12l3.5-3.5M12 13.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z",
  book: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5v-12ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5v-12Z",
  code: "m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  chevron: "m9 6 6 6-6 6",
  check: "m5 12.5 4.5 4.5L19 7.5",
  alert: "M12 8.5v4.5M12 16.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  x: "M6 6l12 12M18 6 6 18",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  trash: "M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7",
  external: "M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10",
  mobile: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3ZM11 18h2",
  desktop: "M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5.5ZM9 20h6M12 16.5V20",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.5h.01",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  minus: "M5 12h14",
  file: "M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5l-4-4ZM14 3.5V7.5h4",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  plus: "M12 5v14M5 12h14",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2"
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

// ---------- layout ----------

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * Human label for a saved report file, e.g.
 * "magentainsurance.gr-vitals-2026-10-18-17-24-32.json" → "magentainsurance.gr · 18 Oct 2026, 20:24".
 * The timestamp in file names is UTC; it is shown in local time. Other names are shown as-is.
 */
export function reportLabel(name: string, locale: string): string {
  const base = name.replace(/\.json$/, "");
  const m = /^(.*)-(site|page|vitals)-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(base);
  if (!m) return base;
  const [, host, , y, mo, d, h, mi, se] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  return `${host} · ${date.toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] text-slate-900 sm:text-[2.5rem] dark:text-white">{title}</h1>
        {description && <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-slate-600 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{children}</h2>
      {aside}
    </div>
  );
}

// ---------- controls ----------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white shadow-sm hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-500/50",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
  "danger-ghost": "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
};

export function Button({ variant = "secondary", size = "md", icon, children, className, ...rest }:
  { variant?: ButtonVariant; size?: "sm" | "md"; icon?: IconName; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-4 text-sm",
        BUTTON[variant], className)}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export const inputClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500";

export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: {
  value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md";
  options: { value: T; label: ReactNode; title?: string; icon?: IconName; disabled?: boolean }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
      {options.map(o => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.title} aria-pressed={active} disabled={o.disabled}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-sm",
              active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}>
            {o.icon && <Icon name={o.icon} className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Collapsible section; content stays mounted only while open. */
export function Disclosure({ title, subtitle, aside, defaultOpen = false, children, className }: {
  title: ReactNode; subtitle?: ReactNode; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <Card className={className}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:px-5 dark:hover:bg-slate-800/40">
        <Icon name="chevron" className={cx("h-4 w-4 text-slate-400 transition-transform duration-200", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-slate-900 dark:text-white">{title}</span>
          {subtitle && <span className="mt-0.5 block text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</span>}
        </span>
        {aside}
      </button>
      {open && <div id={id} className="border-t border-slate-100 px-4 py-4 sm:px-5 dark:border-slate-800">{children}</div>}
    </Card>
  );
}

// ---------- feedback ----------

const NOTICE = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100", icon: "info" as IconName, iconColor: "text-sky-600 dark:text-sky-300" },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100", icon: "alert" as IconName, iconColor: "text-amber-600 dark:text-amber-300" },
  danger: { box: "border-red-200 bg-red-50 text-red-900 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-100", icon: "alert" as IconName, iconColor: "text-red-600 dark:text-red-300" },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100", icon: "check" as IconName, iconColor: "text-emerald-600 dark:text-emerald-300" }
};

export function Notice({ tone = "info", title, children, action, className }: {
  tone?: keyof typeof NOTICE; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  const n = NOTICE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl border px-4 py-3 text-sm", n.box, className)}>
      <Icon name={n.icon} className={cx("mt-0.5 h-4 w-4", n.iconColor)} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

const SEVERITY_DOT: Record<Severity, string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500"
};
const SEVERITY_PILL: Record<Severity, string> = {
  error: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/25",
  info: "bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-400/25"
};

export function SeverityPill({ severity, children, title }: { severity: Severity; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", SEVERITY_PILL[severity])}>
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[severity])} />
      {children}
    </span>
  );
}

/** Placeholder shown while a saved report loads, so the page never claims "empty" too early. */
export function LoadingCard({ label }: { label?: string }) {
  return (
    <Card className="flex items-center justify-center gap-3 px-6 py-14 text-sm text-slate-500 dark:text-slate-400" aria-busy="true">
      <Spinner className="h-5 w-5" />
      {label}
    </Card>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("animate-spin text-brand-500", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
