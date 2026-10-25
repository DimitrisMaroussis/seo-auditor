import { type ReactNode } from "react";

/** A keyboard key, e.g. <K>Ctrl</K>+<K>U</K>. */
export const K = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-[0.8em] font-medium text-slate-700 shadow-[0_1px_0_rgb(0_0_0/0.08)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">{children}</kbd>
);

/** Text the reader looks for or types, e.g. <T>{'<title'}</T>. */
export const T = ({ children }: { children: ReactNode }) => (
  <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{children}</span>
);

export interface GuideIssue {
  code: string;      // issue code reported by the auditor
  meaning: ReactNode;
  fix: ReactNode;
}

export interface GuideSection {
  id: string;
  title: string;
  techId?: string;   // section id in the developer page ("check-<id>")
  what: ReactNode;
  why: ReactNode;
  looksAt: ReactNode[];
  issues: GuideIssue[];
  selfCheck: ReactNode[];
  goodToKnow: ReactNode[];
}
