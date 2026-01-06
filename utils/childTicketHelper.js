const config = require('../config');

function getResourceDisplayText(resource) {
  if (!resource || typeof resource !== 'string') return resource;
  
  if (resource.startsWith('KSM-KGH-VIDEO-Recording')) {
    return 'Recording';
  } else if (resource.startsWith('KSM-KGH-AV-Staff')) {
    return 'Staff Assistance';
  } else if (resource.startsWith('KSM-KGH-AV-Web Conference')) {
    return 'Web Conferencing';
  }
  
  return resource;
}

function getWorkNotesForResource(resource) {
  if (!resource || typeof resource !== 'string') return '';
  
  if (resource.startsWith('KSM-KGH-VIDEO-Recording')) {
    return 'Quality checked lecture capture and confirmed it was in the correct folder. All AV content was present. Monitored recording throughout the class period.';
  } else if (resource.startsWith('KSM-KGH-AV-Web Conference')) {
    return 'Assisted professor in starting Zoom web conference. Chose the preferred camera. Assisted with sharing slides.';
  } else if (resource.startsWith('KSM-KGH-AV-Staff')) {
    return 'Checked in with professor to help with slides or other basic tech setup needs.';
  }
  
  return '';
}

async function createChildTickets({ page, resources, resolveIncidentFrame, parentShortDescription, parentExpectedStart }) {
  if (!resources || resources.length === 0) return;

  for (const resource of resources) {
    console.log(`➕ Creating child ticket for resource: ${resource}`);
    await openChildTicketForm(page, resolveIncidentFrame);
    await handleChildTicketForm(page, resource, resolveIncidentFrame, parentShortDescription, parentExpectedStart);
  }
}

async function openChildTicketForm(page, resolveIncidentFrame) {
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) => frameCandidate.name() === 'gsft_main' || frameCandidate.url().includes('incident.do'),
  });

  const childIncidentsTab = frame.locator('span.tab_caption_text', { hasText: 'Child Incidents' });
  await childIncidentsTab.waitFor({ state: 'visible', timeout: 30_000 });
  await childIncidentsTab.click();
  await page.waitForLoadState('domcontentloaded');

  const newChildButton = frame.locator('#sysverb_new[table="incident.incident.parent_incident"]');
  await newChildButton.waitFor({ state: 'visible', timeout: 30_000 });
  await newChildButton.click();
  await page.waitForLoadState('domcontentloaded');
}

