function parseIncidentDescription(descriptionText = '') {
  const normalized = (descriptionText || '').trim();
  const resources = extractResources(normalized).map((resource) => normalizeResource(resource)).filter(Boolean);
  return {
    raw: normalized,
    resources,
  };
}

function extractResources(text) {
  const resourcesMatch = text.match(/\[Resources\]\s*([\s\S]*?)(?=\[ReservationID\]|$)/i);
  if (!resourcesMatch) return [];
  const resourcesBlock = resourcesMatch[1].trim();
  if (!resourcesBlock) return [];
  return resourcesBlock
    .split('|')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeResource(resource) {
  const prefixes = [
    'KSM-KGH-VIDEO-Recording (POST TO CANVAS)',
    'KSM-KGH-VIDEO-Recording (PRIVATE LINK)',
    'KSM-KGH-AV-Staff Assistance',
    'KSM-KGH-AV-Web Conference',
  ];

  for (const prefix of prefixes) {
    if (resource.startsWith(prefix)) {
      return prefix; // clip anything after
    }
  }

  return null; // filter out non-matching resources
}

module.exports = {
  parseIncidentDescription,
};
