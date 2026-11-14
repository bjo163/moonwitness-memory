"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { Icon } from "../components/icon";
import { MangaArchivist } from "../components/manga-archivist";
import { EmptyState, MetricCard, Panel, SectionLabel, StatusBadge } from "../components/ui";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

type Counts = { archives: number; messages: number; knowledge: number; active_jobs: number; failed_jobs: number };
type SystemStatus = {
  gemini_configured: boolean;
  gemini_model: string;
  embeddings_enabled: boolean;
  embedding_model?: string | null;
  drive_configured: boolean;
  moonwitness_sync_configured: boolean;
  max_upload_gb: number;
};
type Archive = {
  id: string;
  file_name: string;
  size_bytes: number;
  sha256?: string;
  status: string;
  drive_status: string;
  drive_key?: string | null;
  drive_error?: string | null;
  created_at: string;
};

type ArchiveSort = "newest" | "largest" | "name";
type QueueFilter = "all" | "active" | "attention" | "complete";
type Job = {
  id: string;
  archive_id: string;
  mode?: string;
  status: string;
  cursor?: number;
  attempts?: number;
  processed_conversations: number;
  total_conversations: number | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
};
type SourceMessage = { message_id: string; conversation_id: string; conversation_title: string; role: string; content: string; created_at?: string | null };
type SourceData = { knowledge_id: string; archive_id: string; conversation_id: string; messages: SourceMessage[] };
type Knowledge = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  content?: string;
  confidence: number;
  conversation_id: string;
  tags?: string[];
  entities?: string[];
  archive_id?: string;
  created_at?: string;
  updated_at?: string;
  source_message_ids?: string[];
};
type Theme = "dark" | "light";

