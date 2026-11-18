/**
 * Gamewright — forge.js
 *
 * Turns a visitor's plain-English idea into a strict prompt for an LLM, and turns
 * the LLM's answer into a safe, self-contained, playable HTML file.
 *
 * Dependency-free ES module. Safe to import in plain Node (no browser APIs are
 * touched at module scope).
 */

export const GENRES = [
    {
        id: "arcade",
        label: "Arcade",
        hint: "Fast, score-driven, one-thumb play. Tight controls, instant restart, a high score to chase.",
    },
    {
        id: "platformer",
        label: "Platformer",
        hint: "Jump, collect, reach the end. Momentum, platforms, hazards that punish bad timing.",
    },
    {
        id: "puzzle",
        label: "Puzzle",
        hint: "Grid or match logic, think before you act. No reflexes required, no brute force.",
    },
    {
        id: "shooter",
        label: "Shooter",
        hint: "Aiming, dodging waves. The player is outnumbered and has to keep moving.",
    },
    {
        id: "endless",
        label: "Endless",
        hint: "One more go, runs forever. Speed and difficulty climb until something ends it.",
    },
    {
        id: "card",
        label: "Card",
        hint: "Cards, dice, luck and numbers. Simple rules, meaningful choices, random outcomes.",
    },
    {
        id: "rhythm",
        label: "Rhythm",
        hint: "Timing to music or beats. Hit on the beat, keep the combo, ride the metronome.",
    },
    {
        id: "sandbox",
        label: "Sandbox",
        hint: "Build, collect, no losing. Free-form play with goals the player sets for themselves.",
    },
    {
        id: "sports",
        label: "Sports",
        hint: "Ball, race, score. Physics you can read at a glance and a skill curve that pays off.",
    },
    {
        id: "horror",
        label: "Horror",
        hint: "Creepy, tense, low light. Limited sight, sound cues, dread over jump scares.",
    },
];

const PREVIOUS_HTML_LIMIT = 24000;

const CSP_CONTENT =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; " +
    "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
    "frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`;

/**
 * The house rules. Every game the model writes has to satisfy these, so they are
 * kept in one place and reused by both the "write it" and the "change it" prompts.
 */
const GAME_RULES = [
    "Make the game fully self-contained in one file: inline <style> and inline <script> only.",
    "Make no external network requests of any kind: no <script src>, no <link href> stylesheet, " +
        "no CDN, no web fonts, no remote images, no audio files, no fetch, no XMLHttpRequest, no <iframe>.",
    "Render the game with an HTML5 <canvas> using the 2D context, sized to fill the viewport.",
    "Drive the game loop with requestAnimationFrame.",
    "Scale the canvas by devicePixelRatio so it stays crisp, and handle window resize.",
    "Make the gameplay actually work: keyboard and/or mouse controls, a visible start state, a running " +
        "state, a score or progress readout, a lose condition (lives) or a win condition, a game-over screen " +
        "with a restart key or button, and difficulty that changes over time.",
    "Draw all art with canvas primitives: rectangles, circles, paths, gradients, text.",
    "Synthesise all sound with the Web Audio API (oscillators and noise buffers) triggered by gameplay; " +
        "never reference an audio file.",
    "Start audio only after the first user interaction, because browsers block autoplay.",
    "Use no localStorage, sessionStorage, document.cookie, indexedDB, window.parent, window.top, import, " +
        "require, or eval of remote content, and never fetch.",
    "Keep the code in a single global scope if you like, but wrap the game code in an IIFE.",
    "Assume the game is embedded in a small iframe: size the canvas from window.innerWidth and " +
        "window.innerHeight, never assume a fixed viewport, never open external links or call window.open, " +
        "and never request fullscreen on the document.",
    "Make the game fun within 5 seconds of the visitor pressing start or an arrow key: no long tutorial, " +
        "no menu wall.",
    "Support touch input as well as keyboard, so it works on a phone.",
    "Aim for roughly 250 to 500 lines of code.",
    "Prefer simple, readable, robust code over cleverness, and make sure the file runs without errors.",
];

