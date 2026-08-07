const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(process.argv[2] || "deployed-original");
const indexPath = path.join(root, "index.html");
const html = fs.readFileSync(indexPath, "utf8");

const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const writeAsset = (relativePath, buffer, origin) => {
  const target = path.join(root, relativePath.replace(/^\//, ""));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return {
    path: relativePath.replace(/^\//, ""),
    bytes: buffer.length,
    sha256: hash(buffer),
    origin,
  };
};

const wasmMatch = html.match(/var b64 = "([A-Za-z0-9+/=]+)";/);
if (!wasmMatch) throw new Error("Embedded Havok WebAssembly payload was not found");

const audioMatch = html.match(/globalThis\.__CARBOY_AUDIO__ = (\{[\s\S]*?\});\s*globalThis\.__CARBOY_MUSIC__ = (\{[\s\S]*?\});/);
if (!audioMatch) throw new Error("Embedded CARBOY audio maps were not found");

const audio = { ...JSON.parse(audioMatch[1]), ...JSON.parse(audioMatch[2]) };
const files = [
  writeAsset("assets/HavokPhysics-BqNY-4N9.wasm", Buffer.from(wasmMatch[1], "base64"), "embedded __CARBOY_WASM__ payload"),
];

const sfxPaths = { coin: "audio/coin-drop.ogg", impact: "audio/metal-impact.ogg", engine: "audio/engine-loop.ogg" };
for (const [url, dataUri] of Object.entries(audio)) {
  const dataMatch = dataUri.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!dataMatch) throw new Error(`Unsupported embedded audio URI for ${url}`);
  files.push(writeAsset(sfxPaths[url] || url, Buffer.from(dataMatch[2], "base64"), `embedded ${dataMatch[1]} data URI`));
}

for (const relativePath of [
  "index.html",
  "response-headers.txt",
  "cdn-cgi/challenge-platform/scripts/jsd/main.js",
  "cdn-cgi/challenge-platform/scripts/jsd/main.headers.txt",
]) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) continue;
  const buffer = fs.readFileSync(target);
  files.unshift({ path: relativePath, bytes: buffer.length, sha256: hash(buffer), origin: "downloaded HTTP response" });
}

const manifest = {
  source: "https://carboy.chickanerygroup.chatgpt.site/",
  capturedAt: fs.statSync(indexPath).mtime.toISOString(),
  note: "The deployed game references static WASM/audio paths, but those URLs returned 404. The browser-ready bytes are embedded in index.html and were decoded here without changing index.html.",
  files,
};
fs.writeFileSync(path.join(root, "download-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

