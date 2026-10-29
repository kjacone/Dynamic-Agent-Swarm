"use client";
import { Chat, useAgentContext, useAgentTool, useArtifact } from "langgraph-kit";

// A tool card that opens its result in the side panel. `render` must return an element
// (a component), so hooks like useArtifact / useAgentContext work inside it.
function ReportCard({ args, status }: { args: { title: string; body: string }; status: string }) {
  const [Artifact, { open, setOpen, setContext }] = useArtifact();
  const agent = useAgentContext();
  return (
    <>
      <button
        type="button" className="lgk-tool" style={{ padding: 12, textAlign: "left", width: "100%" }}
        onClick={() => { setContext({ openReport: args.title }); setOpen(!open); }}
      >
        <strong>{args.title}</strong>
        <div style={{ opacity: 0.7 }}>{status === "done" ? "Click to open" : "Writing…"}</div>
      </button>
      <Artifact title={args.title}>
        <article style={{ whiteSpace: "pre-wrap" }}>{args.body}</article>
        <button type="button" onClick={() => void agent.send("Make the report shorter")}>Shorten</button>
      </Artifact>
    </>
  );
}

export default function Reports() {
  // Render-only: no handler, so it decorates a server-side tool called `write_report`.
  useAgentTool({ name: "write_report", render: (p) => <ReportCard args={p.args} status={p.status} /> });

  return (
    <div style={{ height: "100dvh" }}>
      <Chat title="Reports" suggestions={["Write a report on Q3 churn"]} />
    </div>
  );
}
