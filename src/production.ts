// Production state: one folder per film under productions/<id>/, persisted as production.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";

export const ROOT = resolve(process.env.GR_PRODUCTIONS ?? "productions");

export interface Character { name: string; look: string }
export interface Shot {
  id: number;
  description: string; // what the frame shows (image prompt)
  motion: string;      // what moves during the clip (video prompt)
  narration: string;   // VO line for this shot ("" if none)
  frameURL?: string;
  clipURL?: string;
  approved?: boolean;
}
export interface Prop { name: string; prompt: string; imageURL?: string; glbURL?: string; position?: [number, number, number]; scale?: number; rotationY?: number; error?: string }
export interface Script {
  title: string;
  logline: string;
  style: string;      // visual style shared by every prompt
  location: string;
  characters: Character[];
  shots: Shot[];
  music: string;      // music bed description
  voice: string;      // narrator voice description
  props: Prop[];
}
export type Stage = "writing" | "set" | "storyboard" | "review" | "filming" | "sound" | "editing" | "done" | "failed";

export interface Production {
  id: string;
  pitch: string;
  createdAt: number;
  stage: Stage;
  chat?: { type: "user" | "group"; id: string };
  script?: Script;
  characterSheetURL?: string;
  setStillURL?: string;
  voiceURL?: string;
  musicURL?: string;
  finalPath?: string;
  log: { t: number; agent: string; text: string }[];
  error?: string;
}

export const bus = new EventEmitter(); // emits "log" (prod, entry) and "update" (prod)

export function dir(p: Production | string) {
  return join(ROOT, typeof p === "string" ? p : p.id);
}

export async function create(pitch: string, chat?: Production["chat"]): Promise<Production> {
  const slug = pitch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "film";
  const id = `${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}-${slug}`;
  const p: Production = { id, pitch, createdAt: Date.now(), stage: "writing", chat, log: [] };
  await mkdir(dir(p), { recursive: true });
  await save(p);
  return p;
}

export async function save(p: Production) {
  // Set-designer entries live in set.json; don't persist the merged copies here.
  const persisted = { ...p, log: p.log.filter((e: any) => !e.fromSet) };
  await writeFile(join(dir(p), "production.json"), JSON.stringify(persisted, null, 2));
  bus.emit("update", p);
}

export async function load(id: string): Promise<Production | undefined> {
  const f = join(dir(id), "production.json");
  if (!existsSync(f)) return undefined;
  const p: Production = JSON.parse(await readFile(f, "utf8"));
  return mergeSet(p);
}

/** Overlay live 3D-set state (written by the Set Designer to set.json) onto a production. */
export async function mergeSet(p: Production): Promise<Production> {
  const sf = join(dir(p), "set.json");
  if (!p.script || !existsSync(sf)) return p;
  try {
    const set = JSON.parse(await readFile(sf, "utf8"));
    if (Array.isArray(set.props)) p.script.props = set.props;
    if (Array.isArray(set.log)) p.log = [...p.log, ...set.log.map((e: any) => ({ ...e, fromSet: true }))].sort((a, b) => a.t - b.t);
  } catch { /* partially written; ignore */ }
  return p;
}

export async function log(p: Production, agent: string, text: string) {
  const entry = { t: Date.now(), agent, text };
  p.log.push(entry);
  console.log(`[${p.id}] ${agent}: ${text}`);
  bus.emit("log", p, entry);
  await save(p);
}
