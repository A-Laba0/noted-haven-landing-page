// Generates the two matched scroll-animation frames (START blueprint / END finished)
// via the kie.ai 4o Image API, at 3:2 (the API's widest landscape).
// Saves the raw 3:2 frames as *-32-src.png; an ffmpeg step later center-crops
// them identically to 16:9. Existing files are skipped so reruns don't re-charge.
//
// Run from the project root:  node scripts/generate-showcase-frames.mjs

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "images");

const GENERATE_URL = "https://api.kie.ai/api/v1/gpt4o-image/generate";
const RECORD_URL = "https://api.kie.ai/api/v1/gpt4o-image/record-info";

const VALID_SIZES = new Set(["1:1", "3:2", "2:3"]);

// Both frames share an identical framing block so they line up for a clean morph.
const IMAGES = [
  {
    filename: "start-blueprint-32-src.png",
    size: "3:2",
    prompt:
      "A technical blueprint line-drawing of a single spiral-bound notebook, shown at a 3/4 front angle, standing upright and centered in frame, occupying the middle 60% of the image. Thin precise blue construction lines on a plain soft-white (#F9F9F9) background — like an architect's blueprint or CAD wireframe: clean outlines of the cover, the twin-ring spiral binding along the left edge, and the page edges, with light dashed guide lines and faint construction marks. No color fill, no shading, no gradients. Flat even studio lighting, no shadows. Centered composition, generous even margins. No text, no lettering, no people, no hands. Minimal, crisp, schematic.",
  },
  {
    filename: "end-finished-32-src.png",
    size: "3:2",
    prompt:
      "A photorealistic product shot of the exact same single spiral-bound notebook in the exact same 3/4 front angle, standing upright and centered in frame, occupying the middle 60% of the image — identical size, position, and proportions to the blueprint. A premium notebook with a hot pink (#E8196E) matte cover, subtle teal (#1DBDBD) accents along the edge and binding, and a clean silver-white twin-ring spiral binding on the left. Plain soft-white (#F9F9F9) seamless background, soft even diffused studio lighting with a gentle natural contact shadow. High-end stationery catalog look, sharp focus, realistic paper and cover texture. Centered composition, generous even margins. No text, no lettering, no logos, no people, no hands.",
  },
];

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
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const { data } = await res.json();
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
