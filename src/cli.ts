// CLI: npx tsx src/cli.ts "a pitch"   → runs the whole pipeline with auto-approval.
import "dotenv/config";
import { preProduction, production } from "./pipeline.js";

const pitch = process.argv.slice(2).join(" ") || "A retired astronaut runs a tiny noodle bar on a rainy space station and gets one last visitor from Earth.";
const t0 = Date.now();
const { p, set } = await preProduction(pitch);
console.log(`\n--- storyboard ready in ${((Date.now() - t0) / 1000).toFixed(0)}s (auto-approving) ---\n`);
p.script!.shots.forEach((s) => console.log(`  shot ${s.id}: ${s.frameURL}`));
const out = await production(p);
await set;
console.log(`\n✅ ${out}  (total ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
