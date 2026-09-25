// Shared test helpers: paths, scratch dirs, and tiny generated images so
// tests can make any evidence directory they want without committing
// megabytes of screenshots.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..");
export const bin = join(root, "bin", "eas-simulator-evidence.js");
export const fixture = join(root, "fixtures", "qa-checklist-ios");
// Per-process scratch root: test files run in parallel processes and each
// cleans up only its own folder.
export const outRoot = join(here, ".out", String(process.pid));

export const quiet = { log() {}, warn() {} };

// A logger that records what it was told, for asserting on warnings.
export function recorder() {
  const logs = [];
  const warns = [];
  return { log: (m) => logs.push(String(m)), warn: (m) => warns.push(String(m)), logs, warns };
}

let n = 0;
export function fresh(name = "t") {
  const d = join(outRoot, `${name}-${process.pid}-${n++}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

export function cleanOut() {
  rmSync(outRoot, { recursive: true, force: true });
}

// --- PNG ---------------------------------------------------------------
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// A valid solid-color RGB PNG of the given size.
export function makePng(w, h, rgb = [32, 138, 239]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- JPEG --------------------------------------------------------------
// Enough of a JPEG for a header reader: SOI, an APP0 segment, a COM
// segment (so the scanner has to skip something), then SOF0 with the size.
export function makeJpegHeader(w, h) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x07]), Buffer.from("hello")]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, com, sof, Buffer.from([0xff, 0xd9])]);
}

// --- Evidence dirs -----------------------------------------------------
// makeEvidence({ images: ["1-home.png", ...] | [{ name, w, h }], session: obj | null, videos: [...], sessionFiles: {...} })
export function makeEvidence(opts = {}) {
  const dir = fresh("ev");
  for (const img of opts.images || []) {
    const spec = typeof img === "string" ? { name: img } : img;
    const w = spec.w ?? 90;
    const h = spec.h ?? 195;
    const body = /\.jpe?g$/i.test(spec.name) ? makeJpegHeader(w, h) : makePng(w, h);
    writeFileSync(join(dir, spec.name), body);
  }
  for (const v of opts.videos || []) writeFileSync(join(dir, v), Buffer.from("not really a video"));
  if (opts.session !== undefined && opts.session !== null) {
    mkdirSync(join(dir, "session"), { recursive: true });
    writeFileSync(
      join(dir, "session", "session.json"),
      typeof opts.session === "string" ? opts.session : JSON.stringify(opts.session),
    );
  }
  for (const [name, text] of Object.entries(opts.sessionFiles || {})) {
    mkdirSync(join(dir, "session"), { recursive: true });
    writeFileSync(join(dir, "session", name), text);
  }
  return dir;
}

export function copyFixture() {
  const dir = fresh("fx");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

export const readFixtureSession = () =>
  JSON.parse(readFileSync(join(fixture, "session", "session.json"), "utf8"));

export const html = (siteDir) => readFileSync(join(siteDir, "index.html"), "utf8");

// The page body without its <script> blocks, for "no leaked values" checks.
export const htmlNoScript = (siteDir) => html(siteDir).replace(/<script>[\s\S]*?<\/script>/g, "");

// Runs the CLI. Returns { code, stdout, stderr }.
export function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: opts.cwd || root,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}
