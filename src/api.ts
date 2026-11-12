import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { FsEntry, NoteFile, PersistedSettings } from "./types";

export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: "Open notes folder" });
  return typeof selected === "string" ? selected : null;
}

export function openVault(path: string): Promise<FsEntry[]> {
  return invoke("open_vault", { path });
}

export function vaultEntries(): Promise<FsEntry[]> {
  return invoke("vault_entries");
}

export function readNotes(): Promise<NoteFile[]> {
  return invoke("read_notes");
}

export function readText(path: string): Promise<string> {
  return invoke("read_text", { path });
}

export function readBytes(path: string): Promise<string> {
  return invoke("read_bytes", { path });
}

export function writeText(path: string, content: string): Promise<void> {
  return invoke("write_text", { path, content });
}

export function createDir(path: string): Promise<void> {
  return invoke("create_dir", { path });
}

export function deletePath(path: string): Promise<void> {
  return invoke("delete_path", { path });
}

export function renamePath(from: string, to: string): Promise<void> {
  return invoke("rename_path", { from, to });
}

export function loadSettings(): Promise<PersistedSettings> {
  return invoke("load_settings");
}

export function saveSettings(settings: PersistedSettings): Promise<void> {
  return invoke("save_settings", { settings });
}

export function onVaultChange(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<{ paths: string[] }>("vault-change", (event) => {
    handler(event.payload.paths);
  });
}
