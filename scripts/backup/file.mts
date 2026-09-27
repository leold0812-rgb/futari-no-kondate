import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { type BackupFile, validateBackup } from "../../lib/backup/core.mts";

/** バックアップファイル（gzipまたはJSON）を読み、形を確かめる */
export function readBackupFile(path: string): BackupFile {
  const raw = readFileSync(path);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const parsed: unknown = JSON.parse(text);
  const problem = validateBackup(parsed);
  if (problem) throw new Error(problem);
  return parsed as BackupFile;
}