const initialCounts: Counts = { archives: 0, messages: 0, knowledge: 0, active_jobs: 0, failed_jobs: 0 };

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return (value / Math.pow(1024, exponent)).toFixed(exponent > 1 ? 1 : 0) + " " + units[exponent];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "DATE UNKNOWN"
    : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [backupBusyId, setBackupBusyId] = useState<string | null>(null);
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("LOCAL ENGINE STANDBY");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<Knowledge | null>(null);
  const [sourceData, setSourceData] = useState<SourceData | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState<"latest" | "search">("latest");
  const [knowledgeLimit, setKnowledgeLimit] = useState(12);
  const [knowledgeKind, setKnowledgeKind] = useState("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("all");
  const [archiveDriveStatus, setArchiveDriveStatus] = useState("all");
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>("newest");
  const [archiveVisibleCount, setArchiveVisibleCount] = useState(8);
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [queueVisibleCount, setQueueVisibleCount] = useState(8);
  const sourcePanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem("mw-memory-theme"); } catch { /* Keep the preloaded theme when storage is unavailable. */ }
    const preloaded = document.documentElement.dataset.theme;
    const initial = stored === "light" || stored === "dark" ? stored : preloaded === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem("mw-memory-theme", theme); } catch { /* Theme still applies for this session. */ }
  }, [theme, themeReady]);

  useEffect(() => {
    const ids = ["overview", "vault", "queue", "knowledge"];
    const targets = ids.map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    if (!("IntersectionObserver" in window) || targets.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target instanceof HTMLElement) setActiveSection(visible.target.id);
    }, { rootMargin: "-18% 0px -66% 0px", threshold: [0, 0.1, 0.25, 0.5] });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedKnowledge) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const panel = sourcePanelRef.current;
    const getFocusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []);
    getFocusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedKnowledge(null);
        setSourceData(null);
        setSourceError(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [selectedKnowledge]);

  const refresh = useCallback(async () => {
    try {
      const [c, a, j, k, s] = await Promise.all([
        fetch(API + "/api/dashboard", { cache: "no-store" }),
        fetch(API + "/api/archives?limit=500", { cache: "no-store" }),
        fetch(API + "/api/jobs?limit=500", { cache: "no-store" }),
        fetch(API + "/api/knowledge?limit=" + knowledgeLimit, { cache: "no-store" }),
        fetch(API + "/api/system", { cache: "no-store" }),
      ]);
      if (![c, a, j, k, s].every((response) => response.ok)) throw new Error("API unavailable");
      const [nextCounts, nextArchives, nextJobs, nextKnowledge, nextSystem] = await Promise.all([
        c.json(), a.json(), j.json(), k.json(), s.json(),
      ]) as [Counts, Archive[], Job[], Knowledge[], SystemStatus];
      setCounts(nextCounts);
      setArchives(nextArchives);
      setJobs(nextJobs);
      if (knowledgeMode === "latest") setKnowledge(nextKnowledge);
      setSystem(nextSystem);
      if (apiOnline !== true) setNotice("LOCAL ENGINE ONLINE");
      setApiOnline(true);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      if (apiOnline !== false) setNotice("API OFFLINE // CHECK DOCKER COMPOSE");
      setApiOnline(false);
    }
  }, [apiOnline, knowledgeLimit, knowledgeMode]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 7000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runningJobs = jobs.filter((job) => ["pending", "processing", "retry"].includes(job.status)).length;
  const storageTotal = archives.reduce((sum, archive) => sum + archive.size_bytes, 0);
  const visibleArchives = useMemo(() => {
    const needle = archiveQuery.trim().toLowerCase();
    const filtered = archives.filter((archive) => {
      const matchesName = !needle || archive.file_name.toLowerCase().includes(needle) || archive.id.toLowerCase().includes(needle);
      const matchesStatus = archiveStatus === "all" || archive.status.toLowerCase() === archiveStatus;
      const matchesDrive = archiveDriveStatus === "all" || archive.drive_status.toLowerCase() === archiveDriveStatus;
      return matchesName && matchesStatus && matchesDrive;
    });
    return filtered.sort((a, b) => {
      if (archiveSort === "largest") return b.size_bytes - a.size_bytes;
      if (archiveSort === "name") return a.file_name.localeCompare(b.file_name);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [archives, archiveQuery, archiveStatus, archiveDriveStatus, archiveSort]);
  const visibleJobs = useMemo(() => jobs.filter((job) => {
    if (queueFilter === "active") return ["pending", "processing", "retry"].includes(job.status);
    if (queueFilter === "attention") return ["failed", "awaiting_ai"].includes(job.status);
    if (queueFilter === "complete") return job.status === "complete";
    return true;
  }), [jobs, queueFilter]);
  const visibleKnowledge = useMemo(
    () => knowledge.filter((item) => knowledgeKind === "all" || (item.kind || "concept").toLowerCase() === knowledgeKind),
    [knowledge, knowledgeKind],
  );
  const knowledgeKinds = useMemo(
    () => Array.from(new Set(knowledge.map((item) => (item.kind || "concept").toLowerCase()))).sort(),
    [knowledge],
  );

  async function handleUpload(file: File) {
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "zip" && extension !== "json") {
      setNotice("UNSUPPORTED FILE // USE .ZIP OR .JSON");
      return;
    }
    setBusy(true);
    setUploadName(file.name);
    setUploadProgress(0);
    setNotice("INGESTING // " + file.name);
    try {
      const upload = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", API + "/api/archives");
        request.responseType = "text";
        request.setRequestHeader("Content-Type", "application/octet-stream");
        request.setRequestHeader("X-Archive-Filename", encodeURIComponent(file.name));
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
          }
        });
        request.addEventListener("load", () => resolve({ status: request.status, body: request.responseText }));
        request.addEventListener("error", () => reject(new Error("UPLOAD NETWORK ERROR // CHECK API CONNECTION")));
        request.addEventListener("abort", () => reject(new Error("UPLOAD CANCELLED")));
        request.send(file);
      });
      let result: { detail?: string; duplicate?: boolean };
      try {
        result = JSON.parse(upload.body) as { detail?: string; duplicate?: boolean };
      } catch {
        throw new Error("UPLOAD FAILED // INVALID API RESPONSE");
      }
      if (upload.status < 200 || upload.status >= 300) throw new Error(result.detail || "UPLOAD FAILED");
      setUploadProgress(100);
      setNotice(result.duplicate ? "DUPLICATE // ORIGINAL ALREADY IN VAULT" : "ARCHIVE ACCEPTED // WORKER QUEUED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "UPLOAD FAILED");
    } finally {
      setBusy(false);
      setUploadProgress(null);
      setUploadName(null);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void handleUpload(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  }

  async function copyText(value: string, label: string) {
    if (!value) {
      setNotice("NOTHING TO COPY");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setNotice(label + " COPIED TO CLIPBOARD");
    } catch {
      setNotice("COPY BLOCKED BY BROWSER // SELECT THE VALUE MANUALLY");
    }
  }

  async function backup(archiveId: string) {
    setBackupBusyId(archiveId);
    try {
      const response = await fetch(API + "/api/archives/" + archiveId + "/backup", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "BACKUP FAILED");
      setNotice(result.status === "already_uploaded" ? "ALREADY BACKED UP TO DRIVE" : "DRIVE BACKUP QUEUED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "BACKUP FAILED");
    } finally {
      setBackupBusyId(null);
    }
  }

  async function resume(jobId: string) {
    setResumeBusyId(jobId);
    try {
      const response = await fetch(API + "/api/jobs/" + jobId + "/resume", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "RESUME FAILED");
      setNotice("JOB RESUMED // CHECKPOINT PRESERVED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "RESUME FAILED");
    } finally {
      setResumeBusyId(null);
    }
  }

  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!query.trim()) {
      await clearKnowledgeSearch();
      return;
    }
    setSearching(true);
    setKnowledgeMode("search");
    setKnowledgeLimit(30);
    setKnowledgeKind("all");
    try {
      const response = await fetch(API + "/api/search?q=" + encodeURIComponent(query.trim()) + "&limit=30", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "SEARCH FAILED");
      setKnowledge(result);
      setNotice("SEARCH COMPLETE // " + result.length + " MATCHES");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "SEARCH FAILED");
    } finally {
      setSearching(false);
    }
  }

  async function clearKnowledgeSearch() {
    setQuery("");
    setKnowledgeMode("latest");
    setKnowledgeLimit(12);
    setKnowledgeKind("all");
    setSearching(true);
    try {
      const response = await fetch(API + "/api/knowledge?limit=12", { cache: "no-store" });
      if (!response.ok) throw new Error("KNOWLEDGE LOAD FAILED");
      setKnowledge(await response.json());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "KNOWLEDGE LOAD FAILED");
    } finally {
      setSearching(false);
    }
  }

  async function loadMoreKnowledge() {
    const maximum = knowledgeMode === "search" ? 100 : 500;
    const nextLimit = Math.min(knowledgeLimit + 12, maximum);
    if (nextLimit <= knowledgeLimit) return;
    setLoadingMore(true);
    try {
      const endpoint = knowledgeMode === "search"
        ? API + "/api/search?q=" + encodeURIComponent(query.trim()) + "&limit=" + nextLimit
        : API + "/api/knowledge?limit=" + nextLimit;
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "MORE KNOWLEDGE FAILED");
      setKnowledge(result);
      setKnowledgeLimit(nextLimit);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "MORE KNOWLEDGE FAILED");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openSources(item: Knowledge) {
    setSelectedKnowledge(item);
    setSourceData(null);
    setSourceError(null);
    setSourceLoading(true);
    try {
      const response = await fetch(API + "/api/knowledge/" + encodeURIComponent(item.id) + "/sources", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "SOURCE LOOKUP FAILED");
      setSourceData(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "SOURCE LOOKUP FAILED";
      setSourceError(message);
      setNotice(message);
    } finally {
      setSourceLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#top" aria-label="MoonWitness Memory home">
          <span className="brand-symbol"><b>M</b><i>W</i></span>
          <span className="brand-wordmark"><strong>MOONWITNESS</strong><small>MEMORY DIVISION</small></span>
        </a>

        <div className="sidebar-rule"><span>FIELD MAP / 01</span><i /></div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className={"side-link " + (activeSection === "overview" ? "side-link--active" : "")} href="#overview" aria-current={activeSection === "overview" ? "location" : undefined}><Icon name="grid"/><span>Overview</span><kbd>01</kbd></a>
          <a className={"side-link " + (activeSection === "vault" ? "side-link--active" : "")} href="#vault" aria-current={activeSection === "vault" ? "location" : undefined}><Icon name="archive"/><span>Archive vault</span><kbd>{String(archives.length).padStart(2, "0")}</kbd></a>
          <a className={"side-link " + (activeSection === "queue" ? "side-link--active" : "")} href="#queue" aria-current={activeSection === "queue" ? "location" : undefined}><Icon name="activity"/><span>Work queue</span><kbd>{String(runningJobs).padStart(2, "0")}</kbd></a>
          <a className={"side-link " + (activeSection === "knowledge" ? "side-link--active" : "")} href="#knowledge" aria-current={activeSection === "knowledge" ? "location" : undefined}><Icon name="brain"/><span>Knowledge</span><kbd>{String(counts.knowledge).padStart(2, "0")}</kbd></a>
        </nav>

        <div className="sidebar-rule sidebar-rule--spaced"><span>ENGINE STATUS</span><i /></div>
        <div className="engine-list">
          <EngineStatus label="API CORE" status={apiOnline === null ? "checking" : apiOnline ? "online" : "offline"} />
          <EngineStatus label="GEMINI KEY" status={!system ? "checking" : system.gemini_configured ? "configured" : "missing"} />
          <EngineStatus label="LOCAL EMBEDDINGS" status={!system ? "checking" : system.embeddings_enabled ? "ready" : "optional"} />
          <EngineStatus label="DRIVE BACKUP" status={!system ? "checking" : system.drive_configured ? "configured" : "optional"} />
          <EngineStatus label="JOB PIPELINE" status={apiOnline === false ? "offline" : counts.failed_jobs > 0 ? "warning" : counts.active_jobs > 0 ? "active" : apiOnline ? "idle" : "checking"} />
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-manifest">
            <span className="manifest-mark">MW//01</span>
            <p>YOUR HISTORY<br/><b>STAYS YOURS.</b></p>
            <small>LOCAL-FIRST / PRIVATE BY DESIGN</small>
          </div>
          <div className="sidebar-foot"><span>BUILD 0.3.0</span><span>ARCHIVE RIOT</span></div>
        </div>
      </aside>

      <div className="main-frame" id="top">
        <header className="topbar">
          <div className="breadcrumb"><span>MEMORY</span><i>/</i><strong>COMMAND DECK</strong></div>
          <div className="topbar-right">
            <div className={"live-indicator " + (apiOnline === false ? "is-offline" : "")}><i/>{apiOnline ? "SYSTEM LIVE" : apiOnline === false ? "SYSTEM OFFLINE" : "CONNECTING"}</div>
            <span className="topbar-divider"/>
            <span className="last-sync"><Icon name="refresh" size={13}/>{lastUpdated ? "SYNC " + lastUpdated : "SYNC PENDING"}</span>
            <button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={"Switch to " + (theme === "dark" ? "light" : "dark") + " theme"} title="Toggle theme">
              <Icon name={theme === "dark" ? "sun" : "moon"} size={16}/>
            </button>
            <a className="api-link" href={API + "/docs"} target="_blank" rel="noreferrer"><Icon name="terminal" size={14}/> API <Icon name="arrow-up-right" size={12}/></a>
          </div>
        </header>

        <div className="content-wrap">
          <section className="hero-zone" id="overview">
            <div className="hero-panel">
              <div className="hero-noise"/>
              <div className="hero-topline"><span><i/> PERSONAL KNOWLEDGE ENGINE</span><span>MW / ARCHIVE UNIT 001</span></div>
              <div className="hero-copy">
                <p className="hero-kicker"><span>FIELD NOTE 001</span> // CHAOTIC INTELLIGENCE VAULT</p>
                <h1>KEEP THE<br/><em>SIGNAL.</em><br/><span>BURN THE NOISE.</span></h1>
                <p className="hero-description">Your conversations are raw material. Extract the stories, decisions, fragments and ideas worth keeping. Every signal keeps its source.</p>
                <div className="hero-actions">
                  <label className={"primary-action " + (busy ? "is-busy" : "")}>
                    <Icon name="upload" size={17}/>
                    <span>{busy ? "INGESTING..." : "INGEST ARCHIVE"}</span>
                    <b>↗</b>
                    <input type="file" accept=".zip,.json,application/zip,application/json" onChange={onFileChange} disabled={busy}/>
                  </label>
                  <a className="secondary-action" href="#vault">OPEN THE VAULT <Icon name="arrow-right" size={15}/></a>
                </div>
                <div className="hero-footnote"><span>CHATGPT EXPORT / ZIP + JSON</span><span>MAX {system?.max_upload_gb ?? 500} GB PER ARCHIVE</span></div>
              </div>
              <div className="hero-art-wrap">
                <div className="art-circle art-circle--one"/>
                <div className="art-circle art-circle--two"/>
                <MangaArchivist/>
                <div className="art-sticker art-sticker--top">NO<br/>LOST<br/>SIGNAL</div>
                <div className="art-sticker art-sticker--bottom"><b>01</b><span>THE<br/>ARCHIVIST</span></div>
                <span className="art-cross art-cross--one">✳</span><span className="art-cross art-cross--two">✳</span>
              </div>
              <div className="hero-side-index">M W / X — 01</div>
            </div>
            <div className="hero-underbar"><span>NOT A CHAT BACKUP. A MEMORY MACHINE.</span><span>LOCAL VAULT <b>●</b> CLOUD AI OPTIONAL</span></div>
          </section>

          <section className="metrics-grid" aria-label="Memory system metrics">
            <MetricCard index="01" label="ARCHIVES" value={counts.archives} detail={formatBytes(storageTotal) + " IN LOCAL VAULT"} tone="default"/>
            <MetricCard index="02" label="MESSAGES" value={counts.messages} detail="SOURCE MATERIAL PRESERVED" tone="acid"/>
            <MetricCard index="03" label="KNOWLEDGE NODES" value={counts.knowledge} detail="EXTRACTED & INDEXED" tone="default"/>
            <MetricCard index="04" label="ACTIVE JOBS" value={counts.active_jobs} detail={counts.failed_jobs ? counts.failed_jobs + " NEED ATTENTION" : "PIPELINE MONITORING"} tone={counts.failed_jobs ? "orange" : "default"}/>
          </section>

          <section className="workbench-grid">
            <Panel className="vault-panel" id="vault">
              <SectionLabel index="01 / INGESTION" title="THE ARCHIVE VAULT" trailing={<span className="panel-counter">{archives.length.toString().padStart(2, "0")} RECORDS</span>}/>
              <div className="vault-stat-strip">
                <div><strong>{archives.length.toLocaleString()}</strong><span>ORIGINALS</span></div>
                <div><strong>{archives.filter((archive) => archive.status === "complete").length.toLocaleString()}</strong><span>PROCESSED</span></div>
                <div><strong>{archives.filter((archive) => archive.drive_status === "uploaded").length.toLocaleString()}</strong><span>IN DRIVE</span></div>
                <div><strong className={archives.some((archive) => ["failed", "awaiting_ai"].includes(archive.status)) ? "text-orange" : ""}>{archives.filter((archive) => ["failed", "awaiting_ai"].includes(archive.status)).length.toLocaleString()}</strong><span>ATTENTION</span></div>
              </div>
              <div
                className={"drop-zone " + (dragging ? "drop-zone--active" : "") + (busy ? "drop-zone--busy" : "")}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={onDrop}
                aria-label="Drop a ChatGPT archive to import"
              >
                <div className="drop-icon"><Icon name="folder" size={23}/><span>+</span></div>
                <div className="drop-copy"><strong>{busy ? "ARCHIVE IN TRANSMISSION..." : dragging ? "DROP IT. WE'LL SORT IT." : "DROP YOUR HISTORY HERE"}</strong><span>ZIP EXPORT OR CONVERSATIONS.JSON</span></div>
                <span className="drop-hint">DRAG / DROP</span>
              </div>
              {busy && uploadProgress !== null && (
                <div className="upload-progress" role="status" aria-live="polite">
                  <div className="upload-progress__meta"><span>{uploadName || "ARCHIVE"} // TRANSMISSION</span><strong>{uploadProgress}%</strong></div>
                  <div className="upload-progress__track" role="progressbar" aria-label="Archive upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}><i style={{ width: uploadProgress + "%" }}/></div>
                  <small>{uploadProgress === 100 ? "ARCHIVE RECEIVED // QUEUING WORKER" : "STREAMING DIRECTLY TO LOCAL VAULT"}</small>
                </div>
              )}
              <div className="vault-toolbar">
                <label className="vault-search"><Icon name="search" size={15}/><input value={archiveQuery} onChange={(event) => { setArchiveQuery(event.target.value); setArchiveVisibleCount(8); }} placeholder="Find an archive or ID..." aria-label="Search archives"/>{archiveQuery && <button type="button" onClick={() => setArchiveQuery("")} aria-label="Clear archive search"><Icon name="close" size={13}/></button>}</label>
                <div className="vault-selects">
                  <label><span>PROCESS</span><select value={archiveStatus} onChange={(event) => { setArchiveStatus(event.target.value); setArchiveVisibleCount(8); }} aria-label="Filter archives by processing status">
                    <option value="all">ALL STATUS</option>
                    {Array.from(new Set(archives.map((archive) => archive.status.toLowerCase()))).sort().map((status) => <option key={status} value={status}>{status.replaceAll("_", " ").toUpperCase()}</option>)}
                  </select></label>
                  <label><span>DRIVE</span><select value={archiveDriveStatus} onChange={(event) => { setArchiveDriveStatus(event.target.value); setArchiveVisibleCount(8); }} aria-label="Filter archives by Drive status">
                    <option value="all">ALL DRIVE</option>
                    {Array.from(new Set(archives.map((archive) => archive.drive_status.toLowerCase()))).sort().map((status) => <option key={status} value={status}>{status.replaceAll("_", " ").toUpperCase()}</option>)}
                  </select></label>
                  <label><span>SORT</span><select value={archiveSort} onChange={(event) => setArchiveSort(event.target.value as ArchiveSort)} aria-label="Sort archives">
                    <option value="newest">NEWEST</option><option value="largest">LARGEST</option><option value="name">NAME A–Z</option>
                  </select></label>
                </div>
              </div>
              <div className="vault-list-heading"><span>ARCHIVE RECORDS / {visibleArchives.length} MATCHES</span><span>{formatBytes(storageTotal)} STORED</span></div>
              <div className="archive-list">
                {visibleArchives.length === 0 ? (
                  <EmptyState icon={<Icon name="archive" size={22}/>} title={archives.length ? "NO ARCHIVE MATCH" : "THE VAULT IS QUIET"} detail={archives.length ? "Change the name search or status filters to find another archive." : "Import your first ChatGPT export. Original files stay on this machine."}/>
                ) : visibleArchives.slice(0, archiveVisibleCount).map((archive, index) => (
                  <ArchiveRow
                    key={archive.id}
                    archive={archive}
                    index={String(index + 1).padStart(2, "0")}
                    driveReady={Boolean(system?.drive_configured)}
                    busy={backupBusyId === archive.id}
                    expanded={expandedArchiveId === archive.id}
                    onToggleDetails={() => setExpandedArchiveId(expandedArchiveId === archive.id ? null : archive.id)}
                    onCopy={(value, label) => void copyText(value, label)}
                    onBackup={() => void backup(archive.id)}
                  />
                ))}
              </div>
              {visibleArchives.length > archiveVisibleCount && <button className="load-more-button vault-load-more" onClick={() => setArchiveVisibleCount((count) => Math.min(count + 8, visibleArchives.length))}>SHOW MORE ARCHIVES <Icon name="arrow-down" size={13}/></button>}
              <div className="panel-tail"><span>ORIGINALS ARE NEVER MODIFIED</span><span>SHOWING {Math.min(archiveVisibleCount, visibleArchives.length)} / {visibleArchives.length} <i>↗</i></span></div>
            </Panel>

            <Panel className="queue-panel" id="queue">
              <SectionLabel index="02 / OPERATIONS" title="THE WORK QUEUE" trailing={<span className="queue-live"><i/> LIVE / 7 SEC</span>}/>
              <div className="queue-summary">
                <div><strong>{runningJobs.toString().padStart(2, "0")}</strong><span>IN MOTION</span></div>
                <div><strong className={counts.failed_jobs ? "text-orange" : ""}>{counts.failed_jobs.toString().padStart(2, "0")}</strong><span>NEED REPAIR</span></div>
                <div><strong>{jobs.filter((job) => job.status === "complete").length.toString().padStart(2, "0")}</strong><span>COMPLETE</span></div>
              </div>
              <div className="queue-filters" role="group" aria-label="Filter worker jobs">
                {(["all", "active", "attention", "complete"] as QueueFilter[]).map((filter) => (
                  <button key={filter} type="button" className={queueFilter === filter ? "queue-filter queue-filter--active" : "queue-filter"} onClick={() => { setQueueFilter(filter); setQueueVisibleCount(8); }}>
                    {filter === "all" ? "ALL" : filter === "active" ? "ACTIVE" : filter === "attention" ? "NEEDS ATTENTION" : "COMPLETE"}
                    <span>{filter === "all" ? jobs.length : filter === "active" ? runningJobs : filter === "attention" ? jobs.filter((job) => ["failed", "awaiting_ai"].includes(job.status)).length : jobs.filter((job) => job.status === "complete").length}</span>
                  </button>
                ))}
              </div>
              <div className="job-list">
                {visibleJobs.length === 0 ? (
                  <EmptyState icon={<Icon name="activity" size={22}/>} title={queueFilter === "attention" ? "NO JOBS NEED REPAIR" : "NO TRANSMISSIONS HERE"} detail={queueFilter === "all" ? "Ingest an archive to start the extraction pipeline." : "Switch the queue filter to inspect other job states."}/>
                ) : visibleJobs.slice(0, queueVisibleCount).map((job, index) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    archiveName={archives.find((archive) => archive.id === job.archive_id)?.file_name}
                    index={String(index + 1).padStart(2, "0")}
                    busy={resumeBusyId === job.id}
                    onResume={() => void resume(job.id)}
                  />
                ))}
              </div>
              {visibleJobs.length > queueVisibleCount && <button className="load-more-button queue-load-more" onClick={() => setQueueVisibleCount((count) => Math.min(count + 8, visibleJobs.length))}>MORE JOBS <Icon name="arrow-down" size={13}/></button>}
              <div className="queue-foot"><span><i className="legend-dot legend-dot--lime"/> PROCESSING</span><span><i className="legend-dot legend-dot--orange"/> ATTENTION</span><span><i className="legend-dot legend-dot--grey"/> WAITING</span></div>
            </Panel>
          </section>

          <section className="knowledge-section" id="knowledge">
            <div className="knowledge-heading">
              <div><p className="section-kicker">03 / EXTRACTED INTELLIGENCE</p><h2>THE KNOWLEDGE <em>PILE.</em></h2><p>Fragments with a pulse. Every record keeps a trail back to its source.</p></div>
              <a className="export-button" href={API + "/api/export.ndjson"}><Icon name="file" size={17}/><span>EXPORT CORPUS</span><Icon name="arrow-up-right" size={14}/></a>
            </div>
            <Panel className="knowledge-panel">
              <form className="search-bar" onSubmit={(event) => void search(event)}>
                <div className="search-mark"><Icon name="search" size={18}/></div>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your universe — lore, decisions, people, fragments..." aria-label="Search knowledge"/>
                {query && <button className="clear-search" type="button" onClick={() => void clearKnowledgeSearch()} aria-label="Clear search"><Icon name="close" size={15}/></button>}
                <button className="search-submit" type="submit" disabled={searching}>{searching ? "SCANNING..." : "SCAN THE PILE"} <Icon name="arrow-up-right" size={13}/></button>
              </form>
              <div className="knowledge-controls">
                <label className="kind-filter"><span>TYPE / FILTER</span>
                  <select value={knowledgeKind} onChange={(event) => setKnowledgeKind(event.target.value)} aria-label="Filter knowledge by type">
                    <option value="all">ALL TYPES</option>
                    {knowledgeKinds.map((kind) => <option value={kind} key={kind}>{kind.replaceAll("_", " ").toUpperCase()}</option>)}
                  </select>
                </label>
                <span className="knowledge-result-count">{visibleKnowledge.length} VISIBLE / {knowledge.length} LOADED</span>
              </div>
              <div className="knowledge-grid">
                {knowledge.length === 0 ? (
                  <EmptyState icon={<Icon name="brain" size={23}/>} title={query ? "NO SIGNAL MATCH" : "NOTHING EXTRACTED YET"} detail={query ? "Try another term. Search checks both full-text and local semantic vectors." : system?.gemini_configured ? "The first archive is waiting to become knowledge." : "Add GEMINI_API_KEY in .env and restart the API + worker to enable extraction."}/>
                ) : visibleKnowledge.length === 0 ? (
                  <EmptyState icon={<Icon name="filter" size={23}/>} title="NO NODES IN THIS TYPE" detail="Switch the type filter to ALL TYPES or choose another category."/>
                ) : visibleKnowledge.map((item, index) => <KnowledgeCard key={item.id} item={item} index={String(index + 1).padStart(2, "0")} onOpen={() => void openSources(item)}/>)}
              </div>
              <div className="knowledge-actions">
                <div className="knowledge-tail"><span>LOCAL INDEX / FTS5 + LANCEDB</span><span>{knowledge.length} RECORDS LOADED <b>✳</b></span></div>
                {knowledge.length >= knowledgeLimit && knowledgeLimit < (knowledgeMode === "search" ? 100 : 500) && (
                  <button className="load-more-button" onClick={() => void loadMoreKnowledge()} disabled={loadingMore || searching}>
                    {loadingMore ? "FETCHING MORE..." : "LOAD MORE SIGNAL"} <Icon name="arrow-down" size={13}/>
                  </button>
                )}
              </div>
            </Panel>
          </section>

          <footer className="main-footer">
            <div className="footer-brand"><span className="footer-stamp">MW</span><span>MOONWITNESS MEMORY <b>/ ARCHIVE RIOT</b></span></div>
            <span>PRIVATE BY DESIGN / LOCAL DATA / CLOUD AI WHEN CONFIGURED</span>
            <span>END OF TRANSMISSION <i>✳</i></span>
          </footer>
        </div>
      </div>

      {selectedKnowledge && (
        <div className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
          <button className="source-modal__backdrop" onClick={() => { setSelectedKnowledge(null); setSourceData(null); }} aria-label="Close source details"/>
          <section className="source-modal__panel" ref={sourcePanelRef} tabIndex={-1}>
            <div className="source-modal__top"><span>PROVENANCE / KNOWLEDGE NODE</span><button onClick={() => { setSelectedKnowledge(null); setSourceData(null); }} aria-label="Close source details"><Icon name="close" size={17}/></button></div>
            <div className="source-modal__heading"><span>{selectedKnowledge.kind.toUpperCase()} / {Math.round(selectedKnowledge.confidence * 100)}% CONFIDENCE</span><h2 id="source-modal-title">{selectedKnowledge.title}</h2><p>{selectedKnowledge.summary}</p></div>
            <div className="knowledge-node-meta"><span>NODE / {selectedKnowledge.id.slice(0, 16).toUpperCase()}</span><span>CONVERSATION / {selectedKnowledge.conversation_id.slice(0, 16).toUpperCase()}</span><span>CREATED / {selectedKnowledge.created_at ? formatDate(selectedKnowledge.created_at) : "UNKNOWN"}</span></div>
            <div className="knowledge-node-content">
              <div className="knowledge-node-content__top"><span>EXTRACTED RECORD / FULL TEXT</span><button onClick={() => void copyText(selectedKnowledge.content || selectedKnowledge.summary || selectedKnowledge.title, "KNOWLEDGE NODE")}>COPY NODE ↗</button></div>
              <p>{selectedKnowledge.content || selectedKnowledge.summary || "No extracted content was stored for this node."}</p>
            </div>
            {((selectedKnowledge.tags?.length ?? 0) > 0 || (selectedKnowledge.entities?.length ?? 0) > 0) && (
              <div className="knowledge-node-taxonomy">
                {Boolean(selectedKnowledge.tags?.length) && <div><span>TAGS</span><div>{selectedKnowledge.tags?.map((tag) => <b key={tag}>{tag}</b>)}</div></div>}
                {Boolean(selectedKnowledge.entities?.length) && <div><span>ENTITIES</span><div>{selectedKnowledge.entities?.map((entity) => <b key={entity}>{entity}</b>)}</div></div>}
              </div>
            )}
            <div className="source-modal__trail"><span>ARCHIVE / {sourceData?.archive_id.slice(0, 12).toUpperCase() ?? "RESOLVING..."}</span><span>CONVERSATION / {sourceData?.conversation_id.slice(0, 12).toUpperCase() ?? selectedKnowledge.conversation_id.slice(0, 12).toUpperCase()}</span></div>
            {sourceLoading ? <EmptyState icon={<Icon name="refresh" size={20}/>} title="TRACING THE SIGNAL" detail="Resolving this knowledge node back to its original messages..."/> : sourceError ? (
              <div className="source-error" role="alert"><Icon name="alert" size={22}/><strong>TRACE INTERRUPTED</strong><p>{sourceError}</p><button onClick={() => void openSources(selectedKnowledge)}>RETRY SOURCE TRACE ↗</button></div>
            ) : (
              <div className="source-message-list">
                {(sourceData?.messages ?? []).length === 0 ? <EmptyState icon={<Icon name="alert" size={20}/>} title="SOURCE NOT FOUND" detail="No original messages were returned for this knowledge node."/> : sourceData?.messages.map((message) => (
                  <article className="source-message" key={message.message_id}>
                    <div><span>{message.role.toUpperCase()}</span><small>{message.created_at ? formatDate(message.created_at) : "TIMESTAMP UNKNOWN"}</small></div>
                    <small className="source-message__conversation">{message.conversation_title}</small>
                    <p>{message.content}</p>
                    <small>MESSAGE ID / {message.message_id}</small>
                  </article>
                ))}
              </div>
            )}
            <div className="source-modal__foot"><span>{sourceData?.messages.length ?? selectedKnowledge.source_message_ids?.length ?? 0} SOURCE MESSAGES / PROVENANCE</span><button onClick={() => void copyText(selectedKnowledge.id, "KNOWLEDGE ID")}>COPY NODE ID ↗</button></div>
          </section>
        </div>
      )}
      <div className={"notice-toast " + (apiOnline === false ? "notice-toast--warning" : "")} role="status" aria-live="polite">
        <span className="toast-symbol">{apiOnline === false ? "!" : "MW"}</span><span>{notice}</span>
      </div>
    </main>
  );
}

