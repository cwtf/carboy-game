import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.argv[2] ?? "deployed-original/index.html");
const html = readFileSync(file, "utf8");

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
const markupRefs = [...html.matchAll(/\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]);
const sourceMaps = [...html.matchAll(/[#@]\s*sourceMappingURL\s*=\s*([^\s*]+)/gi)].map((m) => m[1]);
const extensionStrings = [...html.matchAll(/(["'`])((?:(?!\1).)*?\.(?:m?js|css|map|wasm|json|webmanifest|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a|aac|flac|glb|gltf|bin|ktx2?|basis|mp4|webm)(?:\?[^"'`\s]*)?)\1/gi)].map((m) => m[2]);
const absoluteUrls = [...html.matchAll(/https?:\/\/[^\s"'`<>)\\]+/gi)].map((m) => m[0]);
const assetPaths = [...html.matchAll(/\/assets\/[A-Za-z0-9._~!$&()*+,;=:@%/-]+/g)].map((m) => m[0]);

const uniq = (items) => [...new Set(items)].sort();
const result = {
  file,
  bytes: Buffer.byteLength(html),
  characters: html.length,
  lines: html.split("\n").length,
  scriptBlocks: scripts.map((m, index) => ({ index, attributes: m[1].trim(), bytes: Buffer.byteLength(m[2]) })),
  styleBlocks: styles.map((m, index) => ({ index, attributes: m[1].trim(), bytes: Buffer.byteLength(m[2]) })),
  markupRefs: uniq(markupRefs),
  sourceMaps: uniq(sourceMaps),
  extensionStrings: uniq(extensionStrings),
  assetPaths: uniq(assetPaths),
  absoluteUrls: uniq(absoluteUrls),
};

console.log(JSON.stringify(result, null, 2));

