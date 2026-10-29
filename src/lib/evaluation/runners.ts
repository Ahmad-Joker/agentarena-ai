/**
 * Trusted runner scripts copied into the sandbox next to the untrusted solution.
 * They load the solution, call the entry function with each argument list and print
 * the *actual* return values. They never see expected values; grading happens on the host.
 */
export const JS_RUNNER = String.raw`
import { readFileSync } from "node:fs";
const write = process.stdout.write.bind(process.stdout);
const nonce = process.env.AA_NONCE;
const spec = JSON.parse(readFileSync("/work/cases.json", "utf8"));
const emit = (payload) => write("\n__AA_RESULT_" + nonce + "__" + JSON.stringify(payload) + "\n");
const serialize = (v) => (v === undefined ? { __undefined: true } : v);
let mod;
try {
  mod = await import("/work/solution.mjs");
} catch (e) {
  emit({ loadError: String(e && e.stack ? e.stack : e).slice(0, 800) });
  process.exit(0);
}
const fn = mod[spec.fn];
if (typeof fn !== "function") {
  emit({ loadError: "Export '" + spec.fn + "' is not a function" });
  process.exit(0);
}
const results = [];
for (const args of spec.cases) {
  try {
    const value = await fn(...structuredClone(args));
    results.push({ ok: true, value: JSON.parse(JSON.stringify(serialize(value)) ?? "null") });
  } catch (e) {
    results.push({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) });
  }
}
emit({ results });
process.exit(0);
`;

export const PY_RUNNER = String.raw`
import copy, importlib.util, json, os, sys, traceback
_write = sys.stdout.write
_nonce = os.environ.get("AA_NONCE", "")
def emit(payload):
    _write("\n__AA_RESULT_" + _nonce + "__" + json.dumps(payload) + "\n")
    sys.stdout.flush()
with open("/work/cases.json", "r", encoding="utf-8") as fh:
    spec = json.load(fh)
try:
    import py_compile
    py_compile.compile("/work/solution.py", cfile="/tmp/solution.pyc", doraise=True)
    loader_spec = importlib.util.spec_from_file_location("solution", "/work/solution.py")
    mod = importlib.util.module_from_spec(loader_spec)
    loader_spec.loader.exec_module(mod)
except BaseException as e:
    emit({"loadError": "".join(traceback.format_exception_only(type(e), e))[-800:]})
    sys.exit(0)
fn = getattr(mod, spec["fn"], None)
if not callable(fn):
    emit({"loadError": "Function '" + spec["fn"] + "' is not defined"})
    sys.exit(0)
results = []
for args in spec["cases"]:
    try:
        value = fn(*copy.deepcopy(args))
        results.append({"ok": True, "value": json.loads(json.dumps(value, default=str))})
    except BaseException as e:
        results.append({"ok": False, "error": (type(e).__name__ + ": " + str(e))[:300]})
emit({"results": results})
`;
