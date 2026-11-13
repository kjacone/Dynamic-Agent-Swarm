import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Layers, Loader2, Search, Upload } from "lucide-react";
import { api, type Rag } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";

export function Knowledge({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Rag[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [queryFor, setQueryFor] = useState<Rag | null>(null);
  const [deleting, setDeleting] = useState<Rag | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listRag(tenant)); } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  // Poll while any collection is ingesting.
  useEffect(() => {
    if (!rows?.some((r) => r.status === "ingesting")) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [rows]);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      ready: list.filter((r) => r.status === "ready").length,
      ingesting: list.filter((r) => r.status === "ingesting").length,
      failed: list.filter((r) => r.status === "error").length,
    };
  }, [rows]);

  return (
    <div>
      <PageHeader icon={BookOpen} title="Knowledge"
        description="Retrieval collections backed by FAISS, with per-tenant embeddings."
        actions={<Button onClick={() => setCreating(true)}>New collection</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Layers} label="Collections" value={rows?.length ?? "—"} tone="violet" />
        <StatCard icon={BookOpen} label="Ready" value={rows ? counts.ready : "—"} tone="emerald" hint="Available to agents" />
        <StatCard icon={Loader2} label="Ingesting" value={rows ? counts.ingesting : "—"} tone="amber" hint="Processing uploads" />
        <StatCard icon={Layers} label="Failed" value={rows ? counts.failed : "—"} tone={counts.failed ? "red" : "slate"} hint="Needs attention" />
      </div>

      {rows === null ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No collections yet"
          body="Upload .txt / .md / .pdf into a collection to give agents grounded retrieval."
          action={<Button onClick={() => setCreating(true)}>Create collection</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Status</TH><TH>Embedding</TH><TH>Top K</TH><TH className="text-right">Actions</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className="group">
                  <TD className="font-medium">{r.name}</TD>
                  <TD><StatusBadge value={r.status} /></TD>
                  <TD className="font-mono text-xs text-muted-foreground">{r.embedding_model}</TD>
                  <TD className="tabular-nums">{r.top_k}</TD>
                  <TD>
                    <div className="flex justify-end gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                      <UploadButton rag={r} onDone={refresh} />
                      <Button size="sm" variant="outline" onClick={() => setQueryFor(r)} disabled={r.status !== "ready"}>
                        <Search className="h-3.5 w-3.5" /> Query
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(r)}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {creating && <CreateCollection tenant={tenant} onClose={() => { setCreating(false); refresh(); }} />}
      {queryFor && <QueryDialog rag={queryFor} onClose={() => setQueryFor(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description="The collection and every embedded chunk in its index will be removed. Agents using it will lose this knowledge."
          confirmLabel="Delete collection" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteRag(deleting.id);
            toast.push("Collection deleted", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function UploadButton({ rag, onDone }: { rag: Rag; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await api.uploadRag(rag.id, Array.from(files));
      toast.push(`Uploading ${files.length} file(s)…`, "success");
      onDone();
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  return (
    <>
      <input ref={inputRef} type="file" multiple className="hidden" accept=".txt,.md,.pdf" onChange={(e) => pick(e.target.files)} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
      </Button>
    </>
  );
}

function CreateCollection({ tenant, onClose }: { tenant: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [embedding, setEmbedding] = useState("openai:text-embedding-3-small");
  const [topK, setTopK] = useState(4);
  const toast = useToast();

  async function save() {
    try {
      await api.createRag({ name, embedding_model: embedding, top_k: topK, tenant_id: tenant });
      toast.push("Collection created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
          <DialogDescription>Create an empty index, then upload documents into it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. policy-handbook" /></div>
          <div className="space-y-1.5"><Label>Embedding model</Label>
            <Input className="font-mono text-xs" value={embedding} onChange={(e) => setEmbedding(e.target.value)} />
            <div className="text-xs text-muted-foreground">Provider:model — e.g. ollama:nomic-embed-text</div>
          </div>
          <div className="space-y-1.5"><Label>Top K</Label>
            <Input type="number" min={1} value={topK} onChange={(e) => setTopK(Number(e.target.value) || 4)} />
            <div className="text-xs text-muted-foreground">How many chunks to retrieve per query.</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Create collection</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueryDialog({ rag, onClose }: { rag: Rag; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(rag.top_k);
  const [rows, setRows] = useState<{ content: string; metadata: Record<string, unknown> }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setErr(null); setRows([]);
    try {
      const r = await api.queryRag(rag.id, query, topK);
      setRows(r.results);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Query · {rag.name}</DialogTitle>
          <DialogDescription>Preview exactly what retrieval returns for a question. No model is called.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <Textarea rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What are the cancellation terms?"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && query) run(); }} />
            <div className="space-y-1.5">
              <Label>Top K</Label>
              <Input type="number" min={1} value={topK} onChange={(e) => setTopK(Number(e.target.value) || 4)} />
            </div>
          </div>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          <div className="max-h-96 space-y-2 overflow-auto">
            {busy && <div className="py-8 text-center text-sm text-muted-foreground">Searching…</div>}
            {!busy && rows.length === 0 && <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">Results appear here.</div>}
            {rows.map((r, i) => (
              <div key={i} className="rounded-xl border p-3 text-sm">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">#{i + 1}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(r.metadata)}</span>
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{r.content}</div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <AsyncButton onRun={run} disabled={!query || busy}>Search</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
