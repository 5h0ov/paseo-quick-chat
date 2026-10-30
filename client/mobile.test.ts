import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * The client also runs in Paseo's phone app (React Native), so it can't use the browser: no DOM
 * globals, HTML elements or web-only props.
 */
const FORBIDDEN = [
  /\b(document|window|localStorage|sessionStorage|navigator)\./,
  /<(div|span|p|a|button|input|img|ul|ol|li|section|header|footer|main|nav|form|label|h[1-6]|table|tr|td|svg|path|br|hr)[ >/]/,
  /\bclassName=/,
  /\bonClick=/,
];

/** The only modules Paseo provides to client code (plugin reference, "Client runtime"). */
const HOST_MODULES = new Set([
  "@getpaseo/plugin",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
]);

it("keeps browser-only code out of the client", async () => {
  const roots = ["../client/", "../shared/"].map((dir) => new URL(dir, import.meta.url));
  const files = [new URL("../index.client.tsx", import.meta.url)];
  for (const root of roots) {
    for (const name of await readdir(root)) {
      if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(new URL(name, root));
    }
  }
  const problems: string[] = [];
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (FORBIDDEN.some((pattern) => pattern.test(line))) problems.push(`${fileURLToPath(file)}:${index + 1}: ${line.trim()}`);
      // Anything else fails at runtime with "Module ... is not available in plugin client code".
      const imported = /^\s*(?:import|export)\b.*?\bfrom\s+"([^"]+)"/.exec(line)?.[1];
      if (imported && !imported.startsWith(".") && !HOST_MODULES.has(imported)) {
        problems.push(`${fileURLToPath(file)}:${index + 1}: imports ${imported}, which Paseo doesn't provide to client code`);
      }
    });
  }
  expect(problems).toEqual([]);
});
