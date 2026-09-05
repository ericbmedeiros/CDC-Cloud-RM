import fs from "node:fs";
import https from "node:https";

const NOTION_TOKEN = "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";
const PAGE_ID = "70cbd5429ec38371a96d81e62c92929d";

function notionRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: `/v1${endpoint}`,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'User-Agent': 'NodeJS-Script'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

function extractIdsFromRichText(richTextArray) {
  const ids = [];
  if (!Array.isArray(richTextArray)) return ids;
  for (const item of richTextArray) {
    if (item.type === "mention" && item.mention && item.mention.type === "page" && item.mention.page) {
      ids.push(item.mention.page.id);
    }
  }
  return ids;
}

async function getBlockContent(blockId) {
  let text = "";
  const subPageIds = [];

  try {
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const url = `/blocks/${blockId}/children?page_size=100` + (startCursor ? `&start_cursor=${startCursor}` : '');
      const data = await notionRequest(url);

      for (const block of data.results) {
        if (block.type === "child_page") {
          subPageIds.push(block.id);
          continue;
        }

        if (block.type === "link_to_page" && block.link_to_page) {
          const ltp = block.link_to_page;
          if (ltp.type === "page_id" && ltp.page_id) subPageIds.push(ltp.page_id);
          continue;
        }

        // Leitura de Imagens no Notion
        if (block.type === "image" && block.image) {
          const imgUrl = block.image.type === "file" ? block.image.file.url : block.image.external.url;
          if (imgUrl) {
            text += `\n![Imagem](${imgUrl})\n`;
          }
          continue;
        }

        const btype = block.type;
        if (block[btype]) {
          if (block[btype].rich_text && Array.isArray(block[btype].rich_text)) {
            text += "\n" + block[btype].rich_text.map(t => t.plain_text).join("");
            subPageIds.push(...extractIdsFromRichText(block[btype].rich_text));
          }
          if (block[btype].title && Array.isArray(block[btype].title)) {
            text += "\n" + block[btype].title.map(t => t.plain_text).join("");
            subPageIds.push(...extractIdsFromRichText(block[btype].title));
          }
        }

        if (block.has_children) {
          const inner = await getBlockContent(block.id);
          text += "\n" + inner.text;
          subPageIds.push(...inner.subPageIds);
        }
      }

      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }
  } catch (e) {}

  return { text, subPageIds };
}

const visitedPages = new Set();

async function scanPageRecursively(pageId, parentPath = []) {
  const cleanId = pageId.replaceAll("-", "");
  if (visitedPages.has(cleanId)) return [];
  visitedPages.add(cleanId);

  const docs = [];
  try {
    const page = await notionRequest(`/pages/${pageId}`);
    let title = "Sem título";

    if (page.properties) {
      const titleProp = Object.values(page.properties).find(p => p.id === "title" || p.type === "title");
      if (titleProp && titleProp.title && titleProp.title.length > 0) {
        title = titleProp.title.map(t => t.plain_text).join("");
      }
    }

    const currentPath = [...parentPath, title];
    const pathString = currentPath.join(" > ");
    console.log(`Indexando: ${pathString}`);

    const { text, subPageIds } = await getBlockContent(pageId);

    docs.push({
      id: page.id,
      title: title,
      path: pathString,
      url: page.url || null,
      text: (title + "\n\n" + text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
    });

    for (const childId of subPageIds) {
      const childDocs = await scanPageRecursively(childId, currentPath);
      docs.push(...childDocs);
    }
  } catch (err) {}

  return docs;
}

async function main() {
  console.log("Iniciando varredura a partir da raiz SUPORTE...");
  const docs = await scanPageRecursively(PAGE_ID);

  const payload = {
    generatedAt: new Date().toISOString(),
    count: docs.length,
    docs
  };

  const jsonContent = JSON.stringify(payload, null, 2);
  fs.writeFileSync("./docs.json", jsonContent, "utf8");
  fs.writeFileSync("./docs.js", `const DATA = ${jsonContent};`, "utf8");

  console.log(`\nSucesso! ${docs.length} páginas indexadas com sucesso.`);
}

main();