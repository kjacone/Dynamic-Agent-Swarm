"use client";
import { Chat, useAgentContext, useAgentTool, useArtifact } from "langgraph-kit";
import { DocIcon, UiStyles } from "langgraph-kit";

// A tool card that opens its result in the side panel. `render` must return an element
// (a component), so hooks like useArtifact / useAgentContext work inside it.
function ReportCard({ args, status }: { args: { title: string; body: string }; status: string }) {
  const [Artifact, { open, setOpen, setContext }] = useArtifact();
  const agent = useAgentContext();
  const title = args.title || "Untitled report";
  const done = status === "done";
  const words = args.body ? args.body.trim().split(/\s+/).length : 0;

  return (
    <>
      <button
        type="button"
        className="lgk-tool ui-report"
        aria-expanded={open}
        onClick={() => { setContext({ openReport: args.title }); setOpen(!open); }}
      >
        <span className="ui-report-icon"><DocIcon /></span>
        <span className="ui-report-text">
          <strong>{title}</strong>
          <small>
            {done ? (
              `${words} words. ${open ? "Click to close" : "Click to open"}`
            ) : (
              <>
                <span className="ui-dot" aria-hidden="true" />
                Writing…
              </>
            )}
          </small>
        </span>
      </button>
      <Artifact title={title}>
        <article className="ui-doc">{args.body}</article>
        <div className="ui-doc-actions">
          <button type="button" className="ui-btn" onClick={() => void agent.send("Make the report shorter")}>
            Shorten
          </button>
        </div>
      </Artifact>
    </>
  );
}

export default function Reports() {
  // Render-only: no handler, so it decorates a server-side tool called `write_report`.
  useAgentTool({ name: "write_report", render: (p) => <ReportCard args={p.args} status={p.status} /> });

  return (
    <div className="ui-root ui-fill">
      <UiStyles />
      <Chat title="Reports" suggestions={["Write a report on Q3 churn"]} />
    </div>
  );
}