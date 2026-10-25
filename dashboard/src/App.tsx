import { useEffect, useState } from "react";
import { dictionaries, I18n, type Lang } from "./i18n";
import ChecksDoc from "./ChecksDoc";
import Guide from "./Guide";
import ResultsPage from "./results/ResultsPage";
import VitalsPage from "./vitals/VitalsPage";
import { VITALS_STRINGS } from "./vitals/strings";
import { Icon, Segmented, cx, type IconName } from "./ui";

// "#vitals" opens Core Web Vitals; "#guide", "#g-<id>", "#gcode-<CODE>" the
// plain-language guide; "#checks", "#check-<id>", "#code-<CODE>" the developer
// reference. Anything else is the site audit.
type View = "results" | "vitals" | "guide" | "checks";
const viewForHash = (hash: string): View =>
  hash === "#vitals" ? "vitals"
    : /^#(guide$|g-|gcode-)/.test(hash) ? "guide"
    : /^#(checks$|check-|code-)/.test(hash) ? "checks"
    : "results";

type Theme = "light" | "dark";

const readPref = <T extends string>(key: string, allowed: T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const savePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

export default function App() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light");
  const [lang, setLang] = useState<Lang>(() => readPref<Lang>("lang", ["en", "el"], "el"));
  const t = dictionaries[lang];

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    savePref("theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    savePref("lang", lang);
  }, [lang]);

  const [hash, setHash] = useState(() => window.location.hash);
  const view = viewForHash(hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Tab title follows the view.
  useEffect(() => {
    const names: Record<View, string> = { results: t.nav.results, vitals: VITALS_STRINGS[lang].tab, guide: t.nav.guide, checks: t.nav.checks };
    document.title = `${names[view]} · ${t.appTitle}`;
  }, [view, lang, t]);

  // After switching views, scroll to the anchor (it did not exist before the switch).
  useEffect(() => {
    const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [view, hash]);

  const tabs: { id: View; href: string; label: string; icon: IconName }[] = [
    { id: "results", href: "#", label: t.nav.results, icon: "audit" },
    { id: "vitals", href: "#vitals", label: VITALS_STRINGS[lang].tab, icon: "gauge" },
    { id: "guide", href: "#guide", label: t.nav.guide, icon: "book" },
    { id: "checks", href: "#checks", label: t.nav.checks, icon: "code" }
  ];

  const goResults = (e: React.MouseEvent) => {
    e.preventDefault();
    history.pushState(null, "", window.location.pathname);
    setHash("");
  };

  return (
    <I18n.Provider value={{ lang, t }}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-7xl items-stretch gap-3 px-4 sm:gap-8 sm:px-6">
          <a href="#" onClick={goResults} className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50">
            <span aria-hidden className="h-5 w-5 rounded-[3px] bg-brand-500" />
            <span className="font-display hidden text-lg font-bold text-slate-900 md:inline dark:text-white">{t.appTitle}</span>
          </a>

          <nav aria-label={t.appTitle} className="-mx-1 flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto px-1 [scrollbar-width:none] sm:gap-4">
            {tabs.map(tab => {
              const active = view === tab.id;
              return (
                <a key={tab.id} href={tab.href} aria-current={active ? "page" : undefined} title={tab.label}
                  onClick={tab.id === "results" ? goResults : undefined}
                  className={cx(
                    "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 sm:px-0.5",
                    active
                      ? "border-brand-500 text-slate-900 dark:text-white"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white")}>
                  <Icon name={tab.icon} className={cx("h-4 w-4 sm:hidden", active && "text-brand-500")} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 self-center">
            <Segmented<Lang> label={t.language} size="sm" value={lang} onChange={setLang} options={[
              { value: "el", label: "ΕΛ", title: "Ελληνικά" },
              { value: "en", label: "EN", title: "English" }
            ]} />
            <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t.page.theme} title={theme === "dark" ? t.theme.light : t.theme.dark}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">
              <Icon name={theme === "dark" ? "sun" : "moon"} className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
        {view === "vitals" ? <VitalsPage />
          : view === "guide" ? <Guide />
          : view === "checks" ? <ChecksDoc />
          : <ResultsPage />}
      </main>
    </I18n.Provider>
  );
}
