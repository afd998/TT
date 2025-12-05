// Standalone Node runner so you can execute the flow with `node tests/run-close-aged-tickets.js`
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });

const { chromium } = require('playwright');
const config = require('../config');
const readline = require('readline');

const SERVICENOW_BASE = 'https://kiskellogg.service-now.com/';
const AGED_INCIDENT_LIST_PATH =
  'now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3Dexpected_start%253Cjavascript%3Ags.beginningOfThisWeek()%255Elocation%253D975fc569db79df40743715ce3b96193f%255Ecaller_id%253Db0a117d0dbe3af009d9a36be3b96197f%255Estate!%253D7%255Estate!%253D8%255Eassignment_group!%253Dc6445961dbb9df40743715ce3b9619f1%255Econtact_type%253DScheduling%2520System%255Estate!%253D6%26sysparm_first_row%3D1%26sysparm_view%3Dclassroom_details';

function resolveHeadlessSetting() {
  const args = process.argv.slice(2);
  if (args.includes('--headed')) return false;
  if (args.includes('--headless')) return true;
  if (process.env.HEADLESS) {
    const lowered = process.env.HEADLESS.toLowerCase();
    if (['1', 'true', 'yes'].includes(lowered)) return true;
    if (['0', 'false', 'no'].includes(lowered)) return false;
  }
  return process.env.CI === 'true'; // default: headed locally, headless in CI
}

async function run() {
  const netId = process.env.NETID;
  const netPassword = process.env.NETID_PW;
  if (!netId || !netPassword) {
    throw new Error('Missing NETID or NETID_PW in .env or environment');
  }

  const headless = resolveHeadlessSetting();
  console.log(`Launching Chrome in ${headless ? 'headless' : 'headed'} mode...`);

  const browser = await chromium.launch({ channel: 'chrome', headless });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    await goToAgedIncidentList(page);

    const usernameField = page.locator('#idToken1');
    const sawLogin = await Promise.race([
      usernameField.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true),
      page.waitForURL(/kiskellogg\.service-now\.com/, { timeout: 60_000 }).then(() => false),
    ]).catch(() => false);

    if (sawLogin) {
      console.log('Login page detected, submitting credentials...');
      await usernameField.fill(netId);
      await page.locator('#idToken2').fill(netPassword);
      await page.locator('#loginButton_0').click();
      await page.waitForLoadState('networkidle');
    }

    await goToAgedIncidentList(page);

    let ticketCount = 0;
    while (true) {
      const link = await getFirstTicketLink(page);
      if (!link) {
        console.log('⚪ No more tickets to process.');
        break;
      }

      const targetUrl = buildTicketUrl(link);
      if (!targetUrl) {
        console.log('Skipping ticket due to missing URL.');
        break;
      }

      ticketCount++;
      console.log(`🔗 Opening ticket ${ticketCount} -> ${targetUrl}`);
      await page.goto(targetUrl);
      await page.waitForLoadState('domcontentloaded');
      await processAgedTicket(page);
      await page.waitForLoadState('domcontentloaded');
      await goToAgedIncidentList(page);
    }

    console.log(`✅ Finished processing ${ticketCount} aged tickets.`);
  } finally {
    await browser.close();
  }
}

async function goToAgedIncidentList(page) {
  await page.goto(`${SERVICENOW_BASE}${AGED_INCIDENT_LIST_PATH}`, { waitUntil: 'domcontentloaded' });
}

async function getFirstTicketLink(page) {
  const frame = await resolveIncidentFrame(page);
  const listTable = frame.locator('tbody.list2_body');
  await listTable.first().waitFor({ state: 'visible', timeout: 60_000 });

  const rowLocator = listTable.locator('tr.list_row');
  const rowCount = await rowLocator.count();
  console.log(`📄 Found ${rowCount} incident rows`);
  
  if (rowCount === 0) {
    return null;
  }
  
  const firstRow = rowLocator.first();
  const link = await extractTicketLink(firstRow);
  return link;
}

