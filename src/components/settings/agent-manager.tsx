"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search } from "lucide-react";
import { LANGUAGES } from "@/lib/domain/schemas";
import { Button, Callout, Input, Label } from "@/components/ui/primitives";
import { LANGUAGE_LABEL } from "@/lib/utils";

interface Discovered {
  id: string;
  name: string;
  base: string | null;
  defaultModel: string | null;
}

export function AgentManager({ keyConfigured }: { keyConfigured: boolean }) {
  const router = useRouter();
  const [found, setFound] = useState<Discovered[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", harnessId: "", base: "", model: "", languages: ["TYPESCRIPT", "PYTHON"] as string[] });

  async function discover() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/agents/discover", { method: "POST" });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "danger", text: body?.error?.message ?? "Discovery failed" });
    setFound(body.harnesses as Discovered[]);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, base: form.base || undefined, model: form.model || undefined }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "danger", text: body?.error?.message ?? "Could not add agent" });
    setMsg({ tone: "info", text: `Added ${body.name}.` });
    setForm((f) => ({ ...f, name: "", harnessId: "", model: "" }));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Button type="button" onClick={discover} disabled={!keyConfigured || busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />} Discover configured agents (GET /v1/harnesses)
      </Button>
      {found && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {found.length === 0 && <li className="text-xs text-ink-500">No configured agents visible to this key.</li>}
          {found.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-ink-700 bg-ink-850 p-3 text-left text-xs hover:border-ink-500"
                onClick={() => setForm((f) => ({ ...f, name: h.name, harnessId: h.id, base: h.base ?? "" }))}
              >
                <span className="block font-medium text-ink-100">{h.name}</span>
                <span className="text-ink-500">
                  {h.base ?? "unknown base"} · {h.defaultModel ?? "default model"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-3 rounded-lg border border-ink-800 p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ag-name">Display name</Label>
          <Input id="ag-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <Label htmlFor="ag-id">Harness id</Label>
          <Input id="ag-id" value={form.harnessId} onChange={(e) => setForm({ ...form, harnessId: e.target.value })} className="font-mono" required />
        </div>
        <div>
          <Label htmlFor="ag-base">Base (informational)</Label>
          <Input id="ag-base" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="ag-model">Model override (optional)</Label>
          <Input id="ag-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="harness default" className="font-mono" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-300">Languages to benchmark</legend>
          <div className="flex gap-4 text-xs">
            {LANGUAGES.map((l) => (
              <label key={l} className="flex items-center gap-1.5 text-ink-300">
                <input
                  type="checkbox"
                  checked={form.languages.includes(l)}
                  onChange={(e) => setForm({ ...form, languages: e.target.checked ? [...form.languages, l] : form.languages.filter((x) => x !== l) })}
                />
                {LANGUAGE_LABEL[l]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={busy}>
            <Plus aria-hidden /> Register agent
          </Button>
        </div>
      </form>
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
    </div>
  );
}
