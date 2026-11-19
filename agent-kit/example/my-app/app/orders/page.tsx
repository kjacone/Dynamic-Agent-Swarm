"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChatSidebar, useAgentReadable, useAgentTool } from "langgraph-kit";
import { CheckIcon, UiStyles } from "langgraph-kit";

type Status = "open" | "shipped" | "delivered";
type Filter = "all" | Status;

const FILTERS: Filter[] = ["all", "open", "shipped", "delivered"];

const ORDERS: { id: string; customer: string; item: string; total: string; status: Status; date: string }[] = [
  { id: "ORD-1042", customer: "Amina Juma", item: "Fibre router and installation", total: "TSh 185,000", status: "open", date: "18 Nov" },
  { id: "ORD-1041", customer: "Joseph Mushi", item: "Prepaid data bundle, 50 GB", total: "TSh 45,000", status: "shipped", date: "17 Nov" },
  { id: "ORD-1039", customer: "Neema Kimaro", item: "Smart meter", total: "TSh 320,000", status: "delivered", date: "15 Nov" },
  { id: "ORD-1037", customer: "Hassan Ali", item: "Solar lamp kit", total: "TSh 95,000", status: "open", date: "14 Nov" },
  { id: "ORD-1034", customer: "Grace Mollel", item: "Wi-Fi extender", total: "TSh 60,000", status: "shipped", date: "12 Nov" },
  { id: "ORD-1030", customer: "Salma Bakari", item: "Fibre router and installation", total: "TSh 185,000", status: "delivered", date: "9 Nov" },
  { id: "ORD-1028", customer: "Peter Massawe", item: "Prepaid data bundle, 20 GB", total: "TSh 25,000", status: "delivered", date: "7 Nov" },
];

// 2) Copilot-style: the chat docks next to your real app and can see and drive it.
export default function Orders() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");

  const visible = filter === "all" ? ORDERS : ORDERS.filter((o) => o.status === filter);
  const countOf = (f: Filter) => (f === "all" ? ORDERS.length : ORDERS.filter((o) => o.status === f).length);

  // The agent can read this (sent as config.configurable.readables)...
  useAgentReadable("Orders page filter", { filter, shownOrders: visible.map((o) => o.id) });

  // ...and call this. Runs in the browser; the result goes back to the graph.
  useAgentTool<{ path: string }>({
    name: "navigate",
    handler: ({ path }) => { router.push(path); return { ok: true, path }; },
  });
  useAgentTool<{ status: string }>({
    name: "set_filter",
    handler: ({ status }) => {
      if (!FILTERS.includes(status as Filter)) return { ok: false, error: `Unknown status: ${status}` };
      setFilter(status as Filter);
      return { ok: true, status };
    },
    // Optional: custom UI for this tool call in the chat
    render: ({ args, status }) => (
      <div className="lgk-tool ui-tool">
        {status === "done" ? (
          <>
            <CheckIcon />
            <span>Filter set to {args.status}</span>
          </>
        ) : (
          <>
            <span className="ui-spinner" aria-hidden="true" />
            <span>Setting filter…</span>
          </>
        )}
      </div>
    ),
  });

  return (
    <ChatSidebar mode="panel" title="Orders assistant" suggestions={["Show me shipped orders"]}>
      <div className="ui-root">
        <UiStyles />
        <main className="ui-page">
          <header className="ui-head">
            <h1>Orders</h1>
            <p>
              Showing {visible.length} of {ORDERS.length} orders. Ask the assistant to filter the list or take you to
              another page.
            </p>
          </header>

          <div className="ui-chips" role="group" aria-label="Filter orders by status">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className="ui-chip"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
                <b>{countOf(f)}</b>
              </button>
            ))}
          </div>

          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Item</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="ui-empty">No {filter} orders right now.</td>
                  </tr>
                ) : (
                  visible.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <span className="ui-order-id">{o.id}</span>
                        <span className="ui-sub">{o.customer}, {o.date}</span>
                      </td>
                      <td>{o.item}</td>
                      <td><span className={`ui-badge ${o.status}`}>{o.status}</span></td>
                      <td className="num">{o.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </ChatSidebar>
  );
}