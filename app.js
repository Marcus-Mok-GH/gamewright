/**
 * Gamewright — describe a game, get a playable game you can share.
 *
 * The heavy lifting lives in three modules:
 *   api.js   — every call to Pollinations (text, image, speech)
 *   forge.js — prompt building and the safety net around generated code
 *   share.js — share links and the local shelf of games
 */

import { CONFIG, chat, fetchBalance, generateCover, speak } from "./api.js";
import { DEMO_GAME } from "./demo.js";
import { buildMessages, extractHtml, GENRES, sanitizeHtml, titleFromIdea } from "./forge.js";
import {
    buildShareUrl,
    deleteGame,
    encodeGame,
    listGames,
    readShareFromLocation,
    saveGame,
} from "./share.js";

const STORAGE_KEY = "gamewright.key";

/** Text models a player can pick from. All are free to call. */
const MODELS = [
    { id: "openai/gpt-5.4-nano", label: "Fast · GPT-5.4 Nano" },
    { id: "openai/gpt-5.4-mini", label: "Balanced · GPT-5.4 Mini" },
    { id: "openai/gpt-5.3-codex", label: "Best code · GPT-5.3 Codex" },
    { id: "z-ai/glm-5.3-flash", label: "Cheap · GLM-5.3 Flash" },
];

/** Ideas for the "Surprise me" button. */
const SPARKS = [
    "A game where you are a lighthouse keeper throwing fish at seagulls on a stormy night",
    "A game where a snail races a cheetah across a kitchen counter",
    "A game where you catch falling soup bowls with a frying pan",
    "A game where you run a tiny spaceship through the traffic of a crowded planet",
    "A game where a wizard's hat eats the spells you try to cast",
    "A game where you defend a cactus from jealous cacti",
    "A game where you run a midnight bakery for nightmares that come in for croissants",
    "A game where a cat herds laser pointers across a dark living room",
    "A game where you paint a rainbow while the storm tries to wash it away",
    "A game where a time-travelling postman delivers letters to dinosaurs",
    "A game where you juggle increasingly angry houseplants",
    "A game where a dragon has to pass a job interview at a small bakery",
    "A game where you build a tower out of everyday objects while a cat knocks it over",
    "A game where you guide a paper boat through a rainstorm to a dry harbour",
];

const state = {
    apiKey: null,
    busy: false,
    current: null,
    shared: false,
    lastError: null,
};

const els = {};

/* ------------------------------------------------------------------ helpers */

function $(id) {
    return document.getElementById(id);
}

let toastTimer = null;
function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function setStatus(message, kind = "") {
    els.status.textContent = message || "";
    els.status.classList.toggle("error", kind === "error");
    els.status.classList.toggle("busy", kind === "busy");
}

function setBusy(on, label = "") {
    state.busy = on;
    els.busy.hidden = !on;
    els.busyLabel.textContent = label;
    els.forgeBtn.disabled = on;
    els.surpriseBtn.disabled = on;
    els.status.classList.toggle("busy", on);
}

/* --------------------------------------------------------------------- auth */

