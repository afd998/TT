// Standalone Node runner so you can execute the flow with `node tests/run-close-tickets.js`
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });

const { chromium } = require('playwright');
const config = require('../config');
const { parseIncidentDescription } = require('../utils/descriptionParser');
const { createChildTickets } = require('../utils/childTicketHelper');
const readline = require('readline');

const SERVICENOW_BASE = 'https://kiskellogg.service-now.com/';
const INCIDENT_LIST_PATH =
  'now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3Dstate%253D3%255Ecaller_id%253Db0a117d0dbe3af009d9a36be3b96197f%255Eassignment_group%253Dc2445961dbb9df40743715ce3b9619f6%255Eexpected_startONToday%40javascript%3Ags.beginningOfToday()%40javascript%3Ags.endOfToday()%26sysparm_first_row%3D1%26sysparm_view%3Dclassroom_details';

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

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
    await goToIncidentList(page);

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

    await goToIncidentList(page);

    while (true) {
      const matchingTicket = await logIncidentRows(page);
      if (!matchingTicket?.link) {
        console.log('⚪ No matching tickets within configured shifts.');
        break;
      }

      const targetUrl = buildTicketUrl(matchingTicket.link);
      if (!targetUrl) {
        console.log('Skipping ticket due to missing URL.');
        break;
      }

      console.log(`🔗 Opening matching ticket ${matchingTicket.sysId} (${matchingTicket.shift.name}) -> ${targetUrl}`);
      await page.goto(targetUrl);
      await page.waitForLoadState('domcontentloaded');
      await mainTicketFormCompletion(page);
      await page.waitForLoadState('domcontentloaded');
      await goToIncidentList(page);
    }

    console.log('✅ Finished processing all matching tickets.');
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function goToIncidentList(page) {
  await page.goto(`${SERVICENOW_BASE}${INCIDENT_LIST_PATH}`, { waitUntil: 'domcontentloaded' });
}

async function logIncidentRows(page) {
  const frame = await resolveIncidentFrame(page);
  const listTable = frame.locator('tbody.list2_body');
  await listTable.first().waitFor({ state: 'visible', timeout: 60_000 });

  const rowLocator = listTable.locator('tr.list_row');
  const rowCount = await rowLocator.count();
  console.log(`📄 Found ${rowCount} incident rows`);

  const shifts = config.shifts || [];
  let firstMatch = null;
  for (let i = 0; i < rowCount; i += 1) {
    const row = rowLocator.nth(i);
    const sysId = (await row.getAttribute('sys_id')) || 'unknown';
    const preview = (await row.innerText()).replace(/\s+/g, ' ').trim();
    const expectedStart = parseExpectedStart(preview);
    const room = parseRoom(preview);
    const matchingShift = expectedStart && room ? findMatchingShift(expectedStart, room, shifts) : null;
    const shiftLabel = matchingShift ? `🟢 My event (${matchingShift.name})` : '⚪ not my shift';
    console.log(`  [${i + 1}] ${sysId}: ${shiftLabel}`);

    if (!firstMatch && matchingShift) {
      const link = await extractTicketLink(row);
      if (link) {
        firstMatch = {
          sysId,
          shift: matchingShift,
          link,
          expectedStart,
          room,
        };
      }
    }
  }

  return firstMatch;
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

function parseExpectedStart(rowText) {
  const dateMatches = rowText.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (?:AM|PM)/g);
  if (dateMatches && dateMatches[1]) {
    return toDate(dateMatches[1]);
  }
  return null;
}

function toDate(dateString) {
  const match = dateString.match(
    /(?<month>\d{2})\/(?<day>\d{2})\/(?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<ampm>AM|PM)/
  );
  if (!match || !match.groups) return null;
  let hour = parseInt(match.groups.hour, 10);
  const minute = parseInt(match.groups.minute, 10);
  const second = parseInt(match.groups.second, 10);
  const isPM = match.groups.ampm === 'PM';
  if (hour === 12) {
    hour = isPM ? 12 : 0;
  } else if (isPM) {
    hour += 12;
  }
  return new Date(
    parseInt(match.groups.year, 10),
    parseInt(match.groups.month, 10) - 1,
    parseInt(match.groups.day, 10),
    hour,
    minute,
    second
  );
}

function parseRoom(rowText) {
  const roomMatch = rowText.match(/GH\s?[A-Z0-9& ]+/i);
  return roomMatch ? roomMatch[0].trim() : null;
}

