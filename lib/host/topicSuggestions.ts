export interface TopicSuggestionSourceRow {
  player_id: string;
  text: string;
  created_at: string;
}

export interface HostTopicSuggestion {
  name: string;
  count: number;
  latestAt: string;
}

function normalizeKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function displayText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function buildTopTopicSuggestions(
  rows: TopicSuggestionSourceRow[],
  limit = 5,
): HostTopicSuggestion[] {
  const latestByPlayer = new Map<string, TopicSuggestionSourceRow>();
  const newestFirst = [...rows].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  for (const row of newestFirst) {
    if (!row.player_id || !displayText(row.text)) continue;
    if (!latestByPlayer.has(row.player_id)) {
      latestByPlayer.set(row.player_id, row);
    }
  }

  const groups = new Map<string, HostTopicSuggestion>();
  for (const row of latestByPlayer.values()) {
    const key = normalizeKey(row.text);
    const name = displayText(row.text);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { name, count: 1, latestAt: row.created_at });
      continue;
    }
    existing.count += 1;
    if (Date.parse(row.created_at) > Date.parse(existing.latestAt)) {
      existing.latestAt = row.created_at;
      existing.name = name;
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const latest = Date.parse(b.latestAt) - Date.parse(a.latestAt);
      if (latest !== 0) return latest;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
