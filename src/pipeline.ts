// The Director: sequences the crew. Two phases split by the human approval gate.
import { type Production, create, save, log } from "./production.js";
import { CREW, writer, storyboard, setDesigner, camera, sound, editor, frame } from "./agents.js";

const SHOTS = Number(process.env.GR_SHOTS ?? 4);

/** Phase 1: pitch → script → (3D set in background) → storyboard frames. Ends in stage "review". */
export async function preProduction(pitch: string, chat?: Production["chat"]) {
  const p = await create(pitch, chat);
  await log(p, CREW.director, `New production: "${pitch}". Crew, let's go.`);
  try {
    await writer(p, SHOTS);
    const set = setDesigner(p).catch((e) => log(p, CREW.setdesigner, `Set build failed: ${e.message}`));
    await storyboard(p);
    return { p, set };
  } catch (e) {
    await fail(p, e);
    throw e;
  }
}

/** Redo one frame with a director's note (human feedback loop). */
export async function redo(p: Production, shotId: number, note: string) {
  const sh = p.script!.shots.find((s) => s.id === shotId);
  if (!sh) throw new Error(`No shot ${shotId}`);
  await log(p, CREW.storyboard, `Redrawing shot ${shotId}: ${note}`);
  await frame(p, sh, note);
  return sh;
}

/** Phase 2: approved frames → clips + sound in parallel → final cut. */
export async function production(p: Production) {
  try {
    p.script!.shots.forEach((s) => (s.approved = true));
    p.error = undefined;
    await save(p);
    await log(p, CREW.director, `Storyboard locked. Rolling!`);
    await Promise.all([camera(p), sound(p)]);
    return await editor(p);
  } catch (e) {
    await fail(p, e);
    throw e;
  }
}

async function fail(p: Production, e: unknown) {
  p.stage = "failed";
  p.error = (e as Error).message;
  await log(p, CREW.director, `✖ Production halted: ${p.error.slice(0, 300)}`);
}
