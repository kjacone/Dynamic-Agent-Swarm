"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChatSidebar, useAgentReadable, useAgentTool } from "langgraph-kit";

// 2) Copilot-style: the chat docks next to your real app and can see and drive it.
export default function Orders() {
  const router = useRouter();
  const [filter, setFilter] = useState("open");

  // The agent can read this (sent as config.configurable.readables)...
  useAgentReadable("Orders page filter", { filter });

  // ...and call this. Runs in the browser; the result goes back to the graph.
  useAgentTool<{ path: string }>({
    name: "navigate",
    handler: ({ path }) => { router.push(path); return { ok: true, path }; },
  });
  useAgentTool<{ status: string }>({
    name: "set_filter",
    handler: ({ status }) => { setFilter(status); return { ok: true, status }; },
    // Optional: custom UI for this tool call in the chat
    render: ({ args, status }) => (
      <div className="lgk-tool" style={{ padding: 8 }}>
        {status === "done" ? `Filter set to ${args.status}` : "Setting filter…"}
      </div>
    ),
  });

  return (

    <ChatSidebar mode="panel" title="Orders assistant" suggestions={["Show me shipped orders"]}>
      <main style={{ padding: 24 }}>
        <h1>Orders</h1>
        <p>Filter: {filter}</p>
      </main>
    </ChatSidebar>
  );
}