function EngineStatus({ label, status }: { label: string; status: "online" | "offline" | "idle" | "checking" | "warning" | "active" | "ready" | "configured" | "missing" | "optional" }) {
  const labels: Record<typeof status, string> = {
    online: "ONLINE", offline: "OFFLINE", idle: "IDLE", checking: "CHECKING",
    warning: "ATTENTION", active: "ACTIVE", ready: "READY", configured: "CONFIGURED", missing: "SETUP", optional: "OPTIONAL",
  };
  return <div className="engine-status"><span>{label}</span><b className={"engine-status__value engine-status__value--" + status}><i/>{labels[status]}</b></div>;
}

function ArchiveRow({ archive, index, driveReady, busy, expanded, onToggleDetails, onCopy, onBackup }: {
  archive: Archive;
  index: string;
  driveReady: boolean;
  busy: boolean;
  expanded: boolean;
  onToggleDetails: () => void;
  onCopy: (value: string, label: string) => void;
  onBackup: () => void;
}) {
  return (
    <article className={"archive-row " + (expanded ? "archive-row--expanded" : "")}>
      <span className="row-index">{index}</span>
      <div className="archive-file-icon"><Icon name="file" size={18}/><small>{archive.file_name.toLowerCase().endsWith(".json") ? "JSON" : "ZIP"}</small></div>
      <div className="archive-row__main"><strong title={archive.file_name}>{archive.file_name}</strong><span>{formatBytes(archive.size_bytes)} <i>·</i> {formatDate(archive.created_at)}</span></div>
      <div className="archive-row__status"><StatusBadge status={archive.status}/><StatusBadge status={archive.drive_status} prefix="DRIVE / "/></div>
      <button className="row-action archive-details-toggle" type="button" onClick={onToggleDetails} aria-expanded={expanded}>{expanded ? "CLOSE" : "DETAILS"}</button>
      {archive.drive_status !== "uploaded" && (
        <button className="row-action" onClick={onBackup} disabled={!driveReady || busy} title={driveReady ? "Queue Google Drive backup" : "Configure Google Drive first"}>
          {busy ? "..." : driveReady ? "BACKUP" : "DRIVE OFF"}
        </button>
      )}
      {expanded && (
        <div className="archive-row__details">
          <div className="archive-detail"><span>ARCHIVE ID</span><code>{archive.id}</code><button onClick={() => onCopy(archive.id, "ARCHIVE ID")}>COPY</button></div>
          <div className="archive-detail"><span>SHA-256 / ORIGINAL FINGERPRINT</span><code>{archive.sha256 || "NOT AVAILABLE"}</code>{archive.sha256 && <button onClick={() => onCopy(archive.sha256 || "", "SHA-256")}>COPY</button>}</div>
          <div className="archive-detail"><span>DRIVE OBJECT</span><code>{archive.drive_key || "NOT BACKED UP"}</code>{archive.drive_key && <button onClick={() => onCopy(archive.drive_key || "", "DRIVE KEY")}>COPY</button>}</div>
          {archive.drive_error && <p className="archive-drive-error"><Icon name="alert" size={13}/>{archive.drive_error}</p>}
        </div>
      )}
    </article>
  );
}

