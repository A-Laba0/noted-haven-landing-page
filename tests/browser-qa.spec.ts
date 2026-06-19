import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

// Browser QA sweep: crawl every INTERNAL link reachable from the home page's
// nav + footer, verify each page loads cleanly, screenshot it, check the
// contact form's required-field validation, then emit a markdown report.

const SCREENSHOT_DIR = path.join('tests', 'screenshots');
const REPORT_PATH = path.join('tests', 'qa-report.md');

// Text that signals a broken page. Kept specific to avoid matching real copy.
const ERROR_MARKERS = [
  '404: not_found',
  '404 not found',
  'page not found',
  'this page could not be found',
  'application error',
  'internal server error',
  'cannot get',
];

type QaRow = {
  name: string;
  url: string;
  status: string;
  hasNav: boolean;
  hasFooter: boolean;
  screenshot: string;
};

// Slug for a screenshot filename, derived from the URL pathname.
function slugForUrl(rawUrl: string): string {
  const { pathname } = new URL(rawUrl);
  const base = pathname.replace(/\/+$/, '').split('/').pop() || 'home';
  const stem = base.replace(/\.[a-z0-9]+$/i, '');
  return (stem || 'home').replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
}

// A page "has nav" if it exposes a <nav> or a site-header; "has footer" if a <footer> exists.
async function inspectChrome(page: Page): Promise<{ hasNav: boolean; hasFooter: boolean }> {
  const hasNav = (await page.locator('nav, header.site-header, .nav-links, .topbar').count()) > 0;
  const hasFooter = (await page.locator('footer').count()) > 0;
  return { hasNav, hasFooter };
}

async function findErrorText(page: Page): Promise<string | null> {
  const body = (await page.locator('body').innerText()).toLowerCase();
  return ERROR_MARKERS.find((m) => body.includes(m)) ?? null;
}

test('browser QA across all internal pages', async ({ page }) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const rows: QaRow[] = [];

  // ── 1. Home page ──────────────────────────────────────────────
  await test.step('Open home page and screenshot it', async () => {
    console.log('\n▶ Visiting home page ("/")…');
    const resp = await page.goto('/');
    const status = resp ? String(resp.status()) : 'n/a';
    expect.soft(resp?.ok(), `home should return 2xx, got ${status}`).toBeTruthy();

    const shotPath = path.join(SCREENSHOT_DIR, 'home.png');
    await page.screenshot({ path: shotPath, fullPage: true });

    const { hasNav, hasFooter } = await inspectChrome(page);
    rows.push({
      name: (await page.title()) || 'Home',
      url: page.url(),
      status,
      hasNav,
      hasFooter,
      screenshot: shotPath,
    });
    console.log(`  ✓ Home loaded (HTTP ${status}), screenshot -> ${shotPath}`);
  });

  // ── 2. Collect internal links from nav + footer ──────────────
  let internalLinks: string[] = [];
  await test.step('Collect internal links from the whole page (nav, body, footer)', async () => {
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));

    const siteHost = new URL(page.url()).host;
    const seen = new Set<string>();
    // Seed with home so pure same-page hash links (#products, #top) are skipped.
    seen.add(new URL(page.url()).origin + new URL(page.url()).pathname);

    const skipped: string[] = [];
    for (const href of hrefs) {
      let u: URL;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      // Skip non-web protocols (mailto:, tel:) and cross-domain links.
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        skipped.push(href);
        continue;
      }
      if (u.host !== siteHost) {
        skipped.push(href);
        continue;
      }
      const key = u.origin + u.pathname; // identify by page, ignoring #hash / ?query
      if (seen.has(key)) continue;
      seen.add(key);
      internalLinks.push(u.origin + u.pathname); // visit without the hash
    }

    console.log(`\n▶ Found ${hrefs.length} links across the page.`);
    console.log(`  • Internal pages to visit: ${internalLinks.length ? internalLinks.join(', ') : '(none)'}`);
    console.log(`  • Skipped (external / mailto / same-page): ${skipped.length}`);
  });

  // ── 3. Visit each internal page ──────────────────────────────
  for (const link of internalLinks) {
    await test.step(`Visit internal page: ${link}`, async () => {
      console.log(`\n▶ Visiting ${link}…`);
      const resp = await page.goto(link);
      const status = resp ? String(resp.status()) : 'n/a';

      const errText = await findErrorText(page);
      const { hasNav, hasFooter } = await inspectChrome(page);

      const shotPath = path.join(SCREENSHOT_DIR, `${slugForUrl(link)}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });

      rows.push({
        name: (await page.title()) || link,
        url: link,
        status,
        hasNav,
        hasFooter,
        screenshot: shotPath,
      });

      console.log(`  ✓ Loaded (HTTP ${status}), nav=${hasNav}, footer=${hasFooter}, screenshot -> ${shotPath}`);

      // Soft asserts: record + check every page, then fail at the end if anything broke.
      expect.soft(resp?.ok(), `${link} should return HTTP 200, got ${status}`).toBeTruthy();
      expect.soft(errText, errText ? `${link} shows error text: "${errText}"` : undefined).toBeNull();
    });
  }

  // ── 4. Return home ───────────────────────────────────────────
  await test.step('Return to home page', async () => {
    await page.goto('/');
    console.log('\n▶ Returned to home page.');
  });

  // ── 5. Empty-form validation ─────────────────────────────────
  await test.step('Empty contact form is blocked by required-field validation', async () => {
    const form = page.locator('.contact-form');
    await form.scrollIntoViewIfNeeded();
    await page.click('.contact-form button[type="submit"]');

    // Native HTML5 validation should stop the submit handler from ever running,
    // so the success confirmation must NOT appear and the form stays put.
    await expect(page.locator('.contact-confirm')).toHaveCount(0);

    const formValid = await form.evaluate((f) => (f as HTMLFormElement).checkValidity());
    expect(formValid, 'empty form should be invalid').toBe(false);

    const nameValid = await page
      .locator('#contact-name')
      .evaluate((el) => (el as HTMLInputElement).validity.valid);
    expect(nameValid, 'required name field should be invalid when empty').toBe(false);

    console.log('  ✓ Empty submission blocked — required-field validation kicked in');
  });

  // ── 6. Write the markdown report ─────────────────────────────
  await test.step('Write markdown QA report', async () => {
    const header =
      '| Page name | URL | Status | Has nav | Has footer | Screenshot path |\n' +
      '| --- | --- | --- | --- | --- | --- |\n';
    const body = rows
      .map((r) => {
        const name = r.name.replace(/\|/g, '\\|');
        const nav = r.hasNav ? '✅' : '❌';
        const footer = r.hasFooter ? '✅' : '❌';
        return `| ${name} | ${r.url} | ${r.status} | ${nav} | ${footer} | ${r.screenshot} |`;
      })
      .join('\n');

    const report =
      `# Browser QA Report\n\n` +
      `Pages checked: ${rows.length}\n\n` +
      header +
      body +
      '\n';

    writeFileSync(REPORT_PATH, report, 'utf8');
    console.log(`\n▶ Report written to ${REPORT_PATH} (${rows.length} pages).`);
  });
});
