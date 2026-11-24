// Spike: exercise one call per modality and print timing + raw shape.
import { run, MODELS, llm, image, video, audio, model3d } from "./runware.js";

const which = process.argv[2] ?? "all";
const t = async <T>(name: string, fn: () => Promise<T>) => {
  const s = Date.now();
  try {
    const r = await fn();
    console.log(`✅ ${name} (${((Date.now() - s) / 1000).toFixed(1)}s):`, typeof r === "string" ? r : JSON.stringify(r).slice(0, 800));
    return r;
  } catch (e) {
    console.log(`❌ ${name} (${((Date.now() - s) / 1000).toFixed(1)}s):`, (e as Error).message.slice(0, 800));
  }
};

console.log(MODELS);
if (which === "all" || which === "llm") await t("llm", () => llm("Reply with JSON only.", 'Give {"logline": string} for a 30s sci-fi short.', { json: true }));
let img: string | undefined;
if (which === "all" || which === "image" || which === "video" || which === "3d") img = await t("image", () => image("cinematic still, lone astronaut in a neon-lit noodle bar, rain on windows, 35mm film"));
if ((which === "all" || which === "video") && img) await t("video", () => video("the astronaut slowly turns toward the camera, steam rises, rain streaks", img!));
if (which === "all" || which === "audio") await t("audio", () => audio("A weary narrator, low male voice, says: 'Nobody remembers the last flight home.' Soft synth pad underneath."));
if (which === "all" || which === "3d") {
  const prop = await t("prop image", () => image("a single retro ramen bowl with chopsticks, centered, plain white background, product shot", [], { width: 1024, height: 1024 }));
  if (prop) await t("3d", () => model3d(prop));
}
if (which === "raw3d") console.log(JSON.stringify(await run({ taskType: "3dInference", model: MODELS.model3d, outputFormat: "GLB", inputs: { image: process.argv[3] } }), null, 2));