async function resolveIncidentFrame(page, options = {}) {
  const timeoutMs = 60_000;
  const pollInterval = 500;
  const deadline = Date.now() + timeoutMs;
  const matcher =
    options.match ||
    ((frame) => frame.name() === 'gsft_main' || frame.url().includes('/incident_list.do'));

  while (Date.now() < deadline) {
    const frames = page.frames();
    const candidateByName = frames.find((frame) => {
      try {
        return matcher === options.match
          ? matcher(frame)
          : frame.name() === 'gsft_main' || frame.name() === 'gsft_nav';
      } catch {
        return false;
      }
    });
    if (candidateByName) {
      console.log(`Using frame "${candidateByName.name()}" (${candidateByName.url()})`);
      return candidateByName;
    }

    const candidate = frames.find((frame) => {
      try {
        if (matcher === options.match) return matcher(frame);
        if (!frame.name()) return false;
        return frame.url().includes('/incident_list.do');
      } catch {
        return false;
      }
    });
    if (candidate) {
      console.log(`Using frame "${candidate.name()}" (${candidate.url()})`);
      return candidate;
    }

    const frameElement = await page.$('iframe#gsft_main, iframe[name="gsft_main"], frame#gsft_main, frame[name="gsft_main"]');
    if (frameElement) {
      const contentFrame = await frameElement.contentFrame();
      if (contentFrame) {
        console.log(`Using frame from iframe selector (${contentFrame.url()})`);
        return contentFrame;
      }
    }

    await page.waitForTimeout(pollInterval);
  }

  console.log(
    'Available frames:',
    page.frames().map((frame) => `${frame.name()} -> ${frame.url()}`).join(' | ')
  );
  throw new Error('Unable to locate ServiceNow incident list frame');
}

async function extractTicketLink(row) {
  const link = row.locator('a.formlink').first();
  if (await link.count()) {
    return await link.getAttribute('href');
  }
  const fallback = row.locator('a').first();
  if (await fallback.count()) {
    return await fallback.getAttribute('href');
  }
  return null;
}

function buildTicketUrl(link) {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return new URL(link, SERVICENOW_BASE).href;
}

async function processAgedTicket(page) {
  if (!config.name) {
    console.log('No config.name defined, skipping form completion.');
    return;
  }
  
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) =>
      frameCandidate.name() === 'gsft_main' || frameCandidate.url().includes('incident.do'),
  });
  
  // Set assigned_to
  const assignedField = frame.locator('#sys_display\\.incident\\.assigned_to');
  await assignedField.waitFor({ state: 'visible', timeout: 30_000 });
  await assignedField.fill('');
  await assignedField.fill(config.name);
  await assignedField.press('Enter').catch(() => {});
  console.log(`✅ Filled assigned_to with ${config.name}`);

  // Click Notes tab
  const notesTab = frame.locator('span.tab_caption_text', { hasText: 'Notes' });
  await notesTab.waitFor({ state: 'visible', timeout: 30_000 });
  await notesTab.click();
  console.log('✅ Clicked Notes tab');

  // Enter time worked as 1
  // ID changes per session; target the generic tmr_*_min time-worked input
  const travelMinutesInput = frame.locator('input[id^="tmr_"][id$="_min"]').first();
  await travelMinutesInput.waitFor({ state: 'visible', timeout: 30_000 });
  await travelMinutesInput.fill('');
  await travelMinutesInput.fill('1');
  console.log('✅ Set time worked to 1');

  // Click Resolution tab
  const resolutionTab = frame.locator('span.tab_caption_text', { hasText: 'Resolution Information' });
  await resolutionTab.waitFor({ state: 'visible', timeout: 30_000 });
  await resolutionTab.click();
  console.log('✅ Clicked Resolution Information tab');

  // Set resolution code
  const closeCode = frame.locator('#incident\\.close_code');
  await closeCode.waitFor({ state: 'visible', timeout: 30_000 });
  await closeCode.selectOption({ index: 2 });
  console.log('✅ Set resolution code');

  // Set resolution notes
  const closeNotes = frame.locator('#incident\\.close_notes');
  await closeNotes.waitFor({ state: 'visible', timeout: 30_000 });
  await closeNotes.fill('Closing Aged Ticket');
  console.log('✅ Set resolution notes to "Closing Aged Ticket"');

  // Click resolve button
  const resolveButton = frame.locator('#resolve_incident');
  await resolveButton.waitFor({ state: 'visible', timeout: 30_000 });
  await resolveButton.click();
  console.log('✅ Clicked resolve button');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