async function handleChildTicketForm(page, resource, resolveIncidentFrame, parentShortDescription, parentExpectedStart) {
  const frame = await resolveIncidentFrame(page, {
    match: (frameCandidate) => frameCandidate.name() === 'gsft_main' || frameCandidate.url().includes('incident.do'),
  });
  console.log(`⚙️ Filling child ticket form for resource: ${resource}`);

  // Set Short Description
  if (parentShortDescription) {
    const resourceDisplayText = getResourceDisplayText(resource);
    const shortDescription = `${parentShortDescription} - ${resourceDisplayText}`;
    const shortDescriptionField = frame.locator('#incident\\.short_description');
    await shortDescriptionField.waitFor({ state: 'visible', timeout: 30_000 });
    await shortDescriptionField.fill(shortDescription);
    console.log(`✅ Set short_description to "${shortDescription}"`);
  }

  // Set Expected Start
  if (parentExpectedStart) {
    const expectedStartField = frame.locator('#incident\\.expected_start');
    await expectedStartField.waitFor({ state: 'visible', timeout: 30_000 });
    await expectedStartField.fill(parentExpectedStart);
    console.log(`✅ Set expected_start to "${parentExpectedStart}"`);
  }

  // Set Caller to "Scheduling System"
  const callerField = frame.locator('#sys_display\\.incident\\.caller_id');
  await callerField.waitFor({ state: 'visible', timeout: 30_000 });
  await callerField.fill('');
  await callerField.fill('Scheduling System');
  await callerField.press('Enter').catch(() => {});
  console.log('✅ Set caller to "Scheduling System"');

  // Set Contact Type to "Scheduling System"
  const contactTypeField = frame.locator('#incident\\.contact_type');
  await contactTypeField.waitFor({ state: 'visible', timeout: 30_000 });
  await contactTypeField.selectOption('Scheduling System');
  console.log('✅ Set contact type to "Scheduling System"');

  // Set Ticket Type to "Service"
  const ticketTypeField = frame.locator('#incident\\.u_ticket_type');
  await ticketTypeField.waitFor({ state: 'visible', timeout: 30_000 });
  await ticketTypeField.selectOption('service');
  console.log('✅ Set ticket type to "Service"');

  // Set Location to "Global Hub"
  const locationField = frame.locator('#sys_display\\.incident\\.location');
  await locationField.waitFor({ state: 'visible', timeout: 30_000 });
  await locationField.fill('');
  await locationField.fill('Global Hub');
  await locationField.press('Enter').catch(() => {});
  console.log('✅ Set location to "Global Hub"');

  // Set Category to "Learning Environment Services"
  const categoryField = frame.locator('#incident\\.category');
  await categoryField.waitFor({ state: 'visible', timeout: 30_000 });
  await categoryField.selectOption('Classrooms & Meeting Spaces');
  console.log('✅ Set category to "Learning Environment Services"');

  // Set Subcategory based on resource name
  let subcategory = null;
  if (resource && typeof resource === 'string') {
    if (resource.startsWith('KSM-KGH-VIDEO-Recording')) {
      subcategory = 'Lecture Capture';
    } else if (resource.startsWith('KSM-KGH-AV-Staff')) {
      subcategory = 'AV Technical Support';
    } else if (resource.startsWith('KSM-KGH-AV-Web Conference')) {
      subcategory = 'Webconferencing';
    }
  }

  if (subcategory) {
    const subcategoryField = frame.locator('#incident\\.subcategory');
    await subcategoryField.waitFor({ state: 'visible', timeout: 30_000 });
    await subcategoryField.selectOption(subcategory);
    console.log(`✅ Set subcategory to "${subcategory}"`);
  }

  // Set Assignment Group to "Global Hub IT Facilities"
  const assignmentGroupField = frame.locator('#sys_display\\.incident\\.assignment_group');
  await assignmentGroupField.waitFor({ state: 'visible', timeout: 30_000 });
  await assignmentGroupField.fill('');
  await assignmentGroupField.fill('Global Hub IT Facilities');
  await assignmentGroupField.press('Enter').catch(() => {});
  console.log('✅ Set assignment_group to "Global Hub IT Facilities"');

  // Set Assigned to to config.name
  if (config.name) {
    const trimmedName = config.name.trim();
    const assignedField = frame.locator('#sys_display\\.incident\\.assigned_to');
    await assignedField.waitFor({ state: 'visible', timeout: 30_000 });
    await assignedField.fill('');
    // Wait a bit before typing to ensure field is ready
    await page.waitForTimeout(500);
    await assignedField.type(trimmedName, { delay: 200 });
    
    // Wait for autocomplete suggestions to appear
    await page.waitForTimeout(2000);
    
    // Press Enter to select from autocomplete
    await assignedField.press('Enter');
    await page.waitForTimeout(1000);
    
    console.log(`✅ Set assigned_to to "${trimmedName}"`);
  }

  // Click Notes tab
  const notesTab = frame.locator('span.tab_caption_text', { hasText: 'Notes' });
  await notesTab.waitFor({ state: 'visible', timeout: 30_000 });
  await notesTab.click();

  // Set travel minutes to 5
  // ID changes per session; target the generic tmr_*_min time-worked input
  const travelMinutesInput = frame.locator('input[id^="tmr_"][id$="_min"]');
  await travelMinutesInput.waitFor({ state: 'visible', timeout: 30_000 });
  await travelMinutesInput.fill('');
  await travelMinutesInput.fill('5');
  console.log('✅ Set travel minutes to 5');

  // Set work notes based on resource type
  const workNotesText = getWorkNotesForResource(resource);
  if (workNotesText) {
    const workNotesField = frame.locator('#incident\\.work_notes');
    await workNotesField.waitFor({ state: 'visible', timeout: 30_000 });
    await workNotesField.fill(workNotesText);
    console.log('✅ Added work notes entry');
  }

  // Click Resolution Information tab
  const resolutionTab = frame.locator('span.tab_caption_text', { hasText: 'Resolution Information' });
  await resolutionTab.waitFor({ state: 'visible', timeout: 30_000 });
  await resolutionTab.click();

  // Set close code
  const closeCode = frame.locator('#incident\\.close_code');
  await closeCode.waitFor({ state: 'visible', timeout: 30_000 });
  await closeCode.selectOption({ index: 2 });
  console.log('✅ Set close code');

  // Set close notes
  const closeNotes = frame.locator('#incident\\.close_notes');
  await closeNotes.waitFor({ state: 'visible', timeout: 30_000 });
  await closeNotes.fill('Service fulfilled, closing ticket.');
  console.log('✅ Set close notes');

  // Click resolve button
  const resolveButton = frame.locator('#resolve_incident');
  await resolveButton.waitFor({ state: 'visible', timeout: 30_000 });
  await resolveButton.click();
  await page.waitForLoadState('domcontentloaded');
  // Wait a bit more to ensure we're redirected back to parent ticket
  await page.waitForTimeout(1000);
  console.log('✅ Resolved child ticket');
}

module.exports = {
  createChildTickets,
};
