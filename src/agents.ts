// The crew. Each agent is a function over a Production; the Director (pipeline.ts) sequences them.
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { llm, image, video, audio, music as score, model3d, download } from "./runware.js";
import { type Production, type Script, type Shot, log, save, dir } from "./production.js";
import { probeDuration, assemble } from "./editor.js";

export const CREW = {
  director: "🎬 Director",
  writer: "✍️ Writer",
  setdesigner: "🏗️ Set Designer",
  storyboard: "🖼️ Storyboard",
  camera: "🎥 Cinematographer",
  sound: "🎧 Sound",
  editor: "✂️ Editor",
} as const;

/** Run tasks with bounded concurrency, preserving order. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ---------------- Writer ----------------
const WRITER_SYSTEM = `You are an award-winning short-film screenwriter and director of photography.
Turn a pitch into a tight, cinematic micro-short told in exactly N shots (N given by the user).
Return ONLY JSON matching this TypeScript type, no commentary:
{
  "title": string,
  "logline": string,
  "style": string,        // one consistent visual style for every shot: medium, lens, palette, lighting, era (e.g. "35mm anamorphic, teal-orange neon noir, shallow depth of field")
  "location": string,     // the main set, richly described
  "characters": [{ "name": string, "look": string }], // 1-2 characters, precise visual description (age, face, hair, wardrobe colours)
  "shots": [{ "id": number, "description": string, "motion": string, "narration": string }],
  "music": string,        // music bed: genre, instruments, tempo, mood arc
  "voice": string,        // narrator voice: gender, age, timbre, delivery
  "props": [{ "name": string, "prompt": string }] // 3-4 hero props that appear on the set; prompt = standalone product-shot description of the object
}
Rules:
- description: a self-contained image prompt for the FIRST frame of the shot: framing (wide/medium/close-up), subject, action pose, set details. Name characters and restate their key look.
- motion: what moves during a 5-second clip (camera move + subject action). Simple, physically plausible.
- narration: one short spoken line (max 14 words) or "" — total narration across shots should be 20-45 words and tell the story.
- Vary shot sizes like a real edit (establishing wide → medium → close-up → payoff).`;

export async function writer(p: Production, shots = 4) {
  p.stage = "writing";
  await log(p, CREW.writer, `Breaking down the pitch into ${shots} shots…`);
  const raw = await llm(WRITER_SYSTEM, `N = ${shots}\nPitch: ${p.pitch}`, { json: true });
  const s = JSON.parse(raw) as Script;
  s.shots = s.shots.slice(0, shots).map((sh, i) => ({ ...sh, id: i + 1 }));
  s.props = (s.props ?? []).slice(0, 4);
  p.script = s;
  await save(p);
  await log(p, CREW.writer, formatScript(s));
  return s;
}

export function formatScript(s: Script) {
  return [
    `"${s.title}" — ${s.logline}`,
    `Style: ${s.style}`,
    ...s.shots.map((sh) => `Shot ${sh.id}: ${sh.description}${sh.narration ? `\n   VO: "${sh.narration}"` : ""}`),
  ].join("\n");
}

// ---------------- Storyboard ----------------
function charactersBlurb(s: Script) {
  return s.characters.map((c) => `${c.name}: ${c.look}`).join("; ");
}

export async function characterSheet(p: Production) {
  const s = p.script!;
  await log(p, CREW.storyboard, `Casting: ${s.characters.map((c) => c.name).join(", ")} — drawing the character sheet.`);
  p.characterSheetURL = await image(
    `Character reference sheet, full body front view and close-up portrait side by side, neutral grey studio background. ${charactersBlurb(s)}. Style: ${s.style}.`,
  );
  await save(p);
  return p.characterSheetURL;
}

export async function frame(p: Production, shot: Shot, note?: string) {
  const s = p.script!;
  const refs = [p.characterSheetURL, p.setStillURL].filter(Boolean) as string[];
  shot.frameURL = await image(
    `Cinematic film still, 16:9. ${shot.description}${note ? `. Director's note: ${note}` : ""}. Setting: ${s.location}. Characters: ${charactersBlurb(s)}. Style: ${s.style}. Keep character faces and wardrobe identical to the reference sheet. No text, no captions.`,
    refs,
  );
  shot.approved = false;
  shot.clipURL = undefined;
  await save(p);
  return shot.frameURL;
}

export async function storyboard(p: Production) {
  p.stage = "storyboard";
  await save(p);
  if (!p.characterSheetURL) await characterSheet(p);
  await log(p, CREW.storyboard, `Drawing ${p.script!.shots.length} frames…`);
  await pool(p.script!.shots, 4, (sh) => frame(p, sh));
  p.stage = "review";
  await save(p);
}

// ---------------- Set Designer (3D) ----------------
const LAYOUT_SYSTEM = `You are a production designer laying out props on a film set seen in a 3D previs tool.
Floor is the XZ plane, Y is up, units are metres, camera looks from +Z toward the origin. Keep everything within x,z ∈ [-3,3].
Return ONLY JSON: [{"name": string, "position": [x, y, z], "scale": number /* longest side in metres */, "rotationY": number /* radians */}] in the same order as the input props.`;

export async function setDesigner(p: Production) {
  const s = p.script!;
  if (!s.props.length) return;
  await log(p, CREW.setdesigner, `Building the set: ${s.props.map((x) => x.name).join(", ")}`);
  try {
    const layout = JSON.parse(await llm(LAYOUT_SYSTEM, `Set: ${s.location}\nProps: ${JSON.stringify(s.props.map((x) => x.name))}`, { json: true })) as any[];
    s.props.forEach((prop, i) => {
      const l = layout[i] ?? {};
      prop.position = l.position ?? [i * 1.2 - 1.8, 0, 0];
      prop.scale = l.scale ?? 1;
      prop.rotationY = l.rotationY ?? 0;
    });
  } catch (e) {
    s.props.forEach((prop, i) => { prop.position = [i * 1.2 - 1.8, 0, 0]; prop.scale = 1; prop.rotationY = 0; });
  }
  // The set builds in the background, possibly in another process than later commands,
  // so its live state goes to set.json (merged into the production on load), never production.json.
  const setLog: { t: number; agent: string; text: string }[] = [];
  const flush = () => writeFile(join(dir(p), "set.json"), JSON.stringify({ location: s.location, style: s.style, props: s.props, log: setLog }, null, 2));
  const note = async (text: string) => { setLog.push({ t: Date.now(), agent: CREW.setdesigner, text }); console.log(`[${p.id}] ${CREW.setdesigner}: ${text}`); await flush(); };
  await flush();
  await pool(s.props, 4, async (prop) => {
    try {
      prop.imageURL = await image(
        `${prop.prompt}. Single isolated object, centered, full object visible, plain white background, soft studio light, product photography. Style cues: ${s.style}.`,
        [], { width: 1024, height: 1024 },
      );
      await flush();
      prop.glbURL = await model3d(prop.imageURL);
      await download(prop.glbURL, join(dir(p), `prop-${slug(prop.name)}.glb`)).catch(() => {});
      await note(`✔ ${prop.name} modelled in 3D`);
    } catch (e) {
      prop.error = (e as Error).message.slice(0, 300);
      await note(`✖ ${prop.name}: ${prop.error.split("\n")[0]}`);
    }
  });
}

const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// ---------------- Cinematographer ----------------
export async function camera(p: Production, concurrency = 4) {
  p.stage = "filming";
  await save(p);
  const todo = p.script!.shots.filter((sh) => !sh.clipURL);
  await log(p, CREW.camera, `Rolling camera on ${todo.length} shots (≈2 min, shooting in parallel)…`);
  await pool(todo, concurrency, async (sh) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        sh.clipURL = await video(`${sh.motion}. ${p.script!.style}. Cinematic, smooth motion, consistent characters.`, sh.frameURL!);
        await save(p);
        await log(p, CREW.camera, `✔ Shot ${sh.id} in the can`);
        return;
      } catch (e) {
        await log(p, CREW.camera, `Shot ${sh.id} take ${attempt} failed: ${(e as Error).message.slice(0, 160)}`);
        if (attempt === 2) throw e;
      }
    }
  });
}

// ---------------- Sound ----------------
export async function sound(p: Production) {
  if (p.voiceURL || p.musicURL) return; // already recorded (resume)
  const s = p.script!;
  const narration = s.shots.map((sh) => sh.narration.replace(/["“”]/g, "").trim()).filter(Boolean).join(" ... ");
  await log(p, CREW.sound, `Recording narration and scoring the music bed…`);
  const [voice, music] = await Promise.allSettled([
    narration
      ? audio(`Narrator: ${s.voice}. Speaks slowly with natural pauses: ${narration}`)
          .catch(() => audio(`A calm narrator says: ${narration}`))
      : Promise.resolve(undefined),
    score(`Instrumental cinematic film score, no vocals: ${s.music}`, s.shots.length * 5),
  ]).then((rs) => rs.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    log(p, CREW.sound, `${i ? "Music" : "Narration"} failed (${String(r.reason?.message ?? r.reason).slice(0, 120)}), cutting without it.`);
    return undefined;
  }));
  p.voiceURL = voice;
  p.musicURL = music;
  await save(p);
}

// ---------------- Editor ----------------
export async function editor(p: Production) {
  p.stage = "editing";
  await save(p);
  const d = dir(p);
  await log(p, CREW.editor, `Cutting the film together…`);
  const clips = await Promise.all(p.script!.shots.map((sh) => download(sh.clipURL!, join(d, `shot-${sh.id}.mp4`))));
  const voice = p.voiceURL ? await download(p.voiceURL, join(d, "voice.mp3")) : undefined;
  const music = p.musicURL ? await download(p.musicURL, join(d, "music.mp3")) : undefined;
  const out = join(d, "final.mp4");
  await assemble({ clips, voice, music, out, title: p.script!.title });
  p.finalPath = out;
  p.stage = "done";
  await save(p);
  const secs = await probeDuration(out).catch(() => 0);
  await log(p, CREW.editor, `🎞️ "${p.script!.title}" is ready (${secs.toFixed(0)}s).`);
  return out;
}