function JobRow({ job, archiveName, index, busy, onResume }: { job: Job; archiveName?: string; index: string; busy: boolean; onResume: () => void }) {
  const total = job.total_conversations ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((job.processed_conversations / total) * 100)) : 0;
  const canResume = ["awaiting_ai", "retry", "failed"].includes(job.status);
  const mode = job.mode === "backup_only" ? "DRIVE BACKUP" : "KNOWLEDGE EXTRACTION";
  return (
    <article className="job-row">
      <span className="row-index">{index}</span>
      <div className="job-row__main">
        <div className="job-title-line"><strong>{mode}</strong><StatusBadge status={job.status}/></div>
        <div className="job-meta"><span title={archiveName || job.archive_id}>{archiveName || "ARCHIVE / " + job.archive_id.slice(0, 8).toUpperCase()}</span><span>{job.processed_conversations.toLocaleString()} {total > 0 ? "/ " + total.toLocaleString() : ""} CONVERSATIONS</span></div>
        {total > 0 ? <div className="progress-track" role="progressbar" aria-label={"Job progress " + progress + "%"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: progress + "%" }}/></div> : <div className="job-task-state">{job.mode === "backup_only" ? "DRIVE OBJECT TRANSFER" : "WAITING FOR CONVERSATION SCAN"}</div>}
        <div className="job-secondary-meta"><span>JOB / {job.id.slice(0, 8).toUpperCase()}</span><span>ATTEMPTS / {job.attempts ?? 0}</span>{job.updated_at && <span>UPDATED / {formatDate(job.updated_at)}</span>}</div>
        {job.error && <p className="job-error"><Icon name="alert" size={12}/>{job.error}</p>}
      </div>
      {canResume && <button className="resume-action" onClick={onResume} disabled={busy}>{busy ? "..." : "RESUME ↗"}</button>}
    </article>
  );
}

function KnowledgeCard({ item, index, onOpen }: { item: Knowledge; index: string; onOpen: () => void }) {
  const kind = (item.kind || "concept").toLowerCase();
  const confidence = Math.max(0, Math.min(100, Math.round((item.confidence ?? 0) * 100)));
  return (
    <button type="button" className={"knowledge-card knowledge-card--" + kind} onClick={onOpen} aria-label={"Inspect knowledge record and source messages for " + item.title}>
      <div className="knowledge-card__top"><span className="knowledge-index">{index} / {kind}</span><span className="confidence">{confidence}% <i>CONF.</i></span></div>
      <span className="knowledge-card__slash"/>
      <h3>{item.title}</h3>
      <p>{item.summary || "No summary supplied. Open the source trail to inspect the extracted fragment."}</p>
      {(item.tags?.length ?? 0) > 0 && <div className="knowledge-card__tags">{item.tags?.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
      <div className="knowledge-card__bottom"><span>SOURCE / {item.conversation_id.slice(0, 12).toUpperCase()}</span><span>↗</span></div>
    </button>
  );
}
