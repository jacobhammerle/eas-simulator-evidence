// Terminal color, the conventional way: on for a TTY, off when piped,
// off with NO_COLOR, forced with FORCE_COLOR. Nothing else.
export function colorEnabled(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream && stream.isTTY);
}

const CODES = { green: 32, red: 31, yellow: 33, dim: 2, bold: 1, cyan: 36 };

export function paint(text, color, enabled = colorEnabled()) {
  if (!enabled || !CODES[color]) return String(text);
  return `\u001b[${CODES[color]}m${text}\u001b[0m`;
}

export const KIND_COLOR = { pass: "green", fail: "red", replicated: "yellow", neutral: "dim" };
