// A small argv parser. No dependency, no surprises.
//
//   parseArgs(["build", "./evidence", "--subject", "PR #12", "--json", "--extra", "a=1", "--extra", "b=2"],
//             { repeat: ["extra"], flags: ["json"] })
//   -> { command: "build", positional: ["./evidence"], subject: "PR #12", json: true, extra: ["a=1", "b=2"] }
//
// "--key=value" and "--key value" both work. Keys are kebab-case on the
// command line and camelCase in the result (--build-id -> buildId).

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export function parseArgs(argv, { repeat = [], flags = [] } = {}) {
  const out = { positional: [] };
  const repeatSet = new Set(repeat.map(camel));
  const flagSet = new Set(flags.map(camel));
  for (const k of repeatSet) out[k] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      out.positional.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      out.positional.push(a);
      i++;
      continue;
    }
    let [key, value] = a.slice(2).split(/=(.*)/s);
    key = camel(key);
    if (flagSet.has(key)) {
      out[key] = value === undefined ? true : value !== "false";
      i++;
      continue;
    }
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${a.slice(2)} needs a value`);
      }
      i += 2;
    } else {
      i++;
    }
    if (repeatSet.has(key)) out[key].push(value);
    else out[key] = value;
  }
  out.command = out.positional.shift();
  return out;
}

// "key=value" pairs -> object. Used by --extra.
export function pairsToObject(pairs) {
  const o = {};
  for (const p of pairs || []) {
    const [k, ...rest] = String(p).split("=");
    if (k) o[k] = rest.join("=");
  }
  return o;
}
