/**
 * Gamewright — the demo game.
 *
 * A small, hand-written arcade game so a visitor can play something before
 * they connect their account. It is served through the same sandbox as every
 * generated game, so it sticks to the house rules: one canvas, no network,
 * no external assets.
 */

export const DEMO_GAME = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neon Drift</title>
<style>
  html, body {
    margin: 0;
    height: 100%;
    background: #05070d;
    color: #e6f1ff;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  #wrap {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
  }
  canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    touch-action: none;
  }
</style>
</head>
<body>
<div id="wrap"><canvas id="c"></canvas></div>
<script>
(function () {
  "use strict";

  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var W = 960, H = 540;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  var COLORS = { cyan: "#22e6ff", magenta: "#ff3dda", amber: "#ffb347", violet: "#9a6bff" };

  var player, hazards, orbs, particles, score, best, lives, level, state, shake, keys, pointer;
  var audio = null;
  var spawnTimer = 0;
  var orbTimer = 0;

  function beep(freq, duration, type, gain) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      var osc = audio.createOscillator();
      var env = audio.createGain();
      osc.type = type || "square";
      osc.frequency.value = freq;
      env.gain.value = gain || 0.05;
      env.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      osc.connect(env);
      env.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration);
    } catch (err) { /* audio is optional */ }
  }

  function bestScore() {
    try { return Number(localStorage.getItem("neon-drift-best") || 0); } catch (err) { return 0; }
  }

  function setBest(value) {
    try { localStorage.setItem("neon-drift-best", String(value)); } catch (err) { /* private mode */ }
  }

  function reset() {
    player = { x: W / 2, y: H - 70, w: 34, h: 16, speed: 7, glow: 0 };
    hazards = [];
    orbs = [];
    particles = [];
    score = 0;
    best = bestScore();
    lives = 3;
    level = 1;
    shake = 0;
    state = "title";
    spawnTimer = 0;
    orbTimer = 0;
  }

  function start() {
    reset();
    state = "play";
    beep(440, 0.08, "square", 0.04);
  }

  function spawnHazard() {
    var speed = 2.4 + level * 0.55 + Math.random() * 1.6;
    hazards.push({
      x: Math.random() * (W - 60) + 30,
      y: -30,
      w: 26 + Math.random() * 22,
      h: 26 + Math.random() * 22,
      spin: (Math.random() - 0.5) * 0.06,
      angle: 0,
      speed: speed,
      kind: Math.random() < 0.3 ? "square" : "tri"
    });
  }

  function spawnOrb() {
    orbs.push({
      x: Math.random() * (W - 60) + 30,
      y: -20,
      r: 9,
      speed: 2.1 + level * 0.4,
      phase: Math.random() * Math.PI * 2
    });
  }

  function burst(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 1 + Math.random() * 4;
      particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color: color });
    }
  }

  function drawShip() {
    var p = player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowBlur = 24;
    ctx.shadowColor = COLORS.cyan;
    ctx.fillStyle = COLORS.cyan;
    ctx.beginPath();
    ctx.moveTo(0, -p.h);
    ctx.lineTo(p.w / 2, p.h);
    ctx.lineTo(0, p.h / 2);
    ctx.lineTo(-p.w / 2, p.h);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#05070d";
    ctx.beginPath();
    ctx.arc(0, -p.h / 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawText(text, x, y, size, color, align, weight) {
    ctx.fillStyle = color || "#e6f1ff";
    ctx.font = (weight || "700") + " " + size + "px system-ui, sans-serif";
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function hud() {
    drawText(String(score), 24, 28, 26, COLORS.cyan, "left");
    drawText("BEST " + best, W - 24, 28, 18, "#8ea3bf", "right");
    for (var i = 0; i < lives; i++) {
      ctx.fillStyle = COLORS.magenta;
      ctx.beginPath();
      ctx.arc(W / 2 - (lives - 1) * 9 + i * 18, 28, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    drawText("LEVEL " + level, W / 2, 28, 15, "#8ea3bf");
  }

  function update() {
    if (state !== "play") return;

    if (keys["ArrowLeft"] || keys["a"]) player.x -= player.speed;
    if (keys["ArrowRight"] || keys["d"]) player.x += player.speed;
    if (pointer.active) player.x = pointer.x;
    if (player.x < 20) player.x = 20;
    if (player.x > W - 20) player.x = W - 20;

    spawnTimer -= 1;
    if (spawnTimer <= 0) {
      spawnHazard();
      spawnTimer = Math.max(22, 62 - level * 4);
    }

    orbTimer -= 1;
    if (orbTimer <= 0) {
      spawnOrb();
      orbTimer = Math.max(50, 120 - level * 6);
    }

    var i;
    for (i = hazards.length - 1; i >= 0; i--) {
      var hz = hazards[i];
      hz.y += hz.speed;
      hz.angle += hz.spin;
      if (hz.y > H + 40) { hazards.splice(i, 1); continue; }
      if (Math.abs(hz.x - player.x) < (hz.w / 2 + player.w / 2) && Math.abs(hz.y - player.y) < (hz.h / 2 + player.h / 2)) {
        hazards.splice(i, 1);
        lives -= 1;
        shake = 14;
        burst(player.x, player.y, COLORS.magenta, 26);
        beep(120, 0.22, "sawtooth", 0.07);
        if (lives <= 0) {
          state = "over";
          if (score > best) { best = score; setBest(best); }
          beep(90, 0.5, "square", 0.06);
        }
      }
    }

    for (i = orbs.length - 1; i >= 0; i--) {
      var orb = orbs[i];
      orb.y += orb.speed;
      orb.phase += 0.08;
      if (orb.y > H + 20) { orbs.splice(i, 1); continue; }
      var dx = orb.x - player.x, dy = orb.y - player.y;
      if (dx * dx + dy * dy < (orb.r + 16) * (orb.r + 16)) {
        orbs.splice(i, 1);
        score += 10;
        level = 1 + Math.floor(score / 100);
        burst(orb.x, orb.y, COLORS.amber, 16);
        beep(760, 0.09, "triangle", 0.05);
      }
    }

    for (i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += 0.08;
      pt.life -= 0.03;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    if (shake > 0) shake -= 0.8;
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    ctx.fillStyle = "#05070d";
    ctx.fillRect(-20, -20, W + 40, H + 40);

    ctx.strokeStyle = "rgba(34,230,255,0.10)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 60) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 0; gy <= H; gy += 60) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    var i;
    for (i = 0; i < hazards.length; i++) {
      var hz = hazards[i];
      ctx.save();
      ctx.translate(hz.x, hz.y);
      ctx.rotate(hz.angle);
      ctx.shadowBlur = 18;
      ctx.shadowColor = COLORS.violet;
      ctx.fillStyle = hz.kind === "square" ? COLORS.violet : "#5b8cff";
      if (hz.kind === "square") {
        ctx.fillRect(-hz.w / 2, -hz.h / 2, hz.w, hz.h);
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -hz.h / 2);
        ctx.lineTo(hz.w / 2, hz.h / 2);
        ctx.lineTo(-hz.w / 2, hz.h / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    for (i = 0; i < orbs.length; i++) {
      var orb = orbs[i];
      ctx.save();
      ctx.shadowBlur = 20;
      ctx.shadowColor = COLORS.amber;
      ctx.fillStyle = COLORS.amber;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.r + Math.sin(orb.phase) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (i = 0; i < particles.length; i++) {
      var pt = particles[i];
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state === "play" || state === "over") drawShip();
    hud();
    ctx.restore();

    if (state === "title") {
      ctx.fillStyle = "rgba(5,7,13,0.78)";
      ctx.fillRect(0, 0, W, H);
      drawText("NEON DRIFT", W / 2, H / 2 - 40, 58, COLORS.cyan);
      drawText("a demo game that ships with Gamewright", W / 2, H / 2 + 10, 20, "#b9c9de");
      drawText("press SPACE or click to start", W / 2, H / 2 + 66, 22, COLORS.amber);
      drawText("move with the arrow keys, mouse or finger", W / 2, H / 2 + 108, 16, "#8ea3bf");
    }

    if (state === "over") {
      ctx.fillStyle = "rgba(5,7,13,0.72)";
      ctx.fillRect(0, 0, W, H);
      drawText("GAME OVER", W / 2, H / 2 - 46, 52, COLORS.magenta);
      drawText("score " + score, W / 2, H / 2 + 16, 30, "#e6f1ff");
      drawText("best " + best, W / 2, H / 2 + 54, 20, "#b9c9de");
      drawText("press SPACE to play again", W / 2, H / 2 + 104, 20, COLORS.amber);
    }
  }

  function frame() {
    update();
    draw();
    requestAnimationFrame(frame);
  }

  addEventListener("keydown", function (e) {
    keys[e.key] = true;
    if (e.key === " " || e.key === "Enter") {
      if (state !== "play") { e.preventDefault(); start(); }
    }
  });

  addEventListener("keyup", function (e) { keys[e.key] = false; });

  function pointerAt(event) {
    var rect = canvas.getBoundingClientRect();
    var x = ((event.clientX - rect.left) / rect.width) * W;
    pointer.x = Math.max(20, Math.min(W - 20, x));
    pointer.active = true;
  }

  canvas.addEventListener("pointermove", pointerAt);
  canvas.addEventListener("pointerdown", function (event) {
    pointerAt(event);
    if (state !== "play") start();
  });

  addEventListener("blur", function () { keys = {}; pointer.active = false; });

  keys = {};
  pointer = { active: false, x: W / 2 };
  reset();
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
