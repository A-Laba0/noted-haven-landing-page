// Cheap one-off test of the kie.ai 4o Image API.
// Generates a single square image and saves it to images/.
// Run from the project root:  node scripts/generate-test-image.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PROMPT = "a flat illustration of a cup of coffee";
const SIZE = "1:1";
const OUT_DIR = join(ROOT, "images");
const OUT_FILE = join(OUT_DIR, "test-coffee.png");

const GENERATE_URL = "https://api.kie.ai/api/v1/gpt4o-image/generate";
const RECORD_URL = "https://api.kie.ai/api/v1/gpt4o-image/record-info";

// Minimal .env parser so we don't need a dependency.
async function loadApiKey() {
  let raw;
  try {
    raw = await readFile(join(ROOT, ".env"), "utf8");
  } catch {
    throw new Error("Could not read .env in the project root.");
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*KIE_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("KIE_API_KEY not found in .env");
}

async function createTask(apiKey) {
  const res = await fetch(GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: PROMPT, size: SIZE, nVariants: 1 }),
  });
  const json = await res.json();
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(`Create task failed (${json.code}): ${json.msg}`);
  }
  return json.data.taskId;
}

async function pollForResult(apiKey, taskId) {
  const deadline = Date.now() + 5 * 60 * 1000; // 5 min cap
  while (Date.now() < deadline) {
    const res = await fetch(`${RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const { data } = await res.json();
    // The live API returns `resultUrls` (camelCase); docs show `result_urls`.
    if (data?.successFlag === 1) {
      return data.response.resultUrls ?? data.response.result_urls;
    }
    if (data?.successFlag === 2) {
      throw new Error(`Generation failed: ${data.errorMessage}`);
    }
    const pct = (parseFloat(data?.progress ?? "0") * 100).toFixed(0);
    console.log(`  ...generating (${pct}%)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for the image.");
}

async function main() {
  const apiKey = await loadApiKey();

  console.log(`Prompt: "${PROMPT}" (${SIZE})`);
  const taskId = await createTask(apiKey);
  console.log(`Task created: ${taskId}`);

  const urls = await pollForResult(apiKey, taskId);
  console.log(`Done. Image URL: ${urls[0]}`);

  const imgRes = await fetch(urls[0]);
  if (!imgRes.ok) throw new Error(`Download failed: HTTP ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, bytes);
  console.log(`Saved ${bytes.length} bytes to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
