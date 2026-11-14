"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { Icon } from "../components/icon";
import { MangaArchivist } from "../components/manga-archivist";
import { ActionButton, EmptyState, MetricCard, Panel, SectionLabel, StatusBadge } from "../components/ui";

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
type Job = {
  id: string;
  archive_id: string;
  mode?: string;
  status: string;
  cursor?: number;
  processed_conversations: number;
  total_conversations: number | null;
  error: string | null;
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

function initials(value: string) {
  return value.slice(0, 2).toUpperCase();
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
  const sourcePanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("mw-memory-theme");
    const preloaded = document.documentElement.dataset.theme;
    const initial = stored === "light" || stored === "dark" ? stored : preloaded === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mw-memory-theme", theme);
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
        fetch(API + "/api/archives", { cache: "no-store" }),
        fetch(API + "/api/jobs", { cache: "no-store" }),
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

  const recentArchives = useMemo(() => archives.slice(0, 5), [archives]);
  const recentJobs = useMemo(() => jobs.slice(0, 5), [jobs]);
  const runningJobs = jobs.filter((job) => ["pending", "processing", "retry"].includes(job.status)).length;
  const storageTotal = archives.reduce((sum, archive) => sum + archive.size_bytes, 0);
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
    setNotice("INGESTING // " + file.name);
    try {
      const response = await fetch(API + "/api/archives", {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Archive-Filename": encodeURIComponent(file.name),
        },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Upload failed");
      setNotice(result.duplicate ? "DUPLICATE // ORIGINAL ALREADY IN VAULT" : "ARCHIVE ACCEPTED // WORKER QUEUED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "UPLOAD FAILED");
    } finally {
      setBusy(false);
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
      await refresh();
      return;
    }
    setSearching(true);
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
    <main className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <a className="brand-lockup" href="#top" aria-label="MoonWitness Memory home">
          <span className="brand-symbol"><b>M</b><i>W</i></span>
          <span className="brand-wordmark"><strong>MOONWITNESS</strong><small>MEMORY DIVISION</small></span>
        </a>

        <div className="sidebar-rule"><span>FIELD MAP / 01</span><i /></div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="side-link side-link--active" href="#overview"><Icon name="grid"/><span>Overview</span><kbd>01</kbd></a>
          <a className="side-link" href="#vault"><Icon name="archive"/><span>Archive vault</span><kbd>{String(archives.length).padStart(2, "0")}</kbd></a>
          <a className="side-link" href="#queue"><Icon name="activity"/><span>Work queue</span><kbd>{String(runningJobs).padStart(2, "0")}</kbd></a>
          <a className="side-link" href="#knowledge"><Icon name="brain"/><span>Knowledge</span><kbd>{String(counts.knowledge).padStart(2, "0")}</kbd></a>
        </nav>

        <div className="sidebar-rule sidebar-rule--spaced"><span>ENGINE STATUS</span><i /></div>
        <div className="engine-list">
          <EngineStatus label="API CORE" status={apiOnline ? "online" : apiOnline === false ? "offline" : "checking"} />
          <EngineStatus label="GEMINI EXTRACTOR" status={system?.gemini_configured ? "online" : "idle"} />
          <EngineStatus label="LOCAL EMBEDDINGS" status={system?.embeddings_enabled ? "online" : "idle"} />
          <EngineStatus label="DRIVE GATEWAY" status={system?.drive_configured ? "online" : "idle"} />
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
            <Panel className="vault-panel" >
              <SectionLabel index="01 / INGESTION" title="THE ARCHIVE VAULT" trailing={<span className="panel-counter">{archives.length.toString().padStart(2, "0")} RECORDS</span>}/>
              <div
                className={"drop-zone " + (dragging ? "drop-zone--active" : "") + (busy ? "drop-zone--busy" : "")}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={onDrop}
              >
                <div className="drop-icon"><Icon name="folder" size={23}/><span>+</span></div>
                <div className="drop-copy"><strong>{busy ? "ARCHIVE IN TRANSMISSION..." : dragging ? "DROP IT. WE'LL SORT IT." : "DROP YOUR HISTORY HERE"}</strong><span>ZIP EXPORT OR CONVERSATIONS.JSON</span></div>
                <span className="drop-hint">DRAG / DROP</span>
              </div>
              <div className="list-heading"><span>RECENT CAPTURES</span><a href="#vault">VIEW ALL <Icon name="arrow-up-right" size={12}/></a></div>
              <div className="archive-list" id="vault">
                {recentArchives.length === 0 ? (
                  <EmptyState icon={<Icon name="archive" size={22}/>} title="THE VAULT IS QUIET" detail="Import your first ChatGPT export. Original files stay on this machine."/>
                ) : recentArchives.map((archive, index) => (
                  <ArchiveRow
                    key={archive.id}
                    archive={archive}
                    index={String(index + 1).padStart(2, "0")}
                    driveReady={Boolean(system?.drive_configured)}
                    busy={backupBusyId === archive.id}
                    onBackup={() => void backup(archive.id)}
                  />
                ))}
              </div>
              <div className="panel-tail"><span>ORIGINALS ARE NEVER MODIFIED</span><span>{archives.length} TOTAL ARCHIVES <i>↗</i></span></div>
            </Panel>

            <Panel className="queue-panel" >
              <SectionLabel index="02 / OPERATIONS" title="THE WORK QUEUE" trailing={<span className="queue-live"><i/> LIVE / 7 SEC</span>}/>
              <div className="queue-summary">
                <div><strong>{runningJobs.toString().padStart(2, "0")}</strong><span>IN MOTION</span></div>
                <div><strong className={counts.failed_jobs ? "text-orange" : ""}>{counts.failed_jobs.toString().padStart(2, "0")}</strong><span>NEED REPAIR</span></div>
                <div><strong>{counts.active_jobs.toString().padStart(2, "0")}</strong><span>IN QUEUE</span></div>
              </div>
              <div className="job-list" id="queue">
                {recentJobs.length === 0 ? (
                  <EmptyState icon={<Icon name="activity" size={22}/>} title="NO ACTIVE TRANSMISSIONS" detail="Ingest an archive to start the extraction pipeline."/>
                ) : recentJobs.map((job, index) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    index={String(index + 1).padStart(2, "0")}
                    busy={resumeBusyId === job.id}
                    onResume={() => void resume(job.id)}
                  />
                ))}
              </div>
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
                {query && <button className="clear-search" type="button" onClick={() => { setQuery(""); void refresh(); }} aria-label="Clear search"><Icon name="close" size={15}/></button>}
                <button className="search-submit" type="submit" disabled={searching}>{searching ? "SCANNING..." : "SCAN THE PILE"} <Icon name="arrow-up-right" size={13}/></button>
              </form>
              <div className="knowledge-grid">
                {knowledge.length === 0 ? (
                  <EmptyState icon={<Icon name="brain" size={23}/>} title={query ? "NO SIGNAL MATCH" : "NOTHING EXTRACTED YET"} detail={query ? "Try another term. Search checks both full-text and local semantic vectors." : system?.gemini_configured ? "The first archive is waiting to become knowledge." : "Add GEMINI_API_KEY in .env and restart the API + worker to enable extraction."}/>
                ) : knowledge.slice(0, 9).map((item, index) => <KnowledgeCard key={item.id} item={item} index={String(index + 1).padStart(2, "0")} onOpen={() => void openSources(item)}/>)}
              </div>
              <div className="knowledge-tail"><span>LOCAL INDEX / FTS5 + LANCEDB</span><span>{knowledge.length} RECORDS SHOWN <b>✳</b></span></div>
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
          <section className="source-modal__panel">
            <div className="source-modal__top"><span>PROVENANCE / KNOWLEDGE NODE</span><button onClick={() => { setSelectedKnowledge(null); setSourceData(null); }} aria-label="Close source details"><Icon name="close" size={17}/></button></div>
            <div className="source-modal__heading"><span>{selectedKnowledge.kind.toUpperCase()} / {Math.round(selectedKnowledge.confidence * 100)}% CONFIDENCE</span><h2 id="source-modal-title">{selectedKnowledge.title}</h2><p>{selectedKnowledge.summary}</p></div>
            <div className="source-modal__trail"><span>ARCHIVE / {sourceData?.archive_id.slice(0, 12).toUpperCase() ?? "RESOLVING..."}</span><span>CONVERSATION / {sourceData?.conversation_id.slice(0, 12).toUpperCase() ?? selectedKnowledge.conversation_id.slice(0, 12).toUpperCase()}</span></div>
            {sourceLoading ? <EmptyState icon={<Icon name="refresh" size={20}/>} title="TRACING THE SIGNAL" detail="Resolving this knowledge node back to its original messages..."/> : sourceError ? <EmptyState icon={<Icon name="alert" size={20}/>} title="TRACE INTERRUPTED" detail={sourceError + " — close this reader and try again."}/> : (
              <div className="source-message-list">
                {(sourceData?.messages ?? []).length === 0 ? <EmptyState icon={<Icon name="alert" size={20}/>} title="SOURCE NOT FOUND" detail="No original messages were returned for this knowledge node."/> : sourceData?.messages.map((message) => (
                  <article className="source-message" key={message.message_id}>
                    <div><span>{message.role.toUpperCase()}</span><small>{message.created_at ? formatDate(message.created_at) : "TIMESTAMP UNKNOWN"}</small></div>
                    <p>{message.content}</p>
                    <small>MESSAGE ID / {message.message_id}</small>
                  </article>
                ))}
              </div>
            )}
            <div className="source-modal__foot"><span>ORIGINAL MESSAGE PROVENANCE</span><span>MW / SOURCE TRACE</span></div>
          </section>
        </div>
      )}
      <div className={"notice-toast " + (apiOnline === false ? "notice-toast--warning" : "")} role="status" aria-live="polite">
        <span className="toast-symbol">{apiOnline === false ? "!" : "MW"}</span><span>{notice}</span>
      </div>
    </main>
  );
}

