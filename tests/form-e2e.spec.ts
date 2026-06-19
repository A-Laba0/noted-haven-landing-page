import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// End-to-end test for the Noted Haven contact form:
//   browser submit -> success message -> verify the row really landed in Supabase.
//
// Env (SUPABASE_URL / SUPABASE_ANON_KEY) is loaded by `import 'dotenv/config'`
// at the top of playwright.config.ts, so process.env is already populated here.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// All test emails share this prefix so teardown can find and remove them.
const TEST_EMAIL_PREFIX = 'playwright-test+';

function makeSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_ANON_KEY. Ensure they are set in .env ' +
        "(playwright.config.ts loads it via import 'dotenv/config').",
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

test.describe('Contact form end-to-end', () => {
  test('submits the form and persists the row to Supabase', async ({ page }) => {
    // Unique per run so a verify match (and any leftover row) is unambiguous.
    const uniqueEmail = `${TEST_EMAIL_PREFIX}${Date.now()}@example.com`;
    const testName = 'Playwright Test User';
    const testMessage = 'This is an automated test submission';

    console.log(`\n▶ Test email for this run: ${uniqueEmail}`);

    await test.step('Open the site and scroll to the contact form', async () => {
      console.log('  • Navigating to baseURL "/"…');
      await page.goto('/');

      const form = page.locator('.contact-form');
      await form.scrollIntoViewIfNeeded();
      await expect(form, 'contact form should be present on the page').toBeVisible();
      console.log('  ✓ Contact form is visible');
    });

    await test.step('Fill in the form fields', async () => {
      await page.fill('#contact-name', testName);
      await page.fill('#contact-email', uniqueEmail);
      await page.fill('#contact-message', testMessage);
      console.log(`  ✓ Filled name="${testName}", email="${uniqueEmail}", message set`);
    });

    await test.step('Submit and wait for the success message (<= 5s)', async () => {
      await page.click('.contact-form button[type="submit"]');
      console.log('  • Submitted — waiting for the confirmation message…');

      const confirm = page.locator('.contact-confirm');
      await expect(confirm, 'success confirmation should appear within 5s').toBeVisible({
        timeout: 5000,
      });
      await expect(confirm).toContainText("Thanks! We'll be in touch soon.");
      console.log('  ✓ Success message appeared');
    });

    await test.step('Verify the row was created in Supabase', async () => {
      const supabase = makeSupabase();
      console.log(`  • Querying signups for email="${uniqueEmail}"…`);

      const { data, error } = await supabase
        .from('signups')
        .select('name, email, message')
        .eq('email', uniqueEmail);

      expect(error, error ? `Supabase query error: ${error.message}` : undefined).toBeNull();
      expect(data, 'a matching signups row should exist').not.toBeNull();
      expect(data!.length, 'exactly one row should match the unique email').toBe(1);

      const row = data![0];
      expect(row.name).toBe(testName);
      expect(row.email).toBe(uniqueEmail);
      expect(row.message).toBe(testMessage);
      console.log('  ✓ Row found in Supabase with matching name, email, and message');
    });
  });
});

// Teardown: remove every row this suite (or prior runs) created, so the
// signups table stays clean. Matches any email under the test prefix.
test.afterAll(async () => {
  const supabase = makeSupabase();
  console.log(`\n▶ Teardown: deleting signups with email LIKE "${TEST_EMAIL_PREFIX}%"…`);

  const { data, error } = await supabase
    .from('signups')
    .delete()
    .like('email', `${TEST_EMAIL_PREFIX}%`)
    .select('email');

  if (error) {
    console.error(`  ✗ Teardown delete failed: ${error.message}`);
    throw error;
  }
  console.log(`  ✓ Deleted ${data?.length ?? 0} test row(s)`);
});
