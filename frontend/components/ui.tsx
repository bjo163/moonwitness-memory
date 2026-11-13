"use client";

import type { ReactNode } from "react";

export function SectionLabel({ index, title, trailing }: { index: string; title: string; trailing?: ReactNode }) {
  return (
    <div className="section-label">
      <div className="section-label__name"><span>{index}</span><strong>{title}</strong></div>
      {trailing && <div className="section-label__trailing">{trailing}</div>}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={"panel " + className}>{children}</section>;
}

export function StatusBadge({ status, prefix }: { status: string; prefix?: string }) {
  const normalized = status.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return <span className={"status-badge status-badge--" + normalized}>{prefix}{status.replaceAll("_", " ")}</span>;
}

export function MetricCard({ label, value, index, detail, tone = "default" }: { label: string; value: number; index: string; detail: string; tone?: "default" | "acid" | "orange" }) {
  return (
    <article className={"metric-card metric-card--" + tone}>
      <div className="metric-card__top"><span>{index} / {label}</span><i /></div>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="empty-state"><div className="empty-state__icon">{icon}</div><strong>{title}</strong><p>{detail}</p></div>;
}

export function ActionButton({ children, onClick, disabled, variant = "line", type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "line" | "acid" | "orange"; type?: "button" | "submit" }) {
  return <button className={"action-button action-button--" + variant} onClick={onClick} disabled={disabled} type={type}>{children}</button>;
}
