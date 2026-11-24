// Step-wise CLI used by the Teamily-hosted Claude Code agent (see CLAUDE.md).
//   gr pitch "<logline>"            → script + character sheet + storyboard frames (+ 3D set in background)
//   gr redo <id> <shot> "<note>"    → redraw one frame
//   gr shoot <id>                   → clips + sound + final cut
//   gr status [id]                  → production summary (latest if no id)
//   gr set <id>                     → (re)build the 3D set only
import "dotenv/config";
import { readdir } from "node:fs/promises";
import { preProduction, production, redo } from "./pipeline.js";
import { setDesigner, formatScript } from "./agents.js";
import { load, ROOT, type Production } from "./production.js";
import { publicUrl } from "./share.js";

const [cmd, ...args] = process.argv.slice(2);

async function latestId() {
  const ids = (await readdir(ROOT).catch(() => [])).filter((x) => !x.startsWith(".")).sort();
  return ids.at(-1);
}
async function get(id?: string): Promise<Production> {
  const pid = id && id !== "latest" ? id : await latestId();
  const p = pid ? await load(pid) : undefined;
  if (!p) throw new Error(`No production ${id ?? ""}`);
  return p;
}

function summary(p: Production) {
  const s = p.script;
  const lines = [`PRODUCTION ${p.id}  stage=${p.stage}`];
  if (s) lines.push(formatScript(s));
  if (p.characterSheetURL) lines.push(`CHARACTER SHEET: ${p.characterSheetURL}`);
  s?.shots.forEach((sh) => lines.push(`FRAME ${sh.id}: ${sh.frameURL ?? "-"}${sh.clipURL ? `\nCLIP ${sh.id}: ${sh.clipURL}` : ""}`));
  s?.props.forEach((pr) => lines.push(`PROP ${pr.name}: ${pr.glbURL ? "3D ready" : pr.error ? "failed" : "building…"}`));
  lines.push(`BOARD: ${publicUrl(`/p/${p.id}`)}`);
  lines.push(`3D SET: ${publicUrl(`/set/${p.id}`)}`);
  if (p.finalPath) lines.push(`FINAL FILM: ${publicUrl(`/files/${p.id}/final.mp4`)}`);
  if (p.error) lines.push(`ERROR: ${p.error}`);
  return lines.join("\n");
}

switch (cmd) {
  case "pitch": {
    const { p, set } = await preProduction(args.join(" "));
    // Give the 3D set a head start but don't block the storyboard review on it.
    await Promise.race([set, new Promise((r) => setTimeout(r, 1000))]);
    console.log("\n" + summary(p));
    console.log(`\nNEXT: show the frames to the humans; then "gr redo ${p.id} <shot> <note>" or "gr shoot ${p.id}".`);
    await set; // keep process alive until props finish so the set fills in
    break;
  }
  case "redo": {
    const p = await get(args[0]);
    const sh = await redo(p, Number(args[1]), args.slice(2).join(" ") || "try a different take");
    console.log(`FRAME ${sh.id}: ${sh.frameURL}`);
    break;
  }
  case "shoot": {
    const p = await get(args[0]);
    await production(p);
    console.log("\n" + summary(p));
    break;
  }
  case "set": {
    const p = await get(args[0]);
    await setDesigner(p);
    console.log(summary(p));
    break;
  }
  case "status":
    console.log(summary(await get(args[0])));
    break;
  default:
    console.log("usage: gr pitch|redo|shoot|status|set …");
    process.exit(1);
}