function findMatchingShift(dateObj, room, shifts) {
  if (!Array.isArray(shifts)) return null;
  return shifts.find((shift) => {
    if (typeof shift.startHour !== 'number' || typeof shift.endHour !== 'number') return false;
    const hour = dateObj.getHours();
    const withinHours = hour >= shift.startHour && hour < shift.endHour;
    const roomMatch = Array.isArray(shift.rooms) && shift.rooms.some((candidate) => candidate && room?.toLowerCase().includes(candidate.toLowerCase()));
    return withinHours && roomMatch;
  }) || null;
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

async function mainTicketFormCompletion(page) {
  if (!config.name) {
    console.log('No config.name defined, skipping form completion.');
    return;
  }
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) =>
      frameCandidate.name() === 'gsft_main' || frameCandidate.url().includes('incident.do'),
  });
  const assignedField = frame.locator('#sys_display\\.incident\\.assigned_to');
  await assignedField.waitFor({ state: 'visible', timeout: 30_000 });
  await assignedField.fill('');
  await assignedField.fill(config.name);
  await assignedField.press('Enter').catch(() => {});
  console.log(`✅ Filled assigned_to with ${config.name}`);

  const notesTab = frame.locator('span.tab_caption_text', { hasText: 'Notes' });
  await notesTab.waitFor({ state: 'visible', timeout: 30_000 });
  await notesTab.click();

  // Use pattern-based selector for dynamic time entry field ID
  const travelMinutesInput = frame.locator('input[id^="tmr_"][id$="_min"]');
  await travelMinutesInput.waitFor({ state: 'visible', timeout: 30_000 });
  await travelMinutesInput.fill('');
  await travelMinutesInput.fill('5');
  console.log('✅ Set travel minutes to 5');

  const workNotesField = frame.locator('#activity-stream-work_notes-textarea');
  const workNotesText = 'Monitored Video wall throughout the class period. Monitored phones. Session supported.';
  await workNotesField.waitFor({ state: 'visible', timeout: 30_000 });
  await workNotesField.fill(workNotesText);
  console.log('✅ Added work notes entry');

  const descriptionField = frame.locator('#incident\\.description');
  await descriptionField.waitFor({ state: 'visible', timeout: 30_000 });
  const descriptionText = await descriptionField.evaluate((el) => el.value || '').catch(() => '');
  const parsedDescription = parseIncidentDescription(descriptionText);
  console.log('📝 Parsed description data', parsedDescription);

  const shortDescriptionField = frame.locator('#incident\\.short_description');
  await shortDescriptionField.waitFor({ state: 'visible', timeout: 30_000 });
  const parentShortDescription = await shortDescriptionField.evaluate((el) => el.value || '').catch(() => '');
  console.log(`📝 Parent short description: ${parentShortDescription}`);

  const expectedStartField = frame.locator('#incident\\.expected_start');
  await expectedStartField.waitFor({ state: 'visible', timeout: 30_000 });
  const parentExpectedStart = await expectedStartField.evaluate((el) => el.value || '').catch(() => '');
  console.log(`📝 Parent expected_start: ${parentExpectedStart}`);

  const saveButton = frame.locator('button#sysverb_update_and_stay');
  await saveButton.waitFor({ state: 'visible', timeout: 30_000 });
  await saveButton.click();
  console.log('💾 Clicked Save (Update and Stay)');

  console.log(`📦 Preparing to create ${parsedDescription.resources.length} child tickets`);
  await page.waitForLoadState('domcontentloaded');
  await createChildTickets({ page, resources: parsedDescription.resources, resolveIncidentFrame, parentShortDescription, parentExpectedStart });

  await finalizeParentTicket(page);
}

async function finalizeParentTicket(page) {
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) => frameCandidate.name() === 'gsft_main' || frameCandidate.url().includes('incident.do'),
  });

  const resolutionTab = frame.locator('span.tab_caption_text', { hasText: 'Resolution Information' });
  await resolutionTab.waitFor({ state: 'visible', timeout: 30_000 });
  await resolutionTab.click();

  const closeCode = frame.locator('#incident\\.close_code');
  await closeCode.waitFor({ state: 'visible', timeout: 30_000 });
  await closeCode.selectOption({ index: 2 });

  const closeNotes = frame.locator('#incident\\.close_notes');
  await closeNotes.waitFor({ state: 'visible', timeout: 30_000 });
  await closeNotes.fill('Service fulfilled, closing ticket.');

  const resolveButton = frame.locator('#resolve_incident');
  await resolveButton.waitFor({ state: 'visible', timeout: 30_000 });
  await resolveButton.click();
  console.log('✅ Submitted resolution');
}