function EngineStatus({ label, status }: { label: string; status: "online" | "offline" | "idle" | "checking" }) {
  return <div className="engine-status"><span>{label}</span><b className={"engine-status__value engine-status__value--" + status}><i/>{status.toUpperCase()}</b></div>;
}

function ArchiveRow({ archive, index, driveReady, busy, onBackup }: { archive: Archive; index: string; driveReady: boolean; busy: boolean; onBackup: () => void }) {
  return (
    <article className="archive-row">
      <span className="row-index">{index}</span>
      <div className="archive-file-icon"><Icon name="file" size={18}/><small>ZIP</small></div>
      <div className="archive-row__main"><strong title={archive.file_name}>{archive.file_name}</strong><span>{formatBytes(archive.size_bytes)} <i>·</i> {formatDate(archive.created_at)}</span></div>
      <div className="archive-row__status"><StatusBadge status={archive.status}/><StatusBadge status={archive.drive_status} prefix="DRIVE / "/></div>
      {archive.drive_status !== "uploaded" && (
        <button className="row-action" onClick={onBackup} disabled={!driveReady || busy} title={driveReady ? "Queue Google Drive backup" : "Configure Google Drive first"}>
          {busy ? "..." : driveReady ? "BACKUP" : "DRIVE OFF"}
        </button>
      )}
    </article>
  );
}

