import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMessages, extractHtml, sanitizeHtml, titleFromIdea } from "../forge.js";
import { decodeGame, encodeGame } from "../share.js";

const GAME = `<!doctype html><html><head><title>Demo</title></head><body>
<canvas id="c" width="320" height="240"></canvas>
<script>
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  ctx.fillRect(0, 0, 10, 10);
  fetch('https://example.com/score');
</script>
</body></html>`;

test("extractHtml pulls code out of a fenced block", () => {
    const raw = `Sure! Here is your game:\n\n\`\`\`html\n${GAME}\n\`\`\`\n\nEnjoy!`;
    assert.equal(extractHtml(raw).includes("<canvas"), true);
});

test("extractHtml keeps a bare document", () => {
    assert.equal(extractHtml(GAME).includes("<canvas"), true);
});

test("extractHtml returns null when there is no code", () => {
    assert.equal(extractHtml("I am afraid I cannot do that."), null);
});

test("sanitizeHtml injects a CSP and the error bootstrap", () => {
    const out = sanitizeHtml(GAME);
    assert.equal(out.html.includes("Content-Security-Policy"), true);
    assert.equal(out.html.includes("gamewright-bootstrap"), true);
    assert.equal(out.html.includes("game-ready"), true);
    assert.equal(out.html.includes("game-error"), true);
});

test("sanitizeHtml removes remote assets and network calls", () => {
    const html =
        '<html><head><script src="https://cdn.example.com/x.js"></script>' +
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">' +
        '<img src="https://cdn.example.com/a.png" alt="a"></head>' +
        "<body><script>fetch('https://example.com');</script></body></html>";
    const out = sanitizeHtml(html);
    assert.equal(/cdn\.example\.com/.test(out.html), false);
    assert.equal(/__gwBlockedFetch\(/.test(out.html), true);
});

test("sanitizeHtml refuses a document with no script at all", () => {
    const out = sanitizeHtml("<html><body><p>just text</p></body></html>");
    assert.equal(out.html, "");
    assert.equal(out.warnings.length > 0, true);
});

test("buildMessages carries the idea, the genre and the constraints", () => {
    const messages = buildMessages({
        idea: "a duck dodges pizza",
        genre: "arcade",
    });
    const text = JSON.stringify(messages);
    assert.equal(text.includes("duck dodges pizza"), true);
    assert.equal(text.toLowerCase().includes("self-contained"), true);
});

test("buildMessages in tweak mode quotes the previous game", () => {
    const messages = buildMessages({
        idea: "a duck dodges pizza",
        genre: "arcade",
        previousHtml: GAME,
        tweak: "make it twice as fast",
    });
    const text = JSON.stringify(messages);
    assert.equal(text.includes("twice as fast"), true);
    assert.equal(text.includes("<canvas"), true);
});

test("titleFromIdea makes a readable title", () => {
    const title = titleFromIdea("  a duck dodges pizza  ");
    assert.equal(title.length > 0, true);
    assert.equal(title.length <= 64, true);
});

test("share payload round-trips", () => {
    const payload = encodeGame({
        title: "Duck Dodge",
        prompt: "a duck",
        html: GAME,
    });
    const decoded = decodeGame(payload);
    assert.equal(decoded.title, "Duck Dodge");
    assert.equal(decoded.html, GAME);
});

test("share payload survives a big document", () => {
    const html = `<html><body>${"<p>hello world</p>".repeat(400)}</body></html>`;
    const payload = encodeGame({ title: "Big", prompt: "p", html });
    assert.equal(decodeGame(payload).html, html);
    assert.equal(payload.length < html.length, true);
});

test("share payload rejects rubbish", () => {
    assert.equal(decodeGame("nonsense"), null);
    assert.equal(decodeGame(""), null);
    assert.equal(decodeGame(null), null);
});
