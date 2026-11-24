// ffmpeg assembly: normalise clips → concat with short crossfades → title card → mix VO over ducked music.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";

const exec = promisify(execFile);
const W = 1280, H = 720, FPS = 24, XF = 0.4; // crossfade seconds

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(stdout.trim());
}

export async function assemble(o: { clips: string[]; voice?: string; music?: string; out: string; title?: string }) {
  const durs = await Promise.all(o.clips.map(probeDuration));
  const d = dirname(o.out);

  // 1) video: scale/pad each clip, chain xfade transitions
  const args: string[] = ["-y"];
  o.clips.forEach((c) => args.push("-i", c));
  const norm = o.clips.map((_, i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
  let chain = "", last = "v0", offset = 0;
  for (let i = 1; i < o.clips.length; i++) {
    offset += durs[i - 1] - XF;
    chain += `;[${last}][v${i}]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}[x${i}]`;
    last = `x${i}`;
  }
  const total = durs.reduce((a, b) => a + b, 0) - XF * (o.clips.length - 1);
  const fade = `;[${last}]fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8[vout]`;
  const silent = join(d, "picture.mp4");
  await exec("ffmpeg", [...args, "-filter_complex", norm.join(";") + chain + fade, "-map", "[vout]", "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", silent], { maxBuffer: 1 << 26 });

  // 2) audio: VO at full level starting at 0.5s, music ducked under it, both trimmed to picture length
  const aIn: string[] = [];
  const parts: string[] = [];
  let idx = 1;
  if (o.music) { aIn.push("-i", o.music); parts.push(`[${idx}:a]volume=0.35,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[m]`); idx++; }
  if (o.voice) { aIn.push("-i", o.voice); parts.push(`[${idx}:a]adelay=500|500,volume=1.4[vo]`); idx++; }
  const mixInputs = (o.music ? "[m]" : "") + (o.voice ? "[vo]" : "");
  const n = (o.music ? 1 : 0) + (o.voice ? 1 : 0);
  if (n === 0) {
    await exec("cp", [silent, o.out]);
    return o.out;
  }
  const filter = parts.join(";") + `;${mixInputs}amix=inputs=${n}:duration=longest:normalize=0,atrim=0:${total.toFixed(3)}[aout]`;
  await exec("ffmpeg", ["-y", "-i", silent, ...aIn, "-filter_complex", filter, "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", o.out], { maxBuffer: 1 << 26 });
  return o.out;
}
