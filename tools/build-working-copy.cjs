const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const project = path.resolve(__dirname, "..");
const original = path.join(project, "deployed-original");
const output = path.join(project, "foldable-game");
const originalIndex = path.join(original, "index.html");
const sourceCss = path.join(project, "foldable-src", "foldable.css");
const sourceJs = path.join(project, "foldable-src", "foldable.js");

const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const before = fs.readFileSync(originalIndex);
let html = before.toString("utf8");

const cloudflareMarker = "<script>(function(){function c(){var b=a.contentDocument";
const cloudflareStart = html.lastIndexOf(cloudflareMarker);
if (cloudflareStart >= 0) {
  const cloudflareEnd = html.indexOf("</script>", cloudflareStart);
  if (cloudflareEnd < 0) throw new Error("Cloudflare helper script did not have a closing tag");
  html = html.slice(0, cloudflareStart) + html.slice(cloudflareEnd + "</script>".length);
}

const viewport = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">',
  '<meta name="theme-color" content="#0a0e18">',
].join("\n");
html = `${viewport}\n${html}`;

const stageMarker = '<div id="stage">';
if (!html.includes(stageMarker)) throw new Error("Game stage marker was not found");
html = html.replace(stageMarker, '<link rel="stylesheet" href="./foldable.css">\n' + stageMarker);
html += '\n<script src="./foldable.js"></script>\n';

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "index.html"), html);
fs.copyFileSync(sourceCss, path.join(output, "foldable.css"));
fs.copyFileSync(sourceJs, path.join(output, "foldable.js"));

const after = fs.readFileSync(originalIndex);
if (hash(before) !== hash(after)) throw new Error("Original index.html changed while building the working copy");

const manifest = {
  sourceIndex: path.relative(project, originalIndex),
  sourceSha256: hash(before),
  sourceBytes: before.length,
  outputIndex: path.relative(project, path.join(output, "index.html")),
  outputSha256: hash(Buffer.from(html)),
  outputBytes: Buffer.byteLength(html),
  cloudflareDeploymentHelperRemoved: cloudflareStart >= 0,
  injected: ["viewport metadata", "foldable.css", "foldable.js"],
};
fs.writeFileSync(path.join(output, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

