import { useEffect, useRef } from "react";
import { useActiveSection, scrollNavToActive } from "./useActiveSection";
import type { Severity } from "./types";
import { useI18n, type Lang } from "./i18n";
import { C, type Check, type Group } from "./checks/shared";
import { CHECKS_EN } from "./checks/en";
import { CHECKS_EL } from "./checks/el";

/*
 * "How the checks work" — reference for programmers who want to verify the
 * auditor's findings by hand. Content lives in checks/en.tsx and checks/el.tsx
 * (same section ids and issue codes in both).
 *
 * Kept as a snapshot for now: per the project owner, this page is updated in
 * one pass once the auditor's checks are finished, not on every check change.
 */

const CONTENT: Record<Lang, Check[]> = { en: CHECKS_EN, el: CHECKS_EL };

const GROUPS: Group[] = ["pipeline", "page", "site"];

const UI = {
  en: {
    nav: "Checks",
    groups: { pipeline: "Pipeline", page: "Per-page checks", site: "Site-wide checks" },
    heading: "How the checks work",
    intro: "Each section explains what the auditor reads, the exact rule it applies, how to confirm the result on the live site, and the situations where a reported issue is not a real problem. The file path under each title points to the code that implements it.",
    calloutTitle: "The most common source of false positives:",
    callout: <>the auditor reads the HTML the server sends and does not run JavaScript. Before trusting a "missing" finding, open <C>view-source:</C> + the page URL in Chrome or Edge. If the element is not there but appears in DevTools → Elements, it is added by JavaScript.</>,
    issues: "Issues it can report",
    how: "How it works",
    verify: "Check it yourself",
    wrong: "When the result can be wrong",
    severity: { error: "error", warning: "warning", info: "info" } as Record<Severity, string>
  },
  el: {
    nav: "Έλεγχοι",
    groups: { pipeline: "Ροή ελέγχου", page: "Έλεγχοι ανά σελίδα", site: "Έλεγχοι ιστότοπου" },
    heading: "Πώς λειτουργούν οι έλεγχοι",
    intro: "Κάθε ενότητα εξηγεί τι διαβάζει ο auditor, τον ακριβή κανόνα που εφαρμόζει, πώς να επιβεβαιώσεις το αποτέλεσμα στον πραγματικό ιστότοπο, και τις περιπτώσεις όπου ένα πρόβλημα που αναφέρεται δεν είναι πραγματικό. Η διαδρομή αρχείου κάτω από κάθε τίτλο δείχνει τον κώδικα που το υλοποιεί.",
    calloutTitle: "Η πιο συχνή αιτία ψευδώς θετικών:",
    callout: <>ο auditor διαβάζει το HTML που στέλνει ο server και δεν εκτελεί JavaScript. Πριν εμπιστευτείς ένα εύρημα «λείπει», άνοιξε <C>view-source:</C> + το URL της σελίδας σε Chrome ή Edge. Αν το στοιχείο δεν υπάρχει εκεί αλλά εμφανίζεται στα DevTools → Elements, προστίθεται με JavaScript.</>,
    issues: "Προβλήματα που μπορεί να αναφέρει",
    how: "Πώς λειτουργεί",
    verify: "Έλεγξέ το μόνος σου",
    wrong: "Πότε το αποτέλεσμα μπορεί να είναι λάθος",
    severity: { error: "σφάλμα", warning: "προειδοποίηση", info: "πληροφορία" } as Record<Severity, string>
  }
};

/** Map each issue code to the section that explains it, for links from the results view. */
export const CODE_TO_SECTION: Record<string, string> = Object.fromEntries(
  CHECKS_EN.flatMap(c => (c.codes ?? []).map(code => [code.code, c.id]))
);

const SEV: Record<Severity, string> = {
  error: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
};

const sectionHeading = "text-sm font-semibold text-slate-900 dark:text-white";

function CheckSection({ check, ui }: { check: Check; ui: typeof UI.en }) {
  return (
    <section id={`check-${check.id}`} className="scroll-mt-6 border-t border-slate-200 pt-8 dark:border-slate-800">
      <h3 className="font-display-soft text-xl font-semibold text-slate-900 dark:text-white">{check.title}</h3>
      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{check.source}</p>
      <p className="mt-3 max-w-prose">{check.summary}</p>

      {check.codes && (
        <div className="mt-5">
          <h4 className={sectionHeading}>{ui.issues}</h4>
          <dl className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {check.codes.map(c => (
              <div key={c.code} id={`code-${c.code}`} className="grid scroll-mt-6 gap-1 py-2 sm:grid-cols-[minmax(0,16rem)_1fr] sm:gap-4">
                <dt className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{c.code}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEV[c.severity]}`}>{ui.severity[c.severity]}</span>
                </dt>
                <dd className="text-sm">{c.when}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-5">
        <h4 className={sectionHeading}>{ui.how}</h4>
        <ul className="mt-2 max-w-prose list-disc space-y-2 pl-5 text-sm">
          {check.how.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-emerald-50 p-4 dark:bg-emerald-500/10">
          <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{ui.verify}</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {check.verify.map((item, i) => <li key={i} className="min-w-0">{item}</li>)}
          </ul>
        </div>
        <div className="min-w-0 rounded-lg bg-amber-50 p-4 dark:bg-amber-500/10">
          <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">{ui.wrong}</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {check.wrongWhen.map((item, i) => <li key={i} className="min-w-0">{item}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function ChecksDoc() {
  const { lang } = useI18n();
  const checks = CONTENT[lang];
  const ui = UI[lang];
  const ids = useRef(checks.map(c => c.id)).current;
  const active = useActiveSection(ids, "check-");
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => scrollNavToActive(navRef.current, active), [active]);

  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav ref={navRef} aria-label={ui.nav} className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        {GROUPS.map(group => (
          <div key={group} className="mb-4">
            <div className={sectionHeading}>{ui.groups[group]}</div>
            <ul className="mt-1 space-y-0.5 text-sm">
              {checks.filter(c => c.group === group).map(c => (
                <li key={c.id}>
                  <a href={`#check-${c.id}`} data-section={c.id} aria-current={active === c.id ? "location" : undefined}
                    className={`block rounded-r border-l-2 px-2 py-1 transition-colors ${active === c.id
                      ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                      : "border-transparent text-slate-700 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-brand-500/10 dark:hover:text-brand-300"}`}>
                    {c.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="min-w-0 space-y-6 [&_a]:text-brand-600 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-brand-300">
        <div className="max-w-prose">
          <h2 className="font-display text-[2rem] font-bold leading-[1.1] text-slate-900 sm:text-[2.5rem] dark:text-white">{ui.heading}</h2>
          <p className="mt-2 text-slate-600 dark:text-slate-300">{ui.intro}</p>
        </div>

        <div className="max-w-prose rounded-xl border-l-4 border-brand-500 bg-white p-4 text-sm shadow-sm dark:bg-slate-900">
          <b>{ui.calloutTitle}</b> {ui.callout}
        </div>

        {GROUPS.map(group => (
          <div key={group} className="space-y-4">
            <h2 className="font-display pt-6 text-2xl font-bold text-slate-900 dark:text-white">{ui.groups[group]}</h2>
            {checks.filter(c => c.group === group).map(c => <CheckSection key={c.id} check={c} ui={ui} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