function JobRow({ job, index, busy, onResume }: { job: Job; index: string; busy: boolean; onResume: () => void }) {
  const total = job.total_conversations ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((job.processed_conversations / total) * 100)) : 0;
  const canResume = ["awaiting_ai", "retry", "failed"].includes(job.status);
  const mode = job.mode === "backup_only" ? "DRIVE BACKUP" : "KNOWLEDGE EXTRACTION";
  return (
    <article className="job-row">
      <span className="row-index">{index}</span>
      <div className="job-row__main">
        <div className="job-title-line"><strong>{mode}</strong><StatusBadge status={job.status}/></div>
        <div className="job-meta"><span>ID / {job.id.slice(0, 8).toUpperCase()}</span><span>{job.processed_conversations.toLocaleString()} {total > 0 ? "/ " + total.toLocaleString() : ""} CONVERSATIONS</span></div>
        <div className="progress-track"><i style={{ width: progress + "%" }}/></div>
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
    <button type="button" className={"knowledge-card knowledge-card--" + kind} onClick={onOpen} aria-label={"Inspect source messages for " + item.title}>
      <div className="knowledge-card__top"><span className="knowledge-index">{index} / {kind}</span><span className="confidence">{confidence}% <i>CONF.</i></span></div>
      <span className="knowledge-card__slash"/>
      <h3>{item.title}</h3>
      <p>{item.summary || "No summary supplied. Open the source trail to inspect the extracted fragment."}</p>
      <div className="knowledge-card__bottom"><span>SOURCE / {item.conversation_id.slice(0, 12).toUpperCase()}</span><span>↗</span></div>
    </button>
  );
}