const OUTPUT_ONLY = [
    "Output only one complete HTML document: it starts with <!DOCTYPE html> and ends with </html>.",
    "Output no markdown code fences around it.",
    'Write no commentary before or after the code, no explanations, no "here is your game" preamble, ' +
        "no summary of what you built.",
    "The response must contain the HTML document and nothing else.",
];

function bullets(lines) {
    return lines.map((line) => `- ${line}`).join("\n");
}

/* ------------------------------------------------------------------ *
 * Prompt building
 * ------------------------------------------------------------------ */

function genreDetails(genre) {
    if (!genre) {
        return {
            id: "custom",
            label: "Custom",
            hint: "A clear, playable, self-contained game.",
        };
    }
    if (typeof genre === "string") {
        const slug = genre.trim().toLowerCase();
        const found = GENRES.find(
            (g) => g.id.toLowerCase() === slug || g.label.toLowerCase() === slug,
        );
        return found
            ? { id: found.id, label: found.label, hint: found.hint }
            : { id: genre, label: genre, hint: "" };
    }
    return {
        id: genre.id || "custom",
        label: genre.label || genre.id || "Custom",
        hint: genre.hint || "",
    };
}

function systemPrompt(isTweak) {
    const head = isTweak
        ? [
              "You are Gamewright's game generator. You are revising an existing single-file HTML5 browser game.",
              "",
              "OUTPUT CONTRACT",
              bullets([
                  "Output the COMPLETE updated HTML document: it starts with <!DOCTYPE html> and ends with </html>.",
                  "Output the whole file every time - not a diff, not a patch, never only the changed lines " +
                      "or a snippet.",
                  "Keep every part that already worked: the unchanged code, styling, layout and behaviour must " +
                      "still be present in the file you return.",
                  "Output no markdown code fences around it, and write no commentary before or after the code.",
                  "Apply only the requested change, plus whatever is needed to repair the reported error; leave the " +
                      "rest of the game untouched.",
                  "If the previous HTML in this conversation is truncated, still return the complete file: recreate " +
                      "the missing part instead of stopping short.",
                  "If the reported error cannot be fixed cleanly, simplify the code that causes it rather than " +
                      "leaving the game broken.",
              ]),
          ]
        : [
              "You are Gamewright's game generator. You turn a visitor's plain-English idea into a complete, " +
                  "self-contained, single-file HTML5 browser game.",
              "",
              "OUTPUT CONTRACT",
              bullets(OUTPUT_ONLY),
          ];

    return [...head, "", "THE RULES", bullets(GAME_RULES)].join("\n");
}

export function buildMessages({ idea, genre, extra, previousHtml, tweak, error } = {}) {
    const details = genreDetails(genre);
    const isTweak = Boolean(tweak) || Boolean(previousHtml);
    const messages = [{ role: "system", content: systemPrompt(isTweak) }];

    if (isTweak) {
        const parts = [];
        if (idea) parts.push(`ORIGINAL GAME IDEA:\n${String(idea).trim()}`);
        parts.push(`CHANGE THE VISITOR ASKED FOR:\n${String(tweak || "").trim()}`);

        const rawPrevious = typeof previousHtml === "string" ? previousHtml : "";
        if (rawPrevious) {
            const truncated = rawPrevious.length > PREVIOUS_HTML_LIMIT;
            const body = truncated ? rawPrevious.slice(0, PREVIOUS_HTML_LIMIT) : rawPrevious;
            parts.push(
                "THE PREVIOUS GAME HTML - you must return this file complete, with the change applied:\n" +
                    "<<<BEGIN_HTML\n" +
                    body +
                    "\nEND_HTML>>>",
            );
            if (truncated) {
                parts.push(
                    `NOTE: the previous HTML was truncated from ${rawPrevious.length} characters to the first ` +
                        `${PREVIOUS_HTML_LIMIT}. Return the COMPLETE file anyway - rebuild the missing part in the same ` +
                        "style as the part you can see.",
                );
            }
        }

        if (error) {
            parts.push(
                `ERROR REPORTED BY THE RUNTIME (fix this if it still applies):\n${String(error).trim()}`,
            );
        }

        parts.push(
            "Reply with the complete updated HTML document and nothing else - code only, no code fences, " +
                "no commentary.",
        );
        messages.push({ role: "user", content: parts.join("\n\n") });
        return messages;
    }

    const parts = [];
    parts.push(`GAME IDEA:\n${String(idea || "").trim()}`);
    parts.push(
        `SELECTED GENRE:\nid: ${details.id}\nlabel: ${details.label}\nfeel: ${details.hint}`,
    );
    if (extra && String(extra).trim()) {
        parts.push(`EXTRA NOTES FROM THE VISITOR:\n${String(extra).trim()}`);
    }
    parts.push(
        "Write the game now. Reply with the complete HTML document and nothing else - code only, no code " +
            "fences, no commentary.",
    );
    messages.push({ role: "user", content: parts.join("\n\n") });
    return messages;
}

