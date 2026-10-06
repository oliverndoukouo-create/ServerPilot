const warningHistory = new Map<string, Array<{ moderatorId: string; reason: string; createdAt: number }>>();

function key(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

export function recordWarning(guildId: string, userId: string, moderatorId: string, reason: string) {
  const warnings = warningHistory.get(key(guildId, userId)) ?? [];
  warnings.push({ moderatorId, reason, createdAt: Date.now() });
  warningHistory.set(key(guildId, userId), warnings);
  return warnings.length;
}

export function getWarningCount(guildId: string, userId: string) {
  return warningHistory.get(key(guildId, userId))?.length ?? 0;
}
