# Gamewright

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

**Describe the game you dream of. Get a playable game you can send to a friend.**

Gamewright is a browser-only game forge. You type what you want to play — "a cat
that has to fish while the tide comes in" — and a Pollinations text model writes it
as one self-contained HTML file. The game starts playing in the page, and you can
change it, fix it, download it, or send it to someone as a link that runs the game
with no further calls.

Every request is paid for by you, from your own Pollinations balance. The app never
holds a secret key and never pays on your behalf.

Live app: **https://marcus-mok-gh.github.io/gamewright/**

## What it does

- **Dream it.** Describe the game in a sentence, or roll the dice for a random idea.
- **Play it.** The generated game runs in a sandboxed frame right on the page — keyboard, mouse, score, lives, game over, restart.
- **Change it.** "Make it twice as hard", "add a boss", "use neon colours" — the model rewrites the game and you keep both versions.
- **Fix it.** If a game throws on load, the error is caught and one click asks the model to repair it.
- **Share it.** The whole game is compressed into the URL, so a friend opens the link and plays — no account, no cost, no server.
- **Keep it.** Every game lands on your shelf in the browser, with cover art drawn by an image model and an optional announcer voice.

## How it works

1. **Connect.** The app uses [Pollinations Pay](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md). Pollinations hands the visitor a scoped `sk_` key for their own balance; the key lives in `sessionStorage` and never leaves the browser. This checkout ships without an App Key, so it uses the plain **Sign in** link to the same consent screen and the traffic is not attributed to an app. Add a publishable `pk_` key in `api.js` and the official *Connect* button appears instead, with the budget, expiry and model scopes the visitor approves.
2. **Write.** The idea, the genre and any extra details go to a text model as a strict brief: one HTML file, no build step, no external assets, no network calls, canvas or DOM, keyboard and mouse input, a score, a lose condition and a restart.
3. **Play.** The file is sanitised, given a strict content-security policy and loaded into a sandboxed frame (`allow-scripts` only, no same-origin, no network). A small bootstrap reports runtime errors back to the page so a broken game can be repaired instead of sitting there dead.
4. **Dress it.** An image model paints the cover art, and a speech model can announce the game out loud. Both are optional.
5. **Share.** The game is deflated and base64url-encoded into the link. Opening it restores the game locally — the recipient never pays for anything.

## Models

Every default is in the live model catalog with `paid_only: false`, so a user can run them on a Quest balance.
Each model has its own catalog entry — the link in the last column returns that entry as JSON.

| Role | Model | `paid_only` | Endpoint | Live catalog entry |
| --- | --- | --- | --- | --- |
| Game code (fast) | `openai/gpt-5.4-nano` | false | `/v1/chat/completions` | [entry](https://gen.pollinations.ai/v1/models/openai/gpt-5.4-nano) |
| Game code (default) | `openai/gpt-5.4-mini` | false | `/v1/chat/completions` | [entry](https://gen.pollinations.ai/v1/models/openai/gpt-5.4-mini) |
| Game code (best) | `openai/gpt-5.3-codex` | false | `/v1/chat/completions` | [entry](https://gen.pollinations.ai/v1/models/openai/gpt-5.3-codex) |
| Game code (cheap) | `z-ai/glm-5.3-flash` | false | `/v1/chat/completions` | [entry](https://gen.pollinations.ai/v1/models/z-ai/glm-5.3-flash) |
| Cover art | `tongyi-mai/z-image-turbo` | false | `/v1/images/generations` | [entry](https://gen.pollinations.ai/v1/models/tongyi-mai/z-image-turbo) |
| Announcer voice | `openai/tts-1` | false | `/v1/audio/speech` | [entry](https://gen.pollinations.ai/v1/models/openai/tts-1) |

The catalog entries are copied into [`models.json`](models.json), read from <https://gen.pollinations.ai/v1/models> on 2026-11-18. The full list endpoint returns one long minified line, so the per-model links above are the easy way to check a single entry:

```bash
curl -s https://gen.pollinations.ai/v1/models/openai/gpt-5.4-mini
```

The defaults are constants at the top of `api.js`, so you can point the app at a different model without touching anything else.

## Run it locally

The app is plain HTML, CSS and JavaScript with no build step. Any static server works.

```bash
git clone https://github.com/Marcus-Mok-GH/gamewright.git
cd gamewright
python3 -m http.server 8000
# open http://localhost:8000
```

Set your own App Key in `api.js` if you fork it:

```js
export const CONFIG = {
    appKey: "pk_your_app_key",
    ...
```

Register `http://localhost:8000` as a Redirect URI on that App Key.

## Files

| File | What it holds |
| --- | --- |
| `index.html` | Markup: the forge, the stage, the shelf |
| `styles.css` | Neon arcade theme, mobile-first |
| `app.js` | Forge flow, stage, shelf, sharing, repair loop |
| `api.js` | Pollinations calls: chat, images, speech, balance |
| `forge.js` | The brief, the parser and the sandbox |
| `share.js` | Link compression and the shelf in `localStorage` |
| `models.json` | Catalog snapshot of the default models |
| `favicon.svg` | App icon |
| `screenshot.png` | Screenshot used for the app catalog |

## Privacy

The key lives in `sessionStorage` and disappears when the tab closes. Your idea and the generated game are stored in `localStorage` on your own device, and the game goes to Pollinations to be written. Generated games run sandboxed with no network access, so they cannot phone home. Nothing is sent to a server of ours — Gamewright has no backend.

## License

MIT
