/**
 * Test harness only — not part of the published app.
 * Stubs the Pollinations gateway so the whole flow can be exercised without a key.
 */
const PNG_1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const MOCK_GAME = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock Dodge</title>
<style>html,body{margin:0;background:#08101f;color:#e6f1ff;font-family:system-ui}canvas{display:block}</style>
</head><body>
<canvas id="c" width="640" height="360"></canvas>
<script>
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  let x = 320, score = 0, alive = true;
  const keys = {};
  addEventListener('keydown', (e) => { keys[e.key] = true; if (e.key === ' ') alive = true; });
  addEventListener('keyup', (e) => { keys[e.key] = false; });
  function loop() {
    if (keys['ArrowLeft']) x -= 6;
    if (keys['ArrowRight']) x += 6;
    if (x < 10) x = 10; if (x > 630) x = 630;
    ctx.fillStyle = '#08101f'; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#22e6ff'; ctx.fillRect(x - 18, 320, 36, 24);
    ctx.fillStyle = '#ff3dda'; ctx.fillRect(120, 40 + (score % 100), 26, 26);
    ctx.fillStyle = '#e6f1ff'; ctx.font = '18px system-ui'; ctx.fillText('score ' + score, 16, 28);
    score += 1;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
</script>
</body></html>`;

const realFetch = window.fetch.bind(window);
const BROKEN_GAME = `<!doctype html>
<html><head><meta charset="utf-8"><title>Broken Demo</title></head>
<body>
<canvas id="c" width="320" height="240"></canvas>
<script>
  throw new Error("boom - the game exploded on purpose");
</script>
</body></html>`;

window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.includes("gen.pollinations.ai")) {
        if (url.includes("/v1/chat/completions")) {
            const body = init?.body ? String(init.body) : "";
            const repairing = body.includes("ERROR REPORTED BY THE RUNTIME");
            const broken = body.includes("BROKEN") && !repairing;
            const game = broken ? BROKEN_GAME : MOCK_GAME;
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: `\`\`\`html\n${game}\n\`\`\`` } }],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );
        }
        if (url.includes("/v1/images/generations")) {
            return new Response(JSON.stringify({ data: [{ b64_json: PNG_1x1 }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (url.includes("/v1/audio/speech")) {
            return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }), {
                status: 200,
            });
        }
        if (url.includes("/account/balance")) {
            return new Response(JSON.stringify({ accountBalance: { total: 4.2 } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
    }
    return realFetch(input, init);
};

try {
    if (!location.search.includes("nokey")) {
        sessionStorage.setItem("gamewright.key", "sk_mock");
    } else {
        sessionStorage.removeItem("gamewright.key");
    }
} catch {}
