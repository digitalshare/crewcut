// Thin REST client for Runware: sync tasks + async (video/3D/audio) polling via getResponse.
import { randomUUID } from "node:crypto";

const API = "https://api.runware.ai/v1";
const KEY = process.env.RUNWARE_API_KEY;
if (!KEY) throw new Error("RUNWARE_API_KEY not set");

export const MODELS = {
  llm: process.env.GR_LLM ?? "anthropic:claude@sonnet-4.6",
  image: process.env.GR_IMAGE ?? "google:nano-banana@2.1",
  video: process.env.GR_VIDEO ?? "klingai:kling-video@4.0-flash",
  voice: process.env.GR_VOICE ?? "bytedance:seed-audio@1.0",
  music: process.env.GR_MUSIC ?? "runware:ace-step@v1.5-turbo",
  model3d: process.env.GR_3D ?? "tencent:hunyuan-3d@3.1-rapid",
};

type Task = Record<string, unknown> & { taskType: string };

async function post(tasks: Task[]): Promise<any[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(tasks),
  });
  const json: any = await res.json().catch(() => ({}));
  if (json.errors?.length) {
    const e = json.errors[0];
    throw new Error(`Runware ${e.code ?? res.status}: ${e.message ?? JSON.stringify(e)}`);
  }
  if (!res.ok) throw new Error(`Runware HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json.data ?? [];
}

/** Run a task. Async task types are polled until a result arrives. */
export async function run(task: Task, { timeoutMs = 600_000 } = {}): Promise<any> {
  const taskUUID = randomUUID();
  const isAsync = ["videoInference", "3dInference", "audioInference"].includes(task.taskType);
  const data = await post([{ taskUUID, ...(isAsync ? { deliveryMethod: "async" } : {}), ...task }]);
  if (!isAsync) return data.find((d) => d.taskUUID === taskUUID) ?? data[0];

  const start = Date.now();
  let delay = 2000;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 8000);
    const polled = await post([{ taskType: "getResponse", taskUUID }]);
    const item = polled.find((d) => d.taskUUID === taskUUID);
    if (!item) continue;
    if (item.status === "error" || item.status === "failed") {
      throw new Error(`Runware task failed: ${JSON.stringify(item)}`);
    }
    if (item.status === "success" || hasOutput(item)) return item;
  }
  throw new Error(`Runware task ${taskUUID} timed out`);
}

function hasOutput(item: any) {
  return Boolean(item.videoURL || item.audioURL || item.imageURL || item.outputs);
}

// ---------- High-level helpers ----------

export async function llm(system: string, user: string, opts: { json?: boolean } = {}): Promise<string> {
  const r = await run({
    taskType: "textInference",
    model: MODELS.llm,
    messages: [{ role: "user", content: user }],
    settings: { systemPrompt: system, maxTokens: 4000, temperature: 0.8 },
  });
  const text: string = r.text ?? r.content ?? r.output ?? r.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`LLM returned no text: ${JSON.stringify(r).slice(0, 500)}`);
  return opts.json ? extractJson(text) : text;
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return body.slice(start, end + 1);
}

export async function image(prompt: string, refs: string[] = [], size = { width: 1376, height: 768 }) {
  const r = await run({
    taskType: "imageInference",
    model: MODELS.image,
    positivePrompt: prompt,
    ...size,
    outputType: "URL",
    outputFormat: "JPG",
    ...(refs.length ? { inputs: { referenceImages: refs } } : {}),
  });
  return r.imageURL as string;
}

export async function video(prompt: string, firstFrame: string, duration = 5) {
  const r = await run({
    taskType: "videoInference",
    model: MODELS.video,
    positivePrompt: prompt,
    duration,
    outputType: "URL",
    outputFormat: "MP4",
    inputs: { frameImages: [{ image: firstFrame, frame: "first" }] },
  });
  return r.videoURL as string;
}

export async function audio(text: string, model = MODELS.voice) {
  const r = await run({
    taskType: "audioInference",
    model,
    positivePrompt: text,
    outputType: "URL",
    outputFormat: "MP3",
  });
  return (r.audioURL ?? r.outputs?.[0]?.url) as string;
}

// Image→GLB with a fallback chain: providers are flaky, and each takes a slightly different input shape.
const MODEL3D_CHAIN: { model: string; inputs: (img: string) => object }[] = [
  { model: MODELS.model3d, inputs: (img) => ({ image: img }) },
  { model: "hyper3d:rodin@gen-2", inputs: (img) => ({ image: img }) },
  { model: "tripo:v3.1@0", inputs: (img) => ({ images: [img] }) },
];

export async function music(prompt: string, seconds = 30) {
  const r = await run({
    taskType: "audioInference",
    model: MODELS.music,
    positivePrompt: prompt,
    duration: Math.min(300, Math.max(30, Math.ceil(seconds))),
    outputType: "URL",
    outputFormat: "MP3",
  });
  return r.audioURL as string;
}

export async function model3d(imageURL: string): Promise<string> {
  const errors: string[] = [];
  for (const { model, inputs } of MODEL3D_CHAIN) {
    try {
      const r = await run({ taskType: "3dInference", model, outputType: "URL", outputFormat: "GLB", inputs: inputs(imageURL) });
      const url = findUrl(r);
      if (url) return url;
      errors.push(`${model}: no url in ${JSON.stringify(r).slice(0, 300)}`);
    } catch (e) {
      errors.push(`${model}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  throw new Error(`All 3D models failed:\n${errors.join("\n")}`);
}

function findUrl(o: any): string | undefined {
  if (typeof o === "string" && /^https?:\/\//.test(o) && !/\.(jpe?g|png|webp)(\?|$)/i.test(o)) return o;
  if (o && typeof o === "object") for (const v of Object.values(o)) { const u = findUrl(v); if (u) return u; }
}

export async function download(url: string, dest: string) {
  const { writeFile } = await import("node:fs/promises");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}
