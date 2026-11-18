# Gamewright

Describe a game in a sentence, get a playable one-file browser game you can share
as a link. Frontend only — no build step, no backend, no dependencies.

Files: `index.html` (markup), `styles.css` (theme), `app.js` (orchestration + UI),
`api.js` (Pollinations calls), `forge.js` (prompts, HTML extraction, the safety net
around generated code), `share.js` (share links, local shelf), `demo.js` (the
hand-written demo game), `models.json` (catalogue snapshot), `favicon.svg`.

## Ground truth

- Source of truth: https://github.com/Marcus-Mok-GH/gamewright (branch `main`). This
  folder is the working clone — keep both in sync.
- Live app: https://marcus-mok-gh.github.io/gamewright/ (GitHub Pages, no build step).
- Quest: pollinations/pollinations#20021 ("Describe a game, get a playable game"),
  reward 10 Pollen. The app submission is a separate issue.

## Model defaults (all `paid_only: false`, verified 2026-11-18)

| Purpose | Model | Endpoint |
| --- | --- | --- |
| Code (default) | `openai/gpt-5.4-mini` | `gen.pollinations.ai/v1/chat/completions` |
| Code (options) | `openai/gpt-5.4-nano`, `openai/gpt-5.3-codex`, `z-ai/glm-5.3-flash` | same |
| Cover art | `tongyi-mai/z-image-turbo` | `gen.pollinations.ai/v1/images/generations` |
| Announcer | `openai/tts-1` | `gen.pollinations.ai/v1/audio/speech` |

Re-verify the live catalogue (`https://gen.pollinations.ai/models`) before repeating
any claim about a model or its price.

## How it works

- The visitor signs in on `enter.pollinations.ai`; the scoped `sk_` key lives in
  `sessionStorage`. No publishable App Key (`pk_`) is shipped, so traffic is not
  attributed to an app and the plain "Connect" link is used.
- `forge.js` asks a text model for one self-contained HTML file, extracts it from
  the answer, then sanitises it: no external assets, no network calls, a CSP meta
  tag, and a bootstrap that reports runtime errors back to the page.
- Generated games run in a sandboxed iframe (`sandbox="allow-scripts"`, opaque
  origin), so they cannot touch the page, the key or the network.
- Share links carry the finished game in the URL fragment (`#g=<base64url>`), so a
  friend can play it without the maker's account — nothing is regenerated and
  nothing is spent.

## Gotchas

- `styles.css` sets `[hidden] { display: none !important; }` — without it the
  `display: grid` panels beat the `hidden` attribute.
- The sandboxed iframe has an opaque origin, so the parent cannot read
  `contentDocument`. Tests must use Playwright's `frame_locator`, not `contentDocument`.
- `forge.js` rewrites `fetch(` / `XMLHttpRequest` / `eval(` in the generated source
  and injects a CSP with `connect-src 'none'`. That is deliberate.
- The demo game (`demo.js`) loads automatically on a first visit so the app is
  playable before anyone connects an account.
- `_mock.html` + `_mock.js` are a local test harness (stubbed gateway). They must
  not ship.

## Testing

```bash
node --test gamewright.test.mjs     # unit tests for forge.js + share.js
python3 test_app.py                 # end-to-end in headless Chromium (mocked gateway)
```