function readStoredKey() {
    try {
        const fromHash = new URLSearchParams(location.hash.replace(/^#/, "")).get("api_key");
        if (fromHash) {
            try {
                sessionStorage.setItem(STORAGE_KEY, fromHash);
            } catch {
                /* a blocked sessionStorage must not break the sign-in */
            }
            cleanHash();
            return fromHash;
        }
        return sessionStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function storeKey(key) {
    try {
        if (key) sessionStorage.setItem(STORAGE_KEY, key);
        else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/** Drops the api_key from the address bar but keeps a shared game link. */
function cleanHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (!params.has("api_key")) return;
    params.delete("api_key");
    const rest = params.toString();
    history.replaceState({}, "", location.pathname + location.search + (rest ? `#${rest}` : ""));
}

function adoptKey(key) {
    state.apiKey = key || null;
    storeKey(state.apiKey);
    setConnected(Boolean(state.apiKey));
    if (state.apiKey) refreshBalance();
}

function setConnected(connected) {
    els.balance.hidden = !connected;
    els.connectVeil.hidden = connected;
    els.signinBtn.textContent = connected ? "Sign out" : "Connect";
    for (const button of document.querySelectorAll("[data-needs-key]")) {
        button.classList.toggle("needs-key", !connected);
    }
}

async function refreshBalance() {
    if (!state.apiKey) return;
    const total = await fetchBalance(state.apiKey);
    els.balance.textContent = total === null ? "" : `$${total.toFixed(2)} Pollen`;
    els.balance.hidden = false;
}

function signIn() {
    if (state.apiKey) {
        adoptKey(null);
        return;
    }
    const params = new URLSearchParams({
        redirect_uri: `${location.origin}${location.pathname}`,
        scope: "usage",
    });
    location.href = `${CONFIG.enterUrl}/authorize?${params}`;
}

function needsKey() {
    if (state.apiKey) return true;
    toast("Connect your Pollinations account first.");
    els.connectVeil.hidden = false;
    return false;
}

/* ------------------------------------------------------------------- making */

/** Pulls the title out of the generated file, falling back to the idea. */
function titleOf(html, idea) {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
    const title = match ? match[1].replace(/\s+/g, " ").trim() : "";
    if (title && title.length < 60) return title;
    return titleFromIdea(idea);
}

/**
 * Asks a model for a game and turns the answer into something playable.
 * `previousHtml` + `tweak` or `error` turn the call into a revision.
 */
async function writeGame({ idea, genre, extra, previousHtml, tweak, error }) {
    const messages = buildMessages({
        idea,
        genre,
        extra,
        previousHtml,
        tweak,
        error,
    });
    const model = els.model.value || CONFIG.codeModel;
    const raw = await chat(messages, { apiKey: state.apiKey, model });
    const html = extractHtml(raw);
    if (!html) throw new Error("The model did not return a game. Try describing it again.");
    const { html: safe, warnings } = sanitizeHtml(html);
    return {
        title: titleOf(html, idea || previousTitle()),
        prompt: idea || previousPrompt(),
        html: safe,
        model,
        createdAt: Date.now(),
        warnings,
    };
}

function previousTitle() {
    return state.current?.title || "Your game";
}

function previousPrompt() {
    return state.current?.prompt || "";
}
/**
 * Loads the hand-written demo game so a visitor can see a finished game
 * before they spend anything. It is not saved to the shelf.
 */
function loadDemo() {
    const { html, warnings } = sanitizeHtml(DEMO_GAME);
    state.current = {
        id: "demo",
        title: "Neon Drift",
        prompt: "The demo game that ships with Gamewright.",
        html,
        cover: "",
        model: "demo",
        createdAt: Date.now(),
        warnings,
        demo: true,
    };
    renderGame(state.current);
    setStatus(
        "This is the demo. Describe a game on the left and a Pollinations model will write it for real.",
    );
}

/** The full build: write the game, then optionally paint and narrate it. */
async function forge(idea, { genre, extra } = {}) {
    if (!needsKey()) return;
    const trimmed = (idea || "").trim();
    if (!trimmed) {
        setStatus("Describe the game you want first.");
        els.prompt.focus();
        return;
    }

    setBusy(true, "Writing your game…");
    setStatus("A model is writing the code, the art and the sound effects…");

    try {
        const game = await writeGame({
            idea: trimmed,
            genre: genre || els.genre.value,
            extra: extra ?? els.extra.value.trim(),
        });

        if (els.optCover.checked) {
            setStatus("The game is ready — painting the cover…");
            try {
                game.cover = await generateCover(coverPrompt(game), {
                    apiKey: state.apiKey,
                });
            } catch (error) {
                toast(error.message);
            }
        }

        if (els.optVoice.checked) {
            setStatus("The game is ready — hiring an announcer…");
            try {
                const blob = await speak(`Welcome to ${game.title}. Let's play!`, {
                    apiKey: state.apiKey,
                });
                els.announce.src = URL.createObjectURL(blob);
                els.announce.play().catch(() => {});
            } catch (error) {
                toast(error.message);
            }
        }

        state.shared = false;
        state.current = game;
        saveGame(game);
        renderGame(game);
        renderLibrary();
        setStatus(`Built "${game.title}". It is yours — share it or change it.`);
    } catch (error) {
        setStatus(error.message, "error");
        toast(error.message);
    } finally {
        setBusy(false);
    }
}

/** A prompt for the cover art: the game's name plus the idea behind it. */
function coverPrompt(game) {
    return [
        "Video game key art, no text, no letters, no logo.",
        `Title reference: ${game.title}.`,
        `The game: ${game.prompt}.`,
        "Bold readable composition, dramatic lighting, single hero subject, arcade poster style.",
    ].join(" ");
}

/** Revises the current game — a tweak from the player, or a repair after a crash. */
async function revise({ tweak, error }) {
    if (!needsKey()) return;
    if (!state.current) return;

    setBusy(true, error ? "Repairing your game…" : "Rewriting your game…");
    setStatus(error ? "The game hit an error, so a model is fixing it…" : "Rewriting your game…");

    try {
        const updated = await writeGame({
            idea: state.current.prompt,
            genre: els.genre.value,
            extra: els.extra.value.trim(),
            previousHtml: state.current.html,
            tweak,
            error,
        });
        updated.cover = state.current.cover || "";
        updated.baseId = state.current.baseId || state.current.id;

        state.current = updated;
        saveGame(updated);
        renderGame(updated);
        renderLibrary();
        setStatus(error ? "Fixed — the game runs again." : `Updated to "${updated.title}".`);
    } catch (reviseError) {
        setStatus(reviseError.message, "error");
        toast(reviseError.message);
    } finally {
        setBusy(false);
    }
}

/* ------------------------------------------------------------------ playing */

/** Puts a game on the stage. */
function renderGame(game) {
    state.current = game;
    state.lastError = null;

    els.gameTitle.textContent = game.title;
    els.gameMeta.hidden = false;
    els.gameMeta.textContent = `${game.model} · ${new Date(game.createdAt).toLocaleDateString()}`;

    if (game.cover) {
        els.cover.src = game.cover;
        els.cover.hidden = false;
    } else {
        els.cover.hidden = true;
        els.cover.removeAttribute("src");
    }

    els.stageEmpty.hidden = true;
    els.gameFrame.hidden = false;
    els.gameFrame.srcdoc = game.html;

    els.stageActions.hidden = false;
    els.fixBtn.hidden = true;
    els.remixForm.hidden = true;
    els.remixInput.value = "";
    document.title = `${game.title} · Gamewright`;
}

/** Called when the game inside the frame throws. */
function onGameError(message) {
    state.lastError = message;
    els.fixBtn.hidden = false;
    setStatus(`The game hit an error: ${message}`, "error");
}

/* ------------------------------------------------------------------ sharing */

async function shareCurrent() {
    if (!state.current) return;
    const payload = encodeGame({
        title: state.current.title,
        prompt: state.current.prompt,
        html: state.current.html,
    });
    const url = buildShareUrl(`${location.origin}${location.pathname}`, payload);
    const copied = await copyText(url);
    toast(copied ? "Share link copied. Send it to a friend." : `Copy this link: ${url}`);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const area = document.createElement("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand("copy");
            area.remove();
            return ok;
        } catch {
            return false;
        }
    }
}

function downloadCurrent() {
    if (!state.current) return;
    const blob = new Blob([state.current.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(state.current.title)}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function slug(text) {
    return (
        (text || "game")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "game"
    );
}

function toggleFullscreen() {
    const stage = els.stage;
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
    }
    stage.requestFullscreen?.().catch(() => toast("Fullscreen was blocked by the browser."));
}

/* ----------------------------------------------------------------- the shelf */

function renderLibrary() {
    const games = listGames();
    els.libraryCount.textContent = games.length ? String(games.length) : "";
    els.library.innerHTML = "";

    if (!games.length) {
        const empty = document.createElement("p");
        empty.className = "library-empty";
        empty.textContent = "Nothing on the shelf yet. Describe a game and it lands here.";
        els.library.appendChild(empty);
        return;
    }

    for (const game of games) {
        const card = document.createElement("article");
        card.className = "card";

        if (game.cover) {
            const image = document.createElement("img");
            image.className = "card-cover";
            image.src = game.cover;
            image.alt = "";
            card.appendChild(image);
        }

        const body = document.createElement("div");
        body.className = "card-body";

        const title = document.createElement("h3");
        title.className = "card-title";
        title.textContent = game.title;
        body.appendChild(title);

        const prompt = document.createElement("p");
        prompt.className = "card-prompt";
        prompt.textContent = game.prompt;
        body.appendChild(prompt);

        const row = document.createElement("div");
        row.className = "card-actions";

        const play = document.createElement("button");
        play.className = "btn ghost small";
        play.type = "button";
        play.textContent = "Play";
        play.addEventListener("click", () => {
            state.shared = false;
            renderGame(game);
            els.stage.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        const share = document.createElement("button");
        share.className = "btn ghost small";
        share.type = "button";
        share.textContent = "Share";
        share.addEventListener("click", () => {
            const payload = encodeGame({
                title: game.title,
                prompt: game.prompt,
                html: game.html,
            });
            const url = buildShareUrl(`${location.origin}${location.pathname}`, payload);
            copyText(url).then((ok) => toast(ok ? "Share link copied." : `Copy this link: ${url}`));
        });

        const remove = document.createElement("button");
        remove.className = "btn ghost small danger";
        remove.type = "button";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => {
            deleteGame(game.id);
            if (state.current?.id === game.id) {
                state.current = null;
                els.gameFrame.hidden = true;
                els.cover.hidden = true;
                els.stageEmpty.hidden = false;
                els.stageActions.hidden = true;
                els.gameTitle.textContent = "Nothing built yet";
                els.gameMeta.hidden = true;
                document.title = "Gamewright — describe a game, get a playable game";
            }
            renderLibrary();
        });

        row.append(play, share, remove);
        body.appendChild(row);
        card.appendChild(body);
        els.library.appendChild(card);
    }
}

/* --------------------------------------------------------------------- init */

function populateSelects() {
    for (const genre of GENRES) {
        const option = document.createElement("option");
        option.value = genre.id;
        option.textContent = genre.label;
        els.genre.appendChild(option);
    }
    for (const model of MODELS) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.label;
        if (model.id === CONFIG.codeModel) option.selected = true;
        els.model.appendChild(option);
    }
}

function bind() {
    els.forgeBtn.addEventListener("click", () => forge(els.prompt.value));
    els.surpriseBtn.addEventListener("click", () => {
        const spark = SPARKS[Math.floor(Math.random() * SPARKS.length)];
        els.prompt.value = spark;
        forge(spark);
    });

    els.shareBtn.addEventListener("click", shareCurrent);
    els.demoBtn.addEventListener("click", loadDemo);
    els.downloadBtn.addEventListener("click", downloadCurrent);
    els.fullscreenBtn.addEventListener("click", toggleFullscreen);

    els.remixBtn.addEventListener("click", () => {
        if (!needsKey()) return;
        els.remixForm.hidden = !els.remixForm.hidden;
        if (!els.remixForm.hidden) els.remixInput.focus();
    });

    els.remixForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const tweak = els.remixInput.value.trim();
        if (!tweak) return;
        els.remixForm.hidden = true;
        revise({ tweak });
    });

    els.fixBtn.addEventListener("click", () => revise({ error: state.lastError }));

    for (const button of document.querySelectorAll("[data-signin]")) {
        button.addEventListener("click", signIn);
    }

    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "game-error" && typeof data.message === "string") {
            onGameError(data.message);
        }
    });
}

