async function createChildTickets({ page, resources, resolveIncidentFrame }) {
  if (!resources || resources.length === 0) return;

  for (const resource of resources) {
    console.log(`➕ Creating child ticket for resource: ${resource}`);
    await openChildTicketForm(page, resolveIncidentFrame);
    await handleChildTicketForm(page, resource, resolveIncidentFrame);
  }
}

async function openChildTicketForm(page, resolveIncidentFrame) {
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) => frameCandidate.name() === 'gsft_main',
  });

  const relatedTab = frame.locator('#tabs2_list > span:nth-child(13)');
  await relatedTab.waitFor({ state: 'visible', timeout: 30_000 });
  await relatedTab.click();

  const newChildButton = frame.locator('#sysverb_new');
  await newChildButton.waitFor({ state: 'visible', timeout: 30_000 });
  await newChildButton.click();
  await page.waitForLoadState('domcontentloaded');
}

async function handleChildTicketForm(page, resource, resolveIncidentFrame) {
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) => frameCandidate.name() === 'gsft_main' || frameCandidate.url().includes('incident.do'),
  });
  console.log(`⚙️ Child ticket stub for resource: ${resource}`);

  const cancelButton = frame.locator('#sysverb_cancel');
  if (await cancelButton.count()) {
    await cancelButton.click();
    await page.waitForLoadState('domcontentloaded');
  }
}

module.exports = {
  createChildTickets,
};
