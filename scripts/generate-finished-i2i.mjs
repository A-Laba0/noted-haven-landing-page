// Image-to-image pass: regenerate ONLY the finished frame, using the blueprint
// as an exact geometry reference so the angle/size/position match.
//
// Uses the 3:2 source blueprint (start-blueprint-32-src.png) as the reference and
// outputs 3:2, so the later identical center-crop to 16:9 keeps it registered to
// the existing 16:9 start-blueprint.png. The blueprint files are never modified.
//
// Run from the project root:  node scripts/generate-finished-i2i.mjs

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "images");

const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
const GENERATE_URL = "https://api.kie.ai/api/v1/gpt4o-image/generate";
const RECORD_URL = "https://api.kie.ai/api/v1/gpt4o-image/record-info";

const REFERENCE_FILE = "start-blueprint-32-src.png"; // 3:2 source of the blueprint
const OUT_SRC = "end-finished-i2i-32-src.png";        // raw 3:2 result (kept for reproducibility)
const SIZE = "3:2";

const PROMPT =
  "Using the provided blueprint line-drawing as an exact geometry reference, render the SAME spiral-bound notebook as a finished, photorealistic product. Keep the identical 3/4 front angle, the identical size, position, and proportions, and the twin-ring spiral binding on the left — do not move, resize, rotate, or re-angle the notebook from the reference. A premium notebook with a hot pink (#E8196E) matte cover, subtle teal (#1DBDBD) accents along the edge and binding, and a clean silver-white twin-ring spiral binding. Plain soft-white (#F9F9F9) seamless background, soft even diffused studio lighting with a gentle natural contact shadow, sharp focus, realistic paper and cover texture, high-end stationery catalog look. No text, no lettering, no logos, no people, no hands.";

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

async function uploadReference(apiKey, filename) {
  const bytes = await readFile(join(OUT_DIR, filename));
  const base64Data = `data:image/png;base64,${bytes.toString("base64")}`;

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Data,
      uploadPath: "images/showcase-refs",
      fileName: filename,
    }),
  });
  const json = await res.json();
  const url = json?.data?.downloadUrl;
  if (!json?.success || !url) {
    throw new Error(`upload failed (${json?.code}): ${json?.msg ?? "no downloadUrl"}`);
  }
  return url;
}

async function createTask(apiKey, prompt, size, filesUrl) {
  const res = await fetch(GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, size, filesUrl }),
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
    console.log(`  ...generating (${pct}%)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("timed out waiting for the image");
}

async function main() {
  const apiKey = await loadApiKey();
  await mkdir(OUT_DIR, { recursive: true });

  try {
    await access(join(OUT_DIR, REFERENCE_FILE));
  } catch {
    throw new Error(`reference not found: images/${REFERENCE_FILE}`);
  }

  console.log(`Uploading reference: ${REFERENCE_FILE}`);
  const refUrl = await uploadReference(apiKey, REFERENCE_FILE);
  console.log(`  reference URL: ${refUrl}`);

  console.log(`Creating image-to-image task (${SIZE})`);
  const taskId = await createTask(apiKey, PROMPT, SIZE, [refUrl]);
  console.log(`  task ${taskId}`);

  const urls = await pollForResult(apiKey, taskId);
  const imgRes = await fetch(urls[0]);
  if (!imgRes.ok) throw new Error(`download failed: HTTP ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());

  await writeFile(join(OUT_DIR, OUT_SRC), bytes);
  console.log(`Saved ${bytes.length} bytes -> images/${OUT_SRC}`);
  console.log(`Next: center-crop images/${OUT_SRC} to 16:9 over images/end-finished.png`);
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
