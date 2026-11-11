import type { AuditReport } from "./types";

/*
 * Where the reader was when they followed "What is this?" from the page drawer
 * to the guide: the open report, the inspected page and the row they clicked.
 * The guide offers a way back, and the results view reopens the drawer there.
 * Kept in memory only (reports can be far too large for sessionStorage), so it
 * lasts until the app is reloaded.
 */
export type ReturnPoint = {
  report: AuditReport;
  /** Saved report file name; "" for an uploaded file. */
  selected: string;
  pageUrl: string;
  /** Path shown on the back button. */
  path: string;
  /** Page-data row to scroll back to. */
  row: string;
};

let current: ReturnPoint | null = null;

export const setReturnPoint = (point: ReturnPoint) => { current = point; };
export const peekReturnPoint = () => current;
export const clearReturnPoint = () => { current = null; };
