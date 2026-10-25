import { useEffect, useRef } from "react";
import type { Severity } from "./types";
import { issueLabels, useI18n, type Lang } from "./i18n";
import { useActiveSection, scrollNavToActive } from "./useActiveSection";
import { type GuideSection } from "./guide/shared";
import { GUIDE_EN } from "./guide/en";
import { GUIDE_EL } from "./guide/el";
import { CHECKS_EN } from "./checks/en";

/*
 * "Checks guide" — plain-language explanation of every check, for people who
 * use the dashboard but don't read code. Content lives in guide/en.tsx and
 * guide/el.tsx. Severity of each issue comes from the developer reference so
 * the two pages never disagree.
 *
 * Kept as a snapshot for now: per the project owner, this page is updated in
 * one pass once the auditor's checks are finished, not on every check change.
 */

const CONTENT: Record<Lang, GuideSection[]> = { en: GUIDE_EN, el: GUIDE_EL };

/** Issue code → guide section id, for links from the results view. */
export const GUIDE_CODE_TO_SECTION: Record<string, string> = Object.fromEntries(
  GUIDE_EN.flatMap(s => s.issues.map(i => [i.code, s.id]))
);

const SEVERITY_OF: Record<string, Severity> = Object.fromEntries(
  CHECKS_EN.flatMap(c => (c.codes ?? []).map(code => [code.code, code.severity]))
);

const SEV_STYLE: Record<Severity, string> = {
  error: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30",
  warning: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  info: "bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30"
};

const UI = {
  en: {
    nav: "Guide sections",
    intro: "Introduction",
    heading: "Checks guide",
    lede: "What the SEO tool checks on your website, why it matters, and what to do about each problem. No technical knowledge needed.",
    howTitle: "How the tool works",
    how: [
      "It reads your sitemap: the list of pages your website asks Google to show.",
      "It opens each of those pages, the way a browser would, and reads the page's code.",
      "It runs the checks below on every page, then compares the pages with each other.",
      "It shows the results on the Results tab and saves them so you can open them later."
    ],
    sevTitle: "What the colours mean",
    sev: {
      error: ["Error", "Something is broken or missing that very likely hurts the page in Google. Fix these first."],
      warning: ["Warning", "Something is not as it should be. Worth fixing, but less urgent."],
      info: ["Info", "A note or suggestion. Often fine as it is."]
    } as Record<Severity, [string, string]>,
    caveatTitle: "Before you report a problem",
    caveat: "The tool reads each page's code directly and doesn't run the extra scripts a browser runs. On some websites, things like the title are added by those scripts, so the tool may report them as missing even though you can see them. The \"Check it yourself\" steps in each section show how to confirm.",
    what: "What it is",
    why: "Why it matters",
    looksAt: "What the tool checks",
    problems: "Problems it can report",
    meaning: "What it means",
    fix: "What to do",
    selfCheck: "Check it yourself",
    goodToKnow: "Good to know",
    siteWideNote: "This appears in the site checks on the Results tab, not as a problem on a single page.",
    technical: "Technical details for developers"
  },
  el: {
    nav: "Ενότητες οδηγού",
    intro: "Εισαγωγή",
    heading: "Οδηγός ελέγχων",
    lede: "Τι ελέγχει το εργαλείο SEO στον ιστότοπό σου, γιατί έχει σημασία, και τι να κάνεις για κάθε πρόβλημα. Δεν χρειάζονται τεχνικές γνώσεις.",
    howTitle: "Πώς λειτουργεί το εργαλείο",
    how: [
      "Διαβάζει το sitemap σου: τη λίστα με τις σελίδες που ο ιστότοπός σου ζητά από τη Google να δείχνει.",
      "Ανοίγει καθεμία από αυτές τις σελίδες, όπως ένας browser, και διαβάζει τον κώδικά της.",
      "Τρέχει τους παρακάτω ελέγχους σε κάθε σελίδα και μετά συγκρίνει τις σελίδες μεταξύ τους.",
      "Δείχνει τα αποτελέσματα στην καρτέλα Αποτελέσματα και τα αποθηκεύει για να τα ανοίξεις αργότερα."
    ],
    sevTitle: "Τι σημαίνουν τα χρώματα",
    sev: {
      error: ["Σφάλμα", "Κάτι είναι χαλασμένο ή λείπει και πολύ πιθανόν βλάπτει τη σελίδα στη Google. Διόρθωσέ τα πρώτα."],
      warning: ["Προειδοποίηση", "Κάτι δεν είναι όπως θα έπρεπε. Αξίζει να διορθωθεί, αλλά είναι λιγότερο επείγον."],
      info: ["Πληροφορία", "Σημείωση ή πρόταση. Συχνά είναι εντάξει όπως είναι."]
    } as Record<Severity, [string, string]>,
    caveatTitle: "Πριν αναφέρεις ένα πρόβλημα",
    caveat: "Το εργαλείο διαβάζει απευθείας τον κώδικα κάθε σελίδας και δεν εκτελεί τα επιπλέον scripts που εκτελεί ένας browser. Σε κάποιους ιστότοπους, στοιχεία όπως ο τίτλος προστίθενται από αυτά τα scripts, οπότε το εργαλείο μπορεί να τα αναφέρει ως ελλείποντα ενώ εσύ τα βλέπεις. Τα βήματα «Έλεγξέ το μόνος σου» σε κάθε ενότητα δείχνουν πώς να το επιβεβαιώσεις.",
    what: "Τι είναι",
    why: "Γιατί έχει σημασία",
    looksAt: "Τι ελέγχει το εργαλείο",
    problems: "Προβλήματα που μπορεί να αναφέρει",
    meaning: "Τι σημαίνει",
    fix: "Τι να κάνεις",
    selfCheck: "Έλεγξέ το μόνος σου",
    goodToKnow: "Καλό να ξέρεις",
    siteWideNote: "Αυτό εμφανίζεται στους ελέγχους ιστότοπου της καρτέλας Αποτελέσματα, όχι ως πρόβλημα μιας μεμονωμένης σελίδας.",
    technical: "Τεχνικές λεπτομέρειες για προγραμματιστές"
  }
};

