import { Button, Input, Label, Select } from "@/components/ui/primitives";

export interface FilterField {
  name: string;
  label: string;
  value?: string;
  options?: Array<{ value: string; label: string }>;
  type?: "select" | "text" | "date";
  placeholder?: string;
}

/** Server-rendered GET filter form: works without JavaScript and keeps filters in the URL. */
export function FilterBar({ fields, action }: { fields: FilterField[]; action: string }) {
  return (
    <form action={action} method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
      {fields.map((f) => (
        <div key={f.name} className="min-w-[150px] flex-1 sm:flex-none">
          <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
          {f.options ? (
            <Select id={`f-${f.name}`} name={f.name} defaultValue={f.value ?? ""} className="h-9 text-xs">
              <option value="">Any</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input id={`f-${f.name}`} name={f.name} type={f.type ?? "text"} defaultValue={f.value ?? ""} placeholder={f.placeholder} className="h-9 text-xs" />
          )}
        </div>
      ))}
      <Button type="submit" size="sm" variant="secondary" className="h-9">
        Apply
      </Button>
    </form>
  );
}
