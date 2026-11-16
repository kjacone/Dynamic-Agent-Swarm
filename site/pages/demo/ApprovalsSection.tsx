import { useState } from "react";
import { BadgeCheck, Clock3, RotateCcw, ShieldAlert, UserRound } from "lucide-react";
import { APPROVALS, type DemoApproval } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, SectionHeading } from "./ui";

type Filter = "open" | "decided";

export function ApprovalsSection() {
  const [items, setItems] = useState<DemoApproval[]>(APPROVALS);
  const [selectedId, setSelectedId] = useState("APR-2041");
  const [filter, setFilter] = useState<Filter>("open");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const visible = items.filter((item) => (filter === "open" ? item.status === "pending" : item.status !== "pending"));
  const openCount = items.filter((item) => item.status === "pending").length;

  function decide(next: "approved" | "rejected") {
    setItems((current) =>
      current.map((item) =>
        item.id === selected.id
          ? { ...item, status: next, decidedBy: "you (demo session)", decidedAt: "just now" }
          : item,
      ),
    );
    setNotice(
      `${selected.id} marked ${next}. The decision is recorded in this browser tab only — a real tenant would append it to the audit chain and notify the requester.`,
    );
    setNote("");
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Approvals"
          description="High-risk steps pause here until a human with the right role decides. Try approving an item — the queue updates locally."
        />
        <DemoBadge />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-border bg-card p-0.5">
          {(
            [
              ["open", `Open (${openCount})`],
              ["decided", "Decided"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                filter === value ? "bg-[var(--site-accent)] text-[var(--site-on-accent)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setItems(APPROVALS);
            setNotice(null);
            setSelectedId("APR-2041");
          }}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Reset demo decisions
        </button>
      </div>

      {notice ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--site-accent)]/25 bg-[var(--site-accent)]/8 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[var(--site-accent)]">
          <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel className="overflow-hidden">
          <div className="divide-y divide-border/70">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  setNotice(null);
                }}
                className={`flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors ${
                  selected.id === item.id ? "bg-[var(--site-accent)]/6" : "hover:bg-[var(--site-bg)]/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Mono>{item.id}</Mono>
                  {item.status === "pending" ? (
                    item.escalated ? <Pill tone="amber">escalated</Pill> : item.risk === "high" ? <Pill tone="red">high risk</Pill> : <Pill tone="neutral">review</Pill>
                  ) : (
                    <Pill tone={item.status === "approved" ? "green" : "red"}>{item.status}</Pill>
                  )}
                </div>
                <p className="text-[12.5px] font-medium leading-snug">{item.title}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                  <span>{item.run}</span>
                  <span>{item.role}</span>
                  <span className={item.escalated ? "text-amber-700" : ""}>{item.due}</span>
                </div>
              </button>
            ))}
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">Nothing in this list. Switch the filter.</p>
            ) : null}
          </div>
        </Panel>

        <Panel className="flex flex-col">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <Mono>{selected.id}</Mono>
              <Pill tone={selected.risk === "high" ? "red" : "neutral"}>{selected.risk ?? "standard"} risk</Pill>
            </div>
            <h2 className="mt-1.5 text-[15px] font-semibold leading-snug">{selected.title}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{selected.summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 py-3 text-[11px]">
            <div className="flex items-start gap-2">
              <UserRound className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Requested by</p>
                <p className="font-medium">{selected.requester}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Deadline</p>
                <p className={`font-medium ${selected.escalated ? "text-amber-700" : ""}`}>{selected.due}</p>
              </div>
            </div>
          </div>

          {selected.status === "pending" ? (
            <div className="mt-auto border-t border-border/70 px-4 py-3">
              <label htmlFor="decision-note" className="text-[11px] font-medium">
                Decision note <span className="font-normal text-muted-foreground">(kept in the demo only)</span>
              </label>
              <textarea
                id="decision-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="e.g. Beneficial ownership evidence verified against the registry extract."
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-[var(--site-bg)]/60 px-3 py-2 text-[12px] outline-none focus:border-[var(--site-accent)]/50"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => decide("approved")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--site-accent)] px-3.5 py-2 text-[11.5px] font-semibold text-[var(--site-on-accent)]"
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide("rejected")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[11.5px] font-medium text-foreground hover:border-red-400/50"
                >
                  Request changes
                </button>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ShieldAlert className="h-3 w-3" /> Demo decision — no connected system is touched
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-auto border-t border-border/70 px-4 py-3 text-[11.5px]">
              <p>
                <span className="font-medium capitalize">{selected.status}</span> by {selected.decidedBy} · {selected.decidedAt}
              </p>
              <button
                type="button"
                onClick={() => {
                  setItems(APPROVALS);
                  setNotice(null);
                }}
                className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-[var(--site-accent)]"
              >
                <RotateCcw className="h-3 w-3" /> Reset to seeded state
              </button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