/* ------------------------------------------------------------------ *
 * Pulling HTML out of the model's answer
 * ------------------------------------------------------------------ */

function findDocumentSlices(text) {
    const lower = text.toLowerCase();
    const starts = [];
    const push = (needle) => {
        let at = lower.indexOf(needle);
        while (at !== -1) {
            starts.push(at);
            at = lower.indexOf(needle, at + 1);
        }
    };
    push("<!doctype html");
    push("<html");

    const ends = [];
    let end = lower.lastIndexOf("</html>");
    while (end !== -1) {
        ends.push(end + 7);
        end = lower.lastIndexOf("</html>", end - 1);
    }
    if (!ends.length) return [];

    const slices = [];
    for (const start of starts) {
        for (const stop of ends) {
            if (stop > start) {
                slices.push(text.slice(start, stop));
                break;
            }
        }
    }
    return slices;
}

function findFencedBlocks(text) {
    const blocks = [];
    const re = /```[ \t]*([A-Za-z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g;
    let match = re.exec(text);
    while (match !== null) {
        const body = match[2];
        if (body?.trim()) blocks.push(body.trim());
        if (match.index === re.lastIndex) re.lastIndex += 1;
        match = re.exec(text);
    }
    return blocks;
}

export function extractHtml(raw) {
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    if (!text) return null;

    const documents = findDocumentSlices(text);
    if (documents.length) {
        return documents.reduce((best, current) => (current.length > best.length ? current : best));
    }

    const fenced = findFencedBlocks(text);
    if (fenced.length) {
        return fenced.reduce((best, current) => (current.length > best.length ? current : best));
    }

    if (/<script[\s>]/i.test(text) || /<canvas[\s>]/i.test(text)) return text;
    return null;
}

/* ------------------------------------------------------------------ *
 * Sanitising
 * ------------------------------------------------------------------ */

const REMOTE_HINT =
    /(https?:)?\/\/|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon|window\.open|window\.location|\blocation\s*\./i;

const BLOCKED_APIS = [
    {
        name: "fetch(",
        pattern: /(?<![.\w$])fetch\s*\(/g,
        replacement: "window.__gwBlockedFetch(",
    },
    {
        name: "XMLHttpRequest",
        pattern: /(?<![.\w$])XMLHttpRequest\b/g,
        replacement: "window.__gwBlockedXMLHttpRequest",
    },
    {
        name: "WebSocket(",
        pattern: /(?<![.\w$])WebSocket\s*\(/g,
        replacement: "window.__gwBlockedWebSocket(",
    },
    {
        name: "EventSource(",
        pattern: /(?<![.\w$])EventSource\s*\(/g,
        replacement: "window.__gwBlockedEventSource(",
    },
    {
        name: "import(",
        pattern: /(?<![.\w$])import\s*\(/g,
        replacement: "window.__gwBlockedImport(",
    },
    {
        name: "eval(",
        pattern: /(?<![.\w$])eval\s*\(/g,
        replacement: "window.__gwBlockedEval(",
    },
];

function stripMarkdownFences(input) {
    const wrapped = input.match(
        /^\s*```[ \t]*[A-Za-z0-9_+#.-]*[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```\s*$/,
    );
    const text = wrapped ? wrapped[1] : input;

    const out = [];
    let inScript = false;
    let inStyle = false;
    for (const line of text.split("\n")) {
        const lower = line.toLowerCase();
        if (inScript) {
            if (lower.includes("</script")) inScript = false;
            out.push(line);
            continue;
        }
        if (inStyle) {
            if (lower.includes("</style")) inStyle = false;
            out.push(line);
            continue;
        }
        if (/^\s*```[A-Za-z0-9_+#.-]*\s*$/.test(line)) continue;
        if (lower.includes("<script") && !lower.includes("</script")) inScript = true;
        if (lower.includes("<style") && !lower.includes("</style")) inStyle = true;
        out.push(line);
    }
    return out.join("\n");
}

function mapScriptBlocks(doc, transform) {
    return doc.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, code) => {
        if (/\bsrc\s*=/i.test(attrs)) return match;
        return `<script${attrs}>${transform(code)}</script>`;
    });
}

function stripExternalMarkup(doc, warnings) {
    let out = doc;

    out = out.replace(/<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?<\/script>/gi, () => {
        warnings.push("Removed an external <script src> tag.");
        return "";
    });
    out = out.replace(/<script\b[^>]*\bsrc\s*=[^>]*\/?>/gi, () => {
        warnings.push("Removed an external <script src> tag.");
        return "";
    });

    out = out.replace(/<link\b[^>]*>/gi, (tag) => {
        const href = (tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1);
        const value = (href[1] || href[0] || "").trim();
        if (/^data:/i.test(value)) return tag;
        warnings.push("Removed an external stylesheet or <link> tag.");
        return "";
    });

    out = out.replace(/<img\b[^>]*>/gi, (tag) => {
        const src = (tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1);
        const value = (src[1] || src[0] || "").trim();
        if (/^data:/i.test(value)) return tag;
        warnings.push("Removed an <img> that pointed at an external image.");
        return "";
    });

    out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, () => {
        warnings.push("Removed an <iframe> tag.");
        return "";
    });
    out = out.replace(/<iframe\b[^>]*\/?>/gi, () => {
        warnings.push("Removed an <iframe> tag.");
        return "";
    });
    out = out.replace(/<object\b[\s\S]*?<\/object>/gi, () => {
        warnings.push("Removed an <object> tag.");
        return "";
    });
    out = out.replace(/<object\b[^>]*\/?>/gi, () => {
        warnings.push("Removed an <object> tag.");
        return "";
    });
    out = out.replace(/<embed\b[^>]*>/gi, () => {
        warnings.push("Removed an <embed> tag.");
        return "";
    });
    out = out.replace(/<base\b[^>]*>/gi, () => {
        warnings.push("Removed a <base> tag.");
        return "";
    });
    out = out.replace(
        /<meta\b[^>]*http-equiv\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
        (tag) => {
            const value = (
                tag.match(/http-equiv\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || []
            ).slice(1);
            const raw = (value[1] || value[0] || "").trim();
            if (raw.toLowerCase() === "refresh") {
                warnings.push('Removed a <meta http-equiv="refresh"> redirect.');
                return "";
            }
            return tag;
        },
    );

    out = out.replace(/\s+on[a-z]+\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi, (attribute) => {
        const value = attribute
            .replace(/^[^=]*=\s*/, "")
            .replace(/^["']/, "")
            .replace(/["']$/, "");
        if (REMOTE_HINT.test(value)) {
            warnings.push("Removed an inline event handler that tried to reach the network.");
            return "";
        }
        return attribute;
    });

    return out;
}

function blockNetworkCalls(doc, warnings) {
    const seen = new Set();
    const out = mapScriptBlocks(doc, (code) => {
        let result = code;
        for (const api of BLOCKED_APIS) {
            api.pattern.lastIndex = 0;
            if (!api.pattern.test(result)) continue;
            api.pattern.lastIndex = 0;
            result = result.replace(api.pattern, api.replacement);
            if (!seen.has(api.name)) {
                seen.add(api.name);
                warnings.push(`Blocked a network call to ${api.name}.`);
            }
        }
        result = result.replace(
            /^[ \t]*import\s+[^;\n]+?\s+from\s+["'][^"']+["']\s*;?[ \t]*$/gm,
            "",
        );
        result = result.replace(/^[ \t]*import\s+["'][^"']+["']\s*;?[ \t]*$/gm, "");
        return result;
    });
    return out;
}

function ensureDocument(doc) {
    let out = doc;
    if (!/<html\b/i.test(out)) {
        const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(out);
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(out);
        const headInner = headMatch ? headMatch[1] : "";
        let bodyInner = "";
        if (bodyMatch) {
            bodyInner = bodyMatch[1];
        } else if (headMatch) {
            bodyInner = out.replace(headMatch[0], "");
        } else {
            bodyInner = out;
        }
        out =
            '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
            headInner +
            "\n</head>\n<body>\n" +
            bodyInner +
            "\n</body>\n</html>";
        return out;
    }

    if (!/<head\b/i.test(out)) {
        const open = /<html\b[^>]*>/i.exec(out);
        const at = open.index + open[0].length;
        out = `${out.slice(0, at)}\n<head>\n</head>${out.slice(at)}`;
    }
    if (!/<body\b/i.test(out)) {
        const close = /<\/html\s*>/i.exec(out);
        if (close) out = `${out.slice(0, close.index)}<body></body>${out.slice(close.index)}`;
    }
    return out;
}

function insertIntoHead(doc, snippet) {
    const open = /<head\b[^>]*>/i.exec(doc);
    if (!open) {
        const body = /<body\b[^>]*>/i.exec(doc);
        if (body) {
            const at = body.index + body[0].length;
            return `${doc.slice(0, at)}\n${snippet}${doc.slice(at)}`;
        }
        return `${snippet}\n${doc}`;
    }
    const at = open.index + open[0].length;
    return `${doc.slice(0, at)}\n${snippet}${doc.slice(at)}`;
}

/**
 * Rebuild the head so the metadata is always in a known, safe order:
 * charset first (it has to land in the first 1024 bytes), then the viewport,
 * then the CSP. Any charset/viewport/CSP the model wrote is dropped first so
 * exactly one of each survives.
 */
function rebuildHeadMeta(doc) {
    const head = /(<head\b[^>]*>)([\s\S]*?)(<\/head\s*>)/i.exec(doc);
    if (!head) return insertIntoHead(doc, CSP_META);

    let inner = head[2];
    inner = inner.replace(/<meta\b[^>]*charset\s*=[^>]*>/gi, "");
    inner = inner.replace(/<meta\b[^>]*name\s*=\s*["']?viewport["']?[^>]*>/gi, "");
    inner = inner.replace(
        /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
        "",
    );

    const prefix =
        '<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        `${CSP_META}\n`;

    const at = head.index + head[1].length;
    const closeAt = head.index + head[1].length + head[2].length;
    return `${doc.slice(0, at)}\n${prefix}${inner}${doc.slice(closeAt)}`;
}

export function sanitizeHtml(html) {
    const warnings = [];
    let doc = typeof html === "string" ? html : "";

    doc = stripMarkdownFences(doc);
    doc = stripExternalMarkup(doc, warnings);
    doc = blockNetworkCalls(doc, warnings);
    doc = ensureDocument(doc);

    // A game needs code to run: without a script there is nothing to play.
    if (!/<script\b/i.test(doc)) {
        warnings.push("The model did not return a playable game (no script found).");
        return { html: "", warnings };
    }

    doc = rebuildHeadMeta(doc);
    doc = withBootstrap(doc);

    return { html: doc, warnings };
}

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

const BOOTSTRAP_MARKER = "gamewright-bootstrap";

const BOOTSTRAP_SCRIPT = `<script>/*gamewright-bootstrap*/
(function(){
  var LIMIT = 300;
  var ready = false;

  function toText(value){
    try{
      if(value && typeof value.stack === 'string') return String(value.stack).slice(0, LIMIT);
    }catch(e){}
    try{ return String(value === undefined ? '' : value).slice(0, LIMIT); }
    catch(e){ return 'Unknown error'; }
  }

  function send(message){
    try{
      if(!window.parent || window.parent === window) return;
      window.parent.postMessage(message, '*');
    }catch(e){}
  }

  window.addEventListener('error', function(event){
    var detail = event && (event.message || event.error);
    send({ type: 'game-error', message: toText(detail) });
  });

  window.addEventListener('unhandledrejection', function(event){
    var reason = event && event.reason;
    send({
      type: 'game-error',
      message: toText(reason && reason.message ? reason.message : reason)
    });
  });

  try{
    var nativeLog = console.log;
    var nativeWarn = console.warn;
    var nativeError = console.error;
    function join(args){
      try{
        return Array.prototype.map.call(args, function(item){
          return typeof item === 'string' ? item : toText(item);
        }).join(' ');
      }catch(e){ return toText(args[0]); }
    }
    console.log = function(){
      send({ type: 'game-log', level: 'log', message: join(arguments) });
      try{ nativeLog.apply(console, arguments); }catch(e){}
    };
    console.warn = function(){
      send({ type: 'game-log', level: 'warn', message: join(arguments) });
      try{ nativeWarn.apply(console, arguments); }catch(e){}
    };
    console.error = function(){
      send({ type: 'game-error', message: join(arguments) });
      try{ nativeError.apply(console, arguments); }catch(e){}
    };
  }catch(e){}

  function blocked(name){
    return function(){ throw new Error('network disabled: ' + name + ' was blocked by Gamewright'); };
  }
  try{
    window.__gwBlockedFetch = function(){
      return Promise.reject(new Error('network disabled: fetch was blocked by Gamewright'));
    };
    window.__gwBlockedXMLHttpRequest = blocked('XMLHttpRequest');
    window.__gwBlockedWebSocket = blocked('WebSocket');
    window.__gwBlockedEventSource = blocked('EventSource');
    window.__gwBlockedImport = blocked('import');
    window.__gwBlockedEval = blocked('eval');
    window.fetch = window.__gwBlockedFetch;
    window.XMLHttpRequest = window.__gwBlockedXMLHttpRequest;
    window.WebSocket = window.__gwBlockedWebSocket;
    window.EventSource = window.__gwBlockedEventSource;
  }catch(e){}

  function announce(){
    if(ready) return;
    ready = true;
    send({ type: 'game-ready' });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', announce);
  } else {
    announce();
  }

  window.addEventListener('load', function(){ send({ type: 'game-ready' }); });

  window.setTimeout(function(){
    if(!ready) send({ type: 'game-error', message: 'The game did not finish loading.' });
  }, 4000);
})();
</script>`;

export function withBootstrap(html) {
    const doc = typeof html === "string" ? html : "";
    if (doc.includes(BOOTSTRAP_MARKER)) return doc;

    const csp = /<meta\b[^>]*http-equiv\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)[^>]*>/gi;
    let match = csp.exec(doc);
    while (match !== null) {
        const value = (
            match[0].match(/http-equiv\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || []
        ).slice(1);
        const raw = (value[1] || value[0] || "").trim().toLowerCase();
        if (raw === "content-security-policy") {
            const at = match.index + match[0].length;
            return `${doc.slice(0, at)}\n${BOOTSTRAP_SCRIPT}${doc.slice(at)}`;
        }
        match = csp.exec(doc);
    }

    const head = /<head\b[^>]*>/i.exec(doc);
    if (head) {
        const at = head.index + head[0].length;
        return `${doc.slice(0, at)}\n${BOOTSTRAP_SCRIPT}${doc.slice(at)}`;
    }

    const body = /<body\b[^>]*>/i.exec(doc);
    if (body) {
        const at = body.index + body[0].length;
        return `${doc.slice(0, at)}\n${BOOTSTRAP_SCRIPT}${doc.slice(at)}`;
    }

    return `${BOOTSTRAP_SCRIPT}\n${doc}`;
}

/* ------------------------------------------------------------------ *
 * Titles and log summaries
 * ------------------------------------------------------------------ */

const LEADING_FILLERS = [
    /^(please|kindly)\s+/i,
    /^(can|could|would)\s+you\s+/i,
    /^(i\s+(want|need|would\s+like|'?d\s+like|am\s+looking\s+for)\s+)/i,
    /^(make|create|build|design|write|craft|code|generate|produce|develop|give)\s+(me|us)\s+/i,
    /^(make|create|build|design|write|craft|code|generate|produce|develop)\s+/i,
    /^(a|an|the|some)\s+/i,
    /^(simple|small|fun|cool|great|addictive|quick|basic|crazy|awesome|mini)\s+/i,
    /^(game|app|thing)\s+(where|that|about|in|with|for|on|of|to|featuring|involving)\s+/i,
    /^(game|app|thing)\s+/i,
    /^(based\s+on|inspired\s+by|similar\s+to|like)\s+/i,
    /^(that\s+(is|lets?\s+you|allows?\s+you|lets\s+you)\s+)/i,
    /^(you\s+can|where\s+you|where\s+players?|in\s+which|players?\s+can)\s+/i,
];

const LEADING_STOPWORDS =
    /^(you|your|yours|we|us|they|them|their|player|players|the|a|an|of|about|with|in|on|at|to|for|from|that|this|these|those|it|its|is|are|was|were|be|been|and|or|but|so|then|my|me|i|as|by|where)\s+/i;

const TRAILING_STOPWORDS =
    /\s+(a|an|the|and|or|with|in|on|at|to|for|from|of|that|this|these|those|is|are|was|were|be|been|my|your|it|its|but|so|then|as|by|about|where|when|while|if|than|me|i|you|we|they|player|players|game)$/i;

// Filler that carries no meaning anywhere in a title, not just at the edges.
const WEAK_WORDS = new Set([
    "with",
    "game",
    "games",
    "play",
    "plays",
    "playing",
    "about",
    "involving",
    "featuring",
    "please",
    "just",
    "really",
    "very",
    "some",
    "any",
    "all",
    "stuff",
    "thing",
    "things",
    "app",
    "application",
    "style",
    "kind",
    "sort",
]);

function titleCaseWord(word) {
    if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function titleFromIdea(idea) {
    if (typeof idea !== "string") return "Untitled Game";
    let text = idea.trim().replace(/\s+/g, " ");
    if (!text) return "Untitled Game";

    for (let pass = 0; pass < 12; pass += 1) {
        const before = text;
        for (const pattern of LEADING_FILLERS) {
            text = text.replace(pattern, "");
        }
        text = text.replace(/^\s+|\s+$/g, "");
        if (text === before) break;
    }

    text = text.replace(/\s+(about|involving|featuring)\s+/gi, " ");
    text = text.replace(/[,;:!?]+$/, "").trim();
    if (!text) return "Untitled Game";

    let words = text.split(/\s+/).filter(Boolean);
    const lean = words.filter((word) => !WEAK_WORDS.has(word.toLowerCase()));
    if (lean.length) words = lean;
    while (words.length && LEADING_STOPWORDS.test(`${words[0]} `)) words = words.slice(1);
    while (words.length && TRAILING_STOPWORDS.test(` ${words[words.length - 1]}`))
        words = words.slice(0, -1);
    while (words.length && LEADING_STOPWORDS.test(`${words[0]} `)) words = words.slice(1);

    if (!words.length) return "Untitled Game";

    words = words.slice(0, 5);
    return words.map(titleCaseWord).join(" ");
}

function byteLength(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
    return text.length;
}

export function summariseForLog(html) {
    const source = typeof html === "string" ? html : "";
    return {
        bytes: byteLength(source),
        lines: source ? source.split("\n").length : 0,
        hasCanvas: /<canvas[\s>]/i.test(source),
        hasAudio: /AudioContext/.test(source),
        hasLoop: /requestAnimationFrame/.test(source),
    };
}
