// Batch image generation via the kie.ai 4o Image API.
// Generates each entry in IMAGES[] and saves it to images/<filename>.
// Existing files are skipped so reruns don't re-charge you.
//
// Run from the project root:  node scripts/generate-images.mjs

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "images");

const GENERATE_URL = "https://api.kie.ai/api/v1/gpt4o-image/generate";
const RECORD_URL = "https://api.kie.ai/api/v1/gpt4o-image/record-info";

// 4o Image only accepts these aspect ratios.
const VALID_SIZES = new Set(["1:1", "3:2", "2:3"]);

// ---- The image set ---------------------------------------------------------
// Each entry: { prompt, size, filename }
const IMAGES = [
  // Products
  {
    filename: "product-notebook-pink.png",
    size: "1:1",
    prompt:
      "Modern flat vector illustration of a single closed personalized notebook standing upright at a slight angle, hot pink (#E8196E) cover with a subtle teal (#1DBDBD) elastic band, clean rounded corners, soft drop shadow, centered on a plain soft white (#F9F9F9) background, minimalist product illustration, smooth flat color fills, no text",
  },
  {
    filename: "product-notepad-teal.png",
    size: "1:1",
    prompt:
      "Modern flat vector illustration of a top-bound tear-off notepad lying flat, soft white (#F9F9F9) pages with a teal (#1DBDBD) header band and a thin hot pink (#E8196E) accent line, faint horizontal rule lines, soft drop shadow, centered on a plain soft white background, minimalist product illustration, smooth flat color fills, no readable text",
  },
  {
    filename: "product-bookmarks-set.png",
    size: "1:1",
    prompt:
      "Modern flat vector illustration of a set of three slim rectangular bookmarks with rounded tops and small tassels, fanned out side by side, one hot pink (#E8196E), one teal (#1DBDBD), one soft white (#F9F9F9) with thin colored stripes, simple geometric patterns, soft drop shadows, plain soft white background, minimalist product illustration, smooth flat color fills, no text",
  },
  {
    filename: "product-notebook-personalized.png",
    size: "1:1",
    prompt:
      'Modern flat vector illustration of a closed notebook standing upright, soft white (#F9F9F9) cover with the personalized name "Maria" in elegant hot pink (#E8196E) script lettering across the center and a small teal (#1DBDBD) underline flourish, clean rounded corners, soft drop shadow, plain soft white background, minimalist personalized stationery product illustration, smooth flat color fills',
  },
  {
    filename: "product-range-flatlay.png",
    size: "3:2",
    prompt:
      "Modern flat vector illustration, top-down flat lay of a personalized stationery collection neatly arranged: a hot pink (#E8196E) notebook, a teal (#1DBDBD) accented notepad, and a set of colorful bookmarks, plus a slim pen, on a plain soft white (#F9F9F9) surface, balanced composition, soft shadows, minimalist, cohesive hot pink and teal palette, smooth flat color fills, no text",
  },
  // Hero background
  {
    filename: "hero-bg.png",
    size: "3:2",
    prompt:
      "Modern minimal flat illustration hero background, airy soft white (#F9F9F9) scene with generous empty negative space across the center and upper area reserved for text overlay; subtle accents confined to the lower and side edges only, a few softly drawn stationery elements (a notebook corner, a bookmark, light dotted-paper texture) and gentle organic shapes in hot pink (#E8196E) and teal (#1DBDBD) at low opacity; very clean, uncluttered, light and breathable, smooth flat color fills, no text",
  },
  // Section illustrations
  {
    filename: "section-student.png",
    size: "3:2",
    prompt:
      "Modern flat vector illustration of a young student sitting at a desk writing in a personalized hot pink (#E8196E) notebook, relaxed friendly scene, a few books and a teal (#1DBDBD) cup nearby, warm and approachable, soft white (#F9F9F9) background with simple shapes, brand palette of hot pink and teal accents, minimalist editorial illustration, smooth flat color fills, soft shadows, no text",
  },
  {
    filename: "section-professional.png",
    size: "3:2",
    prompt:
      "Modern flat vector illustration of a young professional sitting at a tidy desk working — using a teal (#1DBDBD) notepad, with a laptop, a hot pink (#E8196E) mug, a small plant, and a hot pink bookmark nearby, warm and friendly, front-on view to match the student illustration, soft white (#F9F9F9) background, minimalist editorial illustration, smooth flat color fills, soft shadows, no text.",
  },
];
// ---------------------------------------------------------------------------

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

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createTask(apiKey, prompt, size) {
  const res = await fetch(GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, size, nVariants: 1 }),
  });
  const json = await res.json();
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(`create task failed (${json.code}): ${json.msg}`);
  }
  return json.data.taskId;
}

async function pollForResult(apiKey, taskId) {
  const deadline = Date.now() + 10 * 60 * 1000; // 10 min cap (3:2 scenes can take 7+ min)
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
      throw new Error(`generation failed: ${data.errorMessage}`);
    }
    const pct = (parseFloat(data?.progress ?? "0") * 100).toFixed(0);
    console.log(`    ...generating (${pct}%)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("timed out waiting for the image");
}

async function generateOne(apiKey, { prompt, size, filename }) {
  if (!VALID_SIZES.has(size)) {
    throw new Error(`invalid size "${size}" (use 1:1, 3:2, or 2:3)`);
  }
  const outFile = join(OUT_DIR, filename);
  if (await fileExists(outFile)) {
    console.log(`  skip (already exists): ${filename}`);
    return "skipped";
  }

  const taskId = await createTask(apiKey, prompt, size);
  console.log(`  task ${taskId} (${size})`);

  const urls = await pollForResult(apiKey, taskId);
  const imgRes = await fetch(urls[0]);
  if (!imgRes.ok) throw new Error(`download failed: HTTP ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());

  await writeFile(outFile, bytes);
  console.log(`  saved ${bytes.length} bytes -> images/${filename}`);
  return "generated";
}

async function main() {
  const apiKey = await loadApiKey();
  await mkdir(OUT_DIR, { recursive: true });

  const results = { generated: [], skipped: [], failed: [] };

  for (let i = 0; i < IMAGES.length; i++) {
    const entry = IMAGES[i];
    console.log(`\n[${i + 1}/${IMAGES.length}] ${entry.filename}`);
    try {
      const status = await generateOne(apiKey, entry);
      results[status === "skipped" ? "skipped" : "generated"].push(entry.filename);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.failed.push(entry.filename);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Generated: ${results.generated.length}`, results.generated);
  console.log(`Skipped:   ${results.skipped.length}`, results.skipped);
  console.log(`Failed:    ${results.failed.length}`, results.failed);
  if (results.failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
