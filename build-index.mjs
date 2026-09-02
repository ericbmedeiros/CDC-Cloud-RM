// Gera docs.json a partir de um export do Notion (Markdown)
// Uso: node build-index.mjs ./export ./docs.json
import fs from "node:fs";
import path from "node:path";

const [,, inDir, outFile] = process.argv;
if (!inDir || !outFile) {
  console.error("Uso: node build-index.mjs ./export ./docs.json");
  process.exit(1);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function stripMd(md) {
  return md
    // remove imagens/embeds
    .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, " ")
    // links [texto](url) -> texto
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, "$1")
    // code blocks
    .replace(/```[\\s\\S]*?```/g, " ")
    // inline code
    .replace(/`[^`]*`/g, " ")
    // headings/quotes/bullets markers
    .replace(/^\\s{0,3}(#+|>|-|\\*|\\d+\\.)\\s+/gm, "")
    // html tags (às vezes o export inclui)
    .replace(/<[^>]+>/g, " ")
    // espaços
    .replace(/\\s+/g, " ")
    .trim();
}

const mdFiles = walk(inDir).filter(f => f.toLowerCase().endsWith(".md"));

// Heurística: título vem do nome do arquivo (Notion exporta "Título xxxx.md")
const docs = mdFiles.map(f => {
  const fileName = path.basename(f, ".md");
  const raw = fs.readFileSync(f, "utf8");
  const text = stripMd(raw);
  return {
    id: f.replaceAll(path.sep, "/"),
    title: fileName,
    // opcional: você pode adicionar uma url pública depois, se quiser mapear
    url: null,
    text
  };
});

fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), count: docs.length, docs }, null, 2));
console.log(`OK: ${docs.length} docs -> ${outFile}`);