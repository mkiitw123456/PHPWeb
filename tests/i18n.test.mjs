import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "@babel/parser";
const parseFile = async (file) =>
  parse(await readFile(new URL("../" + file, import.meta.url), "utf8"), {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const [key, v] of Object.entries(node)) {
    if (["loc", "extra", "comments", "tokens"].includes(key)) continue;
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn));
    else if (v && typeof v === "object") walk(v, fn);
  }
}
test("Every static Chinese UI label, role and image error has a Filipino translation", async () => {
  const translations = new Map();
  walk(await parseFile("src/translations.ts"), (n) => {
    if (
      n.type === "ObjectProperty" &&
      (n.key.type === "StringLiteral" || n.key.type === "Identifier") &&
      n.value.type === "StringLiteral"
    )
      translations.set(n.key.value ?? n.key.name, n.value.value);
  });
  const missing = [];
  for (const file of ["src/App.tsx", "src/Admin.tsx", "src/components.tsx"]) {
    walk(await parseFile(file), (n) => {
      if (n.type === "JSXText" && /[\u3400-\u9fff]/.test(n.value))
        missing.push(`${file}: raw JSX ${n.value.trim()}`);
      if (
        n.type === "JSXAttribute" &&
        n.value?.type === "StringLiteral" &&
        /[\u3400-\u9fff]/.test(n.value.value)
      )
        missing.push(`${file}: raw attribute ${n.value.value}`);
      if (
        n.type === "CallExpression" &&
        n.callee?.name === "t" &&
        n.arguments[0]?.type === "StringLiteral" &&
        !translations.has(n.arguments[0].value)
      )
        missing.push(`${file}: ${n.arguments[0].value}`);
    });
  }
  for (const file of ["src/api.ts", "src/types.ts"])
    walk(await parseFile(file), (n) => {
      if (
        (n.type === "NewExpression" && n.callee.name === "Error") ||
        (n.type === "ObjectProperty" &&
          ["admin", "user", "player"].includes(n.key.name))
      ) {
        const text = n.arguments?.[0]?.value ?? n.value?.value;
        if (
          typeof text === "string" &&
          /[\u3400-\u9fff]/.test(text) &&
          !translations.has(text)
        )
          missing.push(text);
      }
    });
  assert.deepEqual(missing, []);
  for (const [zh, fil] of translations) {
    assert.ok(fil.trim(), zh);
    assert.equal(/[\u3400-\u9fff]/.test(fil), false, zh);
    assert.deepEqual(
      zh.match(/\{\w+\}/g),
      fil.match(/\{\w+\}/g),
      `Interpolation: ${zh}`,
    );
  }
});