const label = "text-sm font-semibold text-slate-900 dark:text-white";

function Section({ section, ui, lang }: { section: GuideSection; ui: typeof UI.en; lang: Lang }) {
  return (
    <section id={`g-${section.id}`} className="scroll-mt-6 border-t border-slate-200 pt-8 dark:border-slate-800">
      <h3 className="font-display-soft text-2xl font-semibold text-slate-900 dark:text-white">{section.title}</h3>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <h4 className={label}>{ui.what}</h4>
          <p className="mt-1">{section.what}</p>
        </div>
        <div className="min-w-0">
          <h4 className={label}>{ui.why}</h4>
          <p className="mt-1">{section.why}</p>
        </div>
      </div>

      <div className="mt-5">
        <h4 className={label}>{ui.looksAt}</h4>
        <ul className="mt-2 max-w-prose list-disc space-y-1.5 pl-5">
          {section.looksAt.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>

      {section.issues.length > 0 ? (
        <div className="mt-5">
          <h4 className={label}>{ui.problems}</h4>
          <div className="mt-2 space-y-3">
            {section.issues.map(issue => {
              const sev = SEVERITY_OF[issue.code] ?? "info";
              return (
                <div key={issue.code} id={`gcode-${issue.code}`} className="scroll-mt-6 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEV_STYLE[sev]}`}>
                      {issueLabels[lang][issue.code] ?? issue.code}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{ui.sev[sev][0]}</span>
                  </div>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 sm:gap-4">
                    <div className="min-w-0"><dt className="font-medium">{ui.meaning}</dt><dd className="text-slate-600 dark:text-slate-300">{issue.meaning}</dd></div>
                    <div className="min-w-0"><dt className="font-medium">{ui.fix}</dt><dd className="text-slate-600 dark:text-slate-300">{issue.fix}</dd></div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-5 max-w-prose rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">{ui.siteWideNote}</p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-emerald-50 p-4 dark:bg-emerald-500/10">
          <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{ui.selfCheck}</h4>
          <ul className="mt-2 space-y-2 text-sm">{section.selfCheck.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
        <div className="min-w-0 rounded-lg bg-amber-50 p-4 dark:bg-amber-500/10">
          <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">{ui.goodToKnow}</h4>
          <ul className="mt-2 space-y-2 text-sm">{section.goodToKnow.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      </div>

      {section.techId && (
        <p className="mt-4 text-sm">
          <a href={`#check-${section.techId}`}>{ui.technical}</a>
        </p>
      )}
    </section>
  );
}

export default function Guide() {
  const { lang } = useI18n();
  const sections = CONTENT[lang];
  const ui = UI[lang];
  const ids = useRef(["intro", ...GUIDE_EN.map(s => s.id)]).current;
  const active = useActiveSection(ids, "g-");
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => scrollNavToActive(navRef.current, active), [active]);

  const navLink = (id: string, text: string) => (
    <li key={id}>
      <a href={`#g-${id}`} data-section={id} aria-current={active === id ? "location" : undefined}
        className={`block rounded-r border-l-2 px-2 py-1 transition-colors ${active === id
          ? "border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
          : "border-transparent text-slate-700 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-brand-500/10 dark:hover:text-brand-300"}`}>
        {text}
      </a>
    </li>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav ref={navRef} aria-label={ui.nav} className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        <ul className="space-y-0.5 text-sm">
          {navLink("intro", ui.intro)}
          {sections.map(s => navLink(s.id, s.title))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-6 text-[15px] leading-relaxed [&_a]:text-brand-600 [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-brand-300">
        <section id="g-intro" className="scroll-mt-6 space-y-5">
          <div className="max-w-prose">
            <h2 className="font-display text-[2rem] font-bold leading-[1.1] text-slate-900 sm:text-[2.5rem] dark:text-white">{ui.heading}</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">{ui.lede}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-semibold">{ui.howTitle}</h3>
              <ol className="mt-3 space-y-2">
                {ui.how.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-semibold">{ui.sevTitle}</h3>
              <dl className="mt-3 space-y-3">
                {(["error", "warning", "info"] as Severity[]).map(sev => (
                  <div key={sev} className="flex gap-3">
                    <dt className="shrink-0"><span className={`inline-block w-28 rounded-full px-2 py-0.5 text-center text-xs font-medium ring-1 ring-inset ${SEV_STYLE[sev]}`}>{ui.sev[sev][0]}</span></dt>
                    <dd className="text-sm text-slate-600 dark:text-slate-300">{ui.sev[sev][1]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="max-w-prose border-l-4 border-brand-500 py-1 pl-4">
            <b>{ui.caveatTitle}.</b> {ui.caveat}
          </div>
        </section>

        {sections.map(s => <Section key={s.id} section={s} ui={ui} lang={lang} />)}
      </div>
    </div>
  );
}
