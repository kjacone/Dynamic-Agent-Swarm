import { useEffect, useRef, useState } from "react";
import { api, type Rag } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";

export function Knowledge({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Rag[]>([]);
  const [creating, setCreating] = useState(false);
  const [queryFor, setQueryFor] = useState<Rag | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listRag(tenant)); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  // Poll while any collection is ingesting.
  useEffect(() => {
    if (!rows.some((r) => r.status === "ingesting")) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [rows]);

  return (
    <div>
      <PageHeader title="Knowledge" description="RAG collections backed by FAISS."
        actions={<Button onClick={() => setCreating(true)}>New collection</Button>} />

      {rows.length === 0 ? (
        <EmptyState title="No collections" body="Upload .txt / .md / .pdf into a collection to give agents grounded retrieval."
          action={<Button onClick={() => setCreating(true)}>Create collection</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Status</TH><TH>Embedding</TH><TH>Top K</TH><TH></TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD>
                    <Badge variant={r.status === "ready" ? "success" : r.status === "error" ? "destructive" : "warning"}>
                      {r.status}
                    </Badge>
                  </TD>
                  <TD className="font-mono text-xs">{r.embedding_model}</TD>
                  <TD className="tabular-nums">{r.top_k}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <UploadButton rag={r} onDone={refresh} />
                      <Button size="sm" variant="ghost" onClick={() => setQueryFor(r)} disabled={r.status !== "ready"}>Query</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                        if (!confirm(`Delete ${r.name} and its index?`)) return;
                        try { await api.deleteRag(r.id); refresh(); } catch (e: any) { toast.push(e.message, "error"); }
                      }}>Delete</Button>
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
      <input ref={inputRef} type="file" multiple className="hidden"
        accept=".txt,.md,.pdf" onChange={(e) => pick(e.target.files)} />
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "…" : "Upload"}
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
      toast.push("Created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New collection</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Embedding model</Label><Input value={embedding} onChange={(e) => setEmbedding(e.target.value)} />
            <div className="mt-1 text-xs text-muted-foreground">Provider:model — e.g. ollama:nomic-embed-text</div>
          </div>
          <div><Label>Top K</Label><Input type="number" value={topK} onChange={(e) => setTopK(Number(e.target.value) || 4)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Create</AsyncButton>
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
        <DialogHeader><DialogTitle>Query · {rag.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr,100px] gap-2">
            <Textarea rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What are the cancellation terms?" />
            <div>
              <Label>Top K</Label>
              <Input type="number" value={topK} onChange={(e) => setTopK(Number(e.target.value) || 4)} />
            </div>
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}
          <div className="max-h-96 space-y-2 overflow-auto">
            {rows.map((r, i) => (
              <div key={i} className="rounded-md border p-2 text-sm">
                <div className="whitespace-pre-wrap">{r.content}</div>
                <div className="mt-1 text-xs text-muted-foreground">{JSON.stringify(r.metadata)}</div>
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