function init() {
    Object.assign(els, {
        topbarRight: $("topbar-right"),
        balance: $("balance"),
        signinBtn: $("signin-btn"),
        connectVeil: $("connect-veil"),
        prompt: $("prompt"),
        genre: $("genre"),
        model: $("model"),
        extra: $("extra"),
        forgeBtn: $("forge-btn"),
        surpriseBtn: $("surprise-btn"),
        optCover: $("opt-cover"),
        optVoice: $("opt-voice"),
        status: $("status"),
        stage: $("stage"),
        stageEmpty: $("stage-empty"),
        demoBtn: $("demo-btn"),
        cover: $("cover"),
        gameFrame: $("game-frame"),
        gameTitle: $("game-title"),
        gameMeta: $("game-meta"),
        stageActions: $("stage-actions"),
        shareBtn: $("share-btn"),
        downloadBtn: $("download-btn"),
        fullscreenBtn: $("fullscreen-btn"),
        remixBtn: $("remix-btn"),
        remixForm: $("remix-form"),
        remixInput: $("remix-input"),
        fixBtn: $("fix-btn"),
        library: $("library"),
        libraryCount: $("library-count"),
        busy: $("busy"),
        busyLabel: $("busy-label"),
        toast: $("toast"),
        announce: $("announce"),
    });

    populateSelects();
    bind();

    const key = readStoredKey();
    if (key) adoptKey(key);
    else setConnected(false);

    const shared = readShareFromLocation(location);
    if (shared) {
        state.shared = true;
        renderGame({
            ...shared,
            model: "shared",
            createdAt: Date.now(),
        });
        setStatus("Someone shared this game with you. Press Change it to build your own.");
        els.remixBtn.textContent = "Build your own";
    } else {
        loadDemo();
    }

    renderLibrary();
}

init();
