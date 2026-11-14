import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, type LicenceView } from "@/lib/api";
import { AsyncButton } from "@/components/common/AsyncButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

const ORDER = ["community", "professional", "enterprise", "sovereign"];

/** "Request an upgrade" flow shared by the Overview card and the Licence page. */
export function UpgradeDialog({ view, onClose, onDone }: {
  view: LicenceView; onClose: () => void; onDone: () => void;
}) {
  const current = view.plan.edition;
  const next = ORDER[Math.min(ORDER.indexOf(current) + 1, ORDER.length - 1)] || "enterprise";
  const [target, setTarget] = useState(next === current ? "sovereign" : next);
  const missing = view.features.filter((f) => !view.plan.features.includes(f.id));
  const [features, setFeatures] = useState<string[]>(missing.map((f) => f.id));
  const [message, setMessage] = useState("");
  const toast = useToast();

  const toggle = (id: string) =>
    setFeatures((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  async function submit() {
    try {
      await api.requestLicenceUpgrade({ target_edition: target, add_features: features, message });
      toast.push("Upgrade request sent — your account team will follow up", "success");
      onDone();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4" /> Request a licence upgrade
          </DialogTitle>
          <DialogDescription>
            Current plan: <span className="font-medium capitalize">{current}</span>. The request is stored
            with the tenant and written to the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Target edition</Label>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
              {view.editions.filter((e) => e !== "community").map((e) => (
                <option key={e} value={e} disabled={e === current}>
                  {e}{e === current ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Features to add</Label>
            {missing.length === 0 ? (
              <p className="text-xs text-muted-foreground">Every feature is already in this plan.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {missing.map((f) => (
                  <label key={f.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/40">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary"
                      checked={features.includes(f.id)} onChange={() => toggle(f.id)} />
                    <span>
                      <span className="block font-medium">{f.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{f.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Message <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Timeline, procurement reference or the pilot outcome that motivates the upgrade." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={submit}>
            <ArrowUpRight className="h-4 w-4" /> Send request
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
