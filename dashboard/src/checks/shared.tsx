import { type ReactNode } from "react";
import type { Severity } from "../types";

export const UA = "MagentaSEOAuditor/1.0 (+https://github.com/)";

export const C = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{children}</code>
);

export const Pre = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100 dark:bg-black/50">{children}</pre>
);

export interface Code { code: string; severity: Severity; when: ReactNode }

export type Group = "pipeline" | "page" | "site";

export interface Check {
  id: string;
  group: Group;
  title: string;
  source: string;
  summary: ReactNode;
  codes?: Code[];
  how: ReactNode[];
  verify: ReactNode[];
  wrongWhen: ReactNode[];
}
