# 🎬 Crewcut: an AI film crew that lives in your Teamily chat

Pitch a one-line idea in Teamily. A crew of agents writes it, casts it, storyboards it and builds the set in 3D. You approve or redo frames right in the chat. Then the crew shoots, scores and cuts a finished short film.

**Sponsors:** [Teamily](https://teamily.ai) is where the crew and producers collaborate. [Runware](https://runware.ai) is the single API behind every model: LLM, image, video, audio and 3D.

## The crew
| Agent | Does | Runware model |
|---|---|---|
| ✍️ Writer | pitch → script, shot list, VO, music brief, props | `anthropic:claude@sonnet-4.6` |
| 🖼️ Storyboard | character sheet → consistent per-shot frames (reference-image conditioned) | `google:nano-banana@2.1` |
| 🏗️ Set Designer | props → product shots → **GLB 3D models** + LLM layout → three.js set | `tencent:hunyuan-3d@3.1-rapid` (fallback Rodin Gen-2, Tripo 3.1) |
| 🎥 Cinematographer | approved frame → 5s clip, shots in parallel | `klingai:kling-video@4.0-flash` |
| 🎧 Sound | narration + instrumental score | `bytedance:seed-audio@1.0` (VO), `runware:ace-step@v1.5-turbo` (score) |
| ✂️ Editor | ffmpeg: crossfades, fades, VO over ducked music → `final.mp4` | local ffmpeg |
| 🎬 Director | Claude Code running in this folder through the **Teamily local runtime**; talks to humans and drives `gr` | (your Claude Code) |

```
Teamily chat ──► Teamily Swarm ──► `teamily daemon` (this Mac) ──► Claude Code (cwd = crewcut/, reads CLAUDE.md)
                                                                        │  npm run gr -- pitch|redo|shoot
                                                                        ▼
                                              Runware API (LLM · image · video · audio · 3D)  +  ffmpeg
                                                                        │
                       web board + three.js set + final.mp4  ◄──────────┘   (exposed via cloudflared)
```

## Run it
```bash
npm install
cp .env.example .env            # RUNWARE_API_KEY=...
npm run web                     # board on http://localhost:4321
npm run tunnel                  # copy the https://*.trycloudflare.com URL into .env as GR_PUBLIC_URL

# Connect to Teamily (TEAMILY_API_KEY = pk_*:sk_* Swarm key)
cd crewcut && TEAMILY_PROVIDERS=claude teamily daemon start --foreground
# In the Teamily app, create or choose an agent running on this device (Claude). DM it or @-mention it in a group.
```

Try it in chat: *"Make a film: a retired astronaut runs a noodle bar on a rainy space station and gets one last visitor from Earth."* → frames appear → *"redo 2: make it night, neon reflections"* → *"approve"* → the final film link arrives about 4 minutes later.

### Without Teamily
```bash
npm run gr -- pitch "a lighthouse keeper gets a signal from a ship lost 200 years ago"
npm run gr -- redo latest 2 "closer, more fog"
npm run gr -- shoot latest
npm run cli -- "any pitch"      # whole pipeline, auto-approve
```

## Layout
- `src/runware.ts`: REST client (sync tasks plus polling for async video/audio/3D) and helpers per modality
- `src/agents.ts`: the crew
- `src/pipeline.ts`: the Director's sequencing: pre-production → human gate → production
- `src/editor.ts`: ffmpeg assembly
- `src/gr.ts`: step-by-step CLI the chat agent calls
- `src/web.ts`: production board, three.js set viewer, file server
- `CLAUDE.md`: the Director persona and the playbook for the Teamily-hosted agent
- `productions/<id>/`: `production.json`, clips, audio, GLBs, `final.mp4`
