// Shape of the JSON written by the auditor CLI (src/audit.js → runAudit).
// Only the fields the dashboard reads are typed.

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface GoogleFeature {
  type: string;
  rule: string;
  feature: string;
  verdict: "requiredPropertiesPresent" | "missingRequiredProperties" | "restricted" | "deprecated";
  statusNote: string | null;
  errors: string[];
  warnings: string[];
}

export interface PageResult {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  redirectChain: RedirectHop[];
  responseTimeMs: number | null;
  contentType: string | null;
  xRobotsTag: { raw: string | null };
  fetchError: { code: string; message: string } | null;
  blocked: { vendor: string } | null;
  title: { text: string | null; length: number };
  metaDescription: { text: string | null; length: number };
  canonical: { url: string | null; count: number };
  metaRobots: { name: string; content: string }[];
  h1: { count: number; texts: string[] };
  images: { count: number; missingAlt: { src: string | null }[]; emptyAlt: number; urls?: string[] };
  links: { internal: string[]; external: string[] };
  /** Email, phone, javascript: and unreadable links on the page; absent in older saved reports. */
  otherLinks?: {
    invalidEmail: { href: string; reason: string }[];
    invalidPhone: { href: string; reason: string }[];
    javascript: string[];
    malformed: { href: string; reason: string }[];
  };
  structuredData: {
    blockCount: number;
    types: string[];
    jsonSyntax: { invalid: number };
    google: { features: GoogleFeature[] };
  } | null;
  inSitemap: boolean | null;
  indexability: { indexable: boolean; reasons: string[]; canonicalStatus: string } | null;
  analyzed: boolean;
  issues: Issue[];
}

export interface SiteChecks {
  duplicateTitles: { value: string; urls: string[] }[];
  duplicateDescriptions: { value: string; urls: string[] }[];
  missingCanonical: string[];
  canonicalIssues: { canonical: string; sources: string[]; problems: string[] }[];
  unverifiedCanonicals?: { canonical: string; sources: string[]; reason: string }[];
  indexabilityConflicts: { url: string; conflicts: string[] }[];
  blockedPages?: { url: string; vendor: string }[];
  brokenInternalLinks: { url: string; status: number | null; error?: string; sources: string[] }[];
  redirectingInternalLinks: { url: string; finalUrl: string; hops: number; sources: string[] }[];
  // Added with the external link and image checks; absent in older saved reports.
  brokenExternalLinks?: LinkFinding[];
  unverifiedExternalLinks?: LinkFinding[];
  invalidEmailDomains?: { domain: string; sources: string[] }[];
  brokenImages?: LinkFinding[];
  unverifiedImages?: LinkFinding[];
  linkCheck: {
    checked: number; skipped: boolean;
    externalChecked?: number; externalSkipped?: boolean; emailDomainsChecked?: number;
    imagesChecked?: number; imagesSkipped?: boolean;
  };
}

/** A link or image that failed a network check; reason is "HTTP 404", "ENOTFOUND", "not an image (text/html)"… */
export interface LinkFinding {
  url: string;
  status: number | null;
  reason: string;
  sources: string[];
}

export interface AuditReport {
  generatedAt: string;
  mode?: "site" | "page";
  rootUrl: string;
  sitemap: { urlCount: number; sitemaps: unknown[]; errors: { url: string; error: string }[]; outOfScope: string[] };
  summary: {
    pagesAudited: number;
    fetchFailures: number;
    blockedByBotProtection?: number;
    errors: number;
    warnings: number;
    info: number;
    brokenInternalLinks: number;
  };
  site: SiteChecks;
  pages: PageResult[];
}

export interface ReportFile {
  name: string;
  size: number;
  modified: string;
}

// ---------- Core Web Vitals (src/vitals) ----------

export type VitalId = "lcp" | "inp" | "cls" | "fcp" | "ttfb";
export type Rating = "good" | "needs-improvement" | "poor";

export interface FieldMetric {
  p75: number | null;
  rating: Rating | null;
  distribution: { good: number | null; needsImprovement: number | null; poor: number | null };
}

export interface FieldRecord {
  period: { from: string | null; to: string | null } | null;
  metrics: Partial<Record<VitalId, FieldMetric>>;
  lcpSubparts: { ttfb?: number | null; loadDelay?: number | null; loadDuration?: number | null; renderDelay?: number | null } | null;
  lcpResourceType: Record<string, number> | null;
}

export interface FieldHistory {
  periods: string[];
  metrics: Partial<Record<VitalId, (number | null)[]>>;
}

export interface FieldDevice { current: FieldRecord | null; history: FieldHistory | null }
export interface FieldScope { mobile: FieldDevice; desktop: FieldDevice }

export interface LabFinding {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue: string | null;
  savings: Record<string, number>;
  metrics: string[];
  items: { label: string; timeMs?: number; bytes?: number; snippet?: string }[];
}

export interface LabResult {
  requestedUrl: string | null;
  finalUrl: string | null;
  redirected: boolean;
  lighthouseVersion: string | null;
  performanceScore: number | null;
  lab: { fcp: number | null; lcp: number | null; tbt: number | null; cls: number | null; si: number | null };
  lcp: { element: { snippet: string | null; selector: string | null; label: string | null } | null; breakdown: { subpart: string; label: string; durationMs: number }[] };
  thirdParties: { name: string; mainThreadMs: number; transferBytes: number }[];
  findings: LabFinding[];
  warnings: string[];
  challengeSuspected: boolean;
}

export interface VitalsReport {
  type: "vitals";
  generatedAt: string;
  requestedUrl: string;
  finalUrl: string;
  origin: string;
  field: { page: FieldScope | null; site: FieldScope | null };
  lab: { mobile: LabResult | null; desktop: LabResult | null };
  errors: { source: string; status: number | null; message: string }[];
}

// Events streamed by POST /api/audit (one JSON object per line).
export type AuditEvent =
  | { type: "phase"; phase: "sitemap" | "pages" | "siteChecks"; total?: number }
  | { type: "progress"; done: number; total: number; url: string; status: number | string | null }
  | { type: "done"; file: string }
  | { type: "error"; message: string };
