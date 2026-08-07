const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const project = path.resolve(__dirname, "..");
const source = path.join(project, "foldable-game");
const output = project;
const files = ["index.html", "foldable.css", "foldable.js"];

for (const file of files) {
  if (!fs.existsSync(path.join(source, file))) throw new Error(`Missing built site file: ${file}`);
}

fs.mkdirSync(output, { recursive: true });

let html = fs.readFileSync(path.join(source, "index.html"), "utf8");
if (!/<meta\s+charset=/i.test(html.slice(0, 1024))) html = `<meta charset="utf-8">\n${html}`;
const metadata = [
  "<title>CAR BOY</title>",
  '<meta name="description" content="CAR BOY — Trouble in Paradise">',
  '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%230a0e18%22/%3E%3Cpath d=%22M12 43V25l10-9h20l10 9v18h-7a9 9 0 0 1-18 0h-2a9 9 0 0 1-18 0z%22 fill=%22%23ffd23f%22/%3E%3Ccircle cx=%2216%22 cy=%2243%22 r=%225%22 fill=%22%231b2230%22/%3E%3Ccircle cx=%2240%22 cy=%2243%22 r=%225%22 fill=%22%231b2230%22/%3E%3C/svg%3E">',
].join("\n");
const themeMarker = '<meta name="theme-color" content="#0a0e18">';
if (!html.includes(themeMarker)) throw new Error("Theme metadata marker not found in built index");
html = html.replace(themeMarker, `${themeMarker}\n${metadata}`);

fs.writeFileSync(path.join(output, "index.html"), html);
fs.copyFileSync(path.join(source, "foldable.css"), path.join(output, "foldable.css"));
fs.copyFileSync(path.join(source, "foldable.js"), path.join(output, "foldable.js"));
fs.writeFileSync(path.join(output, ".nojekyll"), "");

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const manifest = files.map((file) => {
  const target = path.join(output, file);
  return { file, bytes: fs.statSync(target).size, sha256: sha256(target) };
});

const externalMarkupRefs = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
  .map((match) => match[1])
  .filter((reference) => !reference.startsWith("./") && !reference.startsWith("data:") && !reference.startsWith("#") && !reference.includes("${"));
if (externalMarkupRefs.length) throw new Error(`Unexpected non-local markup references: ${externalMarkupRefs.join(", ")}`);

console.log(JSON.stringify({
  output: path.relative(project, output) || ".",
  files: [".nojekyll", ...manifest.map((item) => item.file)],
  manifest,
  externalMarkupRefs,
}, null, 2));

