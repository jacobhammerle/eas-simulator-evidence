import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, pairsToObject } from "../src/args.mjs";

test("command, positionals, and --key value", () => {
  const a = parseArgs(["build", "./ev", "--subject", "PR #12", "--out", "site"]);
  assert.equal(a.command, "build");
  assert.deepEqual(a.positional, ["./ev"]);
  assert.equal(a.subject, "PR #12");
  assert.equal(a.out, "site");
});

test("--key=value, including values that contain =", () => {
  const a = parseArgs(["build", "--subject=PR #12", "--verdict=PASS: a=b"]);
  assert.equal(a.subject, "PR #12");
  assert.equal(a.verdict, "PASS: a=b");
});

test("kebab-case keys become camelCase", () => {
  const a = parseArgs(["build", "--build-id", "abc", "--verdict-file", "v.txt", "--eas-cli-version", "24.0.0"]);
  assert.equal(a.buildId, "abc");
  assert.equal(a.verdictFile, "v.txt");
  assert.equal(a.easCliVersion, "24.0.0");
});

test("flags take no value and default to undefined", () => {
  const a = parseArgs(["build", "--json", "x", "--badge"], { flags: ["json", "badge", "help"] });
  assert.equal(a.json, true);
  assert.equal(a.badge, true);
  assert.equal(a.help, undefined);
  assert.deepEqual(a.positional, ["x"]);
});

test("flags accept an explicit =false", () => {
  const a = parseArgs(["build", "--json=false"], { flags: ["json"] });
  assert.equal(a.json, false);
});

test("repeatable options collect into an array, empty by default", () => {
  const a = parseArgs(["collect", "d", "--extra", "a=1", "--extra", "b=2=3"], { repeat: ["extra"] });
  assert.deepEqual(a.extra, ["a=1", "b=2=3"]);
  assert.deepEqual(parseArgs(["collect"], { repeat: ["extra"] }).extra, []);
});

test("a value that looks like an option is a value when given with =", () => {
  const a = parseArgs(["verdict", "--fallback=--weird"]);
  assert.equal(a.fallback, "--weird");
});

test("a missing value is an error", () => {
  assert.throws(() => parseArgs(["build", "--subject"]), /--subject needs a value/);
  assert.throws(() => parseArgs(["build", "--subject", "--out", "x"]), /--subject needs a value/);
});

test("-- ends option parsing", () => {
  const a = parseArgs(["verdict", "--", "--not-an-option", "x"]);
  assert.deepEqual(a.positional, ["--not-an-option", "x"]);
});

test("empty argv", () => {
  const a = parseArgs([]);
  assert.equal(a.command, undefined);
  assert.deepEqual(a.positional, []);
});

test("later values win", () => {
  assert.equal(parseArgs(["b", "--out", "1", "--out", "2"]).out, "2");
});

test("a value may be an empty string", () => {
  assert.equal(parseArgs(["b", "--subject", ""]).subject, "");
  assert.equal(parseArgs(["b", "--subject="]).subject, "");
});

test("pairsToObject", () => {
  assert.deepEqual(pairsToObject(["a=1", "b=x=y", "c=", "=z", "d"]), { a: "1", b: "x=y", c: "", d: "" });
  assert.deepEqual(pairsToObject(undefined), {});
  assert.deepEqual(pairsToObject([]), {});
});
