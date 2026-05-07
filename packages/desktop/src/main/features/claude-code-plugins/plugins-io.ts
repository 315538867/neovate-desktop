import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function atomicJsonUpdate<T>(
  filePath: string,
  updater: (current: T) => T,
  fallback: T,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const current = await readJsonSafe<T>(filePath, fallback);
  const updated = updater(current);
  const tmp = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(updated, null, 2) + "\n");
  await rename(tmp, filePath);
}
