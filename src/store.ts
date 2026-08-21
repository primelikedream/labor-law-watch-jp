import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CollectedItem, DataFile } from "./types.js";

export const DATA_PATH = "docs/data/items.json";

export async function loadData(path = DATA_PATH): Promise<DataFile> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as DataFile;
  } catch {
    return { updatedAt: new Date().toISOString(), items: [] };
  }
}

export async function saveData(data: DataFile, path = DATA_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sorted = {
    updatedAt: new Date().toISOString(),
    items: [...data.items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  };
  await writeFile(path, JSON.stringify(sorted, null, 2), "utf-8");
}

// 既存データに新規項目をマージする。同一idは新しい情報で上書きしない(要約結果を保持するため)。
export function mergeItems(existing: CollectedItem[], incoming: CollectedItem[]): {
  merged: CollectedItem[];
  addedCount: number;
} {
  const byId = new Map(existing.map((item) => [item.id, item]));
  let addedCount = 0;
  for (const item of incoming) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
      addedCount++;
    }
  }
  return { merged: [...byId.values()], addedCount };
}
