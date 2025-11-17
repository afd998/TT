const { test } = require('@playwright/test');
const config = require('../config');

const INCIDENT_URL = 'https://kiskellogg.service-now.com/incident.do?sys_id=-1&sysparm_view=Mobile';

async function loginIfNeeded(page) {
  const usernameField = page.locator('#idToken1');
  const sawLogin = await Promise.race([
    usernameField.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true),
    page.waitForURL(/kiskellogg\.service-now\.com/, { timeout: 30_000 }).then(() => false),
  ]).catch(() => false);

  if (sawLogin) {
    await usernameField.fill(process.env.NETID || '');
    await page.locator('#idToken2').fill(process.env.NETID_PW || '');
    await page.locator('#loginButton_0').click();
    await page.waitForLoadState('domcontentloaded');
  }
}

test('manually type assigned_to value on blank incident form', async ({ page }) => {
  await page.goto(INCIDENT_URL, { waitUntil: 'domcontentloaded' });
  await loginIfNeeded(page);
  
  // Wait for any redirects to complete
  await page.waitForLoadState('networkidle');
  
  // Only navigate if we're not already on the incident form
  const currentUrl = page.url();
  if (!currentUrl.includes('incident.do') || !currentUrl.includes('sys_id=-1')) {
    await page.waitForTimeout(1000);
    await page.goto(INCIDENT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  }

  const assignedField = page.locator('#sys_display\\.incident\\.assigned_to');
  await assignedField.waitFor({ state: 'visible', timeout: 60_000 });
  await assignedField.fill('');
  const targetName = (config.name || 'Atticus Deutsch').trim();
  await assignedField.type(targetName, { delay: 200 });
  
  // Wait for autocomplete suggestions to appear
  await page.waitForTimeout(2000);
  
  // Try pressing Enter to select from autocomplete
  await assignedField.press('Enter');
  await page.waitForTimeout(1000);
  
  // Or click away to confirm
  // await page.locator('body').click();
  
  // Wait to see the result
  await page.waitForTimeout(3_000);
});

