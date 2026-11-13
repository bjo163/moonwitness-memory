"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
type Counts = { archives: number; messages: number; knowledge: number; active_jobs: number; failed_jobs: number };
type Archive = { id: string; file_name: string; size_bytes: number; status: string; drive_status: string; created_at: string };
type Job = { id: string; archive_id: string; status: string; processed_conversations: number; total_conversations: number | null; error: string | null };
type Knowledge = { id: string; kind: string; title: string; summary: string; confidence: number; conversation_id: string };
const initialCounts: Counts = { archives: 0, messages: 0, knowledge: 0, active_jobs: 0, failed_jobs: 0 };
const formatBytes = (value: number) => value < 1024 ** 3
  ? (value / 1024 ** 2).toFixed(1) + " MB"
  : (value / 1024 ** 3).toFixed(2) + " GB";

export default function Home() {
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("LOCAL ENGINE STANDBY");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [c, a, j, k] = await Promise.all([
        fetch(API + "/api/dashboard", { cache: "no-store" }),
        fetch(API + "/api/archives", { cache: "no-store" }),
        fetch(API + "/api/jobs", { cache: "no-store" }),
        fetch(API + "/api/knowledge?limit=12", { cache: "no-store" }),
      ]);
      if (![c, a, j, k].every((r) => r.ok)) throw new Error("API unavailable");
      setCounts(await c.json());
      setArchives(await a.json());
      setJobs(await j.json());
      setKnowledge(await k.json());
      setNotice("LOCAL ENGINE ONLINE");
    } catch {
      setNotice("API OFFLINE // CHECK DOCKER COMPOSE");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice("INGESTING " + file.name);
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(API + "/api/archives", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Upload failed");
      setNotice(result.duplicate ? "DUPLICATE ARCHIVE // ALREADY IN VAULT" : "ARCHIVE ACCEPTED // WORKER QUEUED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "UPLOAD FAILED");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function resume(jobId: string) {
    const response = await fetch(API + "/api/jobs/" + jobId + "/resume", { method: "POST" });
    const result = await response.json();
    setNotice(response.ok ? "JOB RESUMED" : result.detail || "RESUME FAILED");
    await refresh();
  }

  async function search() {
    if (!query.trim()) return refresh();
    const response = await fetch(API + "/api/search?q=" + encodeURIComponent(query) + "&limit=30");
    if (response.ok) setKnowledge(await response.json());
  }

  return (
    <main className="shell">
      <header className="topline">
        <div className="brand"><span className="brand-mark">MW</span><div><p className="eyebrow">MOONWITNESS SYSTEMS / MEMORY DIVISION</p><h1>MEMORY<span>BRIDGE</span></h1></div></div>
        <div className="status"><i />{notice}</div>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow orange">ARCHIVE INTELLIGENCE // LOCAL-FIRST</p>
          <h2>YOUR HISTORY.<br /><em>NO MORE LOST SIGNAL.</em></h2>
          <p className="hero-note">Turn AI conversations into a traceable knowledge corpus. Originals stay in your local vault; Gemini analyzes bounded context; Google Drive is the optional S3-backed archive.</p>
          <label className={"upload-button " + (busy ? "disabled" : "")}>
            {busy ? "PROCESSING..." : "＋ INGEST ARCHIVE"}
            <input type="file" accept=".zip,.json,application/zip,application/json" onChange={upload} disabled={busy} />
          </label>
          <p className="micro">CHATGPT EXPORT .ZIP / conversations.json · LARGE FILES SUPPORTED</p>
        </div>
        <div className="hero-stamp"><span>LOCAL</span><b>01</b><span>KNOWLEDGE<br />VAULT</span></div>
      </section>
      <section className="stats">
        <Stat label="ARCHIVES" value={counts.archives} />
        <Stat label="MESSAGES" value={counts.messages} />
        <Stat label="KNOWLEDGE NODES" value={counts.knowledge} />
        <Stat label="ACTIVE JOBS" value={counts.active_jobs} />
        <Stat label="FAILED" value={counts.failed_jobs} alert={counts.failed_jobs > 0} />
      </section>
      <section className="content-grid">
        <div className="panel">
          <div className="panel-head"><div><p className="eyebrow">01 / INGESTION</p><h3>ARCHIVE VAULT</h3></div><span className="counter">{archives.length.toString().padStart(2, "0")} FILES</span></div>
          <div className="rows">
            {archives.length === 0 && <Empty>No archives loaded. Import your first export into the bridge.</Empty>}
            {archives.map((item) => (
              <div className="archive-row" key={item.id}>
                <div className="file-icon">ZIP</div>
                <div className="row-main"><strong>{item.file_name}</strong><small>{formatBytes(item.size_bytes)} · {new Date(item.created_at).toLocaleString()}</small></div>
                <div className="row-tags"><span className={"tag " + item.status}>{item.status}</span><span className={"tag " + item.drive_status}>DRIVE {item.drive_status}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><p className="eyebrow">02 / WORK QUEUE</p><h3>PROCESS SIGNAL</h3></div><span className="counter">LIVE / 5 SEC</span></div>
          <div className="rows">
            {jobs.length === 0 && <Empty>Nothing in queue. Import an archive to start.</Empty>}
            {jobs.slice(0, 8).map((job) => (
              <div className="job-row" key={job.id}>
                <div className="row-main"><strong>{job.status.toUpperCase()}</strong><small>{job.processed_conversations} / {job.total_conversations ?? "—"} conversations · {job.archive_id.slice(0, 8)}</small>{job.error && <small className="error">{job.error}</small>}</div>
                {["awaiting_ai", "retry", "failed"].includes(job.status) && <button className="mini-button" onClick={() => void resume(job.id)}>RESUME</button>}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="panel knowledge-panel">
        <div className="panel-head"><div><p className="eyebrow">03 / EXTRACTED INTELLIGENCE</p><h3>KNOWLEDGE CORPUS</h3></div><div className="search"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void search()} placeholder="Search stories, lore, ideas..." /><button onClick={() => void search()}>SEARCH ↗</button></div></div>
        <div className="knowledge-grid">
          {knowledge.length === 0 && <Empty>No extracted knowledge yet. Add GEMINI_API_KEY to .env and restart the stack.</Empty>}
          {knowledge.map((item) => <article className="knowledge-card" key={item.id}><div className="knowledge-meta"><span>{item.kind.toUpperCase()}</span><span>{Math.round(item.confidence * 100)}% CONF.</span></div><h4>{item.title}</h4><p>{item.summary}</p><small>SOURCE {item.conversation_id.slice(0, 12)}</small></article>)}
        </div>
      </section>
      <footer><span>MW / MEMORY BRIDGE</span><span>PRIVATE BY DESIGN · LOCAL DATA · CLOUD AI WHEN CONFIGURED</span><span>v0.1.0</span></footer>
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return <div className={"stat " + (alert ? "stat-alert" : "")}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
