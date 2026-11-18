/**
 * Gamewright — every model call goes through Pollinations.
 *
 * The visitor connects their own Pollinations account (Pollinations Pay), so
 * requests are billed to their own balance and this app never holds a secret.
 */

const GEN_URL = "https://gen.pollinations.ai";
const ENTER_URL = "https://enter.pollinations.ai";

export const CONFIG = {
    genUrl: GEN_URL,
    enterUrl: ENTER_URL,
    // Publishable App Key (pk_...) from enter.pollinations.ai/keys?tab=app.
    // Empty means the plain Pollinations sign-in link is used instead.
    appKey: "",
    codeModel: "openai/gpt-5.4-mini",
    imageModel: "tongyi-mai/z-image-turbo",
    speechModel: "openai/tts-1",
    speechVoice: "onyx",
    coverWidth: 768,
    coverHeight: 432,
};

/** Turns a failed response into a message a player can act on. */
async function describeError(response, fallback) {
    let detail = "";
    try {
        const body = await response.clone().json();
        detail = body?.error?.message ?? body?.error ?? body?.message ?? body?.detail ?? "";
        if (typeof detail === "object") detail = detail.message ?? "";
    } catch {
        detail = "";
    }
    if (response.status === 402) {
        return "Not enough Pollen on this key. Add more at enter.pollinations.ai.";
    }
    if (response.status === 401) {
        return "That key was refused. Connect your Pollinations account again.";
    }
    if (response.status === 429) {
        return "Pollinations is rate limiting this key. Wait a moment and try again.";
    }
    return detail ? `${fallback}: ${detail}` : fallback;
}

function authHeaders(apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
}

/**
 * The account balance of the connected key, in dollars.
 * Returns null when the endpoint is unavailable or the key has no balance.
 */
export async function fetchBalance(apiKey) {
    try {
        const response = await fetch(`${GEN_URL}/account/balance`, {
            headers: authHeaders(apiKey),
        });
        if (!response.ok) return null;
        const body = await response.json();
        const total = body?.accountBalance?.total ?? body?.balance;
        return typeof total === "number" ? total : null;
    } catch {
        return null;
    }
}

/**
 * Asks a text model a question and returns the answer text.
 */
export async function chat(messages, { apiKey, model, signal, maxTokens = 12000 } = {}) {
    const response = await fetch(`${GEN_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({
            model: model || CONFIG.codeModel,
            messages,
            max_tokens: maxTokens,
        }),
        signal,
    });
    if (!response.ok) {
        throw new Error(await describeError(response, "The model could not be reached."));
    }
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("The model returned an empty answer.");
    return text;
}

/**
 * Draws the cover art for a game and returns a small JPEG data URL.
 *
 * The image model returns a full-size PNG; it is redrawn at a thumbnail size
 * so a shelf full of games still fits in localStorage.
 */
export async function generateCover(prompt, { apiKey, model, signal } = {}) {
    const response = await fetch(`${GEN_URL}/v1/images/generations`, {
        method: "POST",
        headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({
            model: model || CONFIG.imageModel,
            prompt,
            n: 1,
            size: `${CONFIG.coverWidth}x${CONFIG.coverHeight}`,
            response_format: "b64_json",
        }),
        signal,
    });
    if (!response.ok) {
        throw new Error(await describeError(response, "The cover art could not be drawn."));
    }
    const payload = await response.json();
    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) throw new Error("The cover art came back empty.");
    return await shrinkImage(`data:image/png;base64,${b64}`, 480);
}

/** Redraws an image data URL at a smaller size and encodes it as JPEG. */
async function shrinkImage(dataUrl, maxWidth) {
    try {
        const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close?.();
        return canvas.toDataURL("image/jpeg", 0.72);
    } catch {
        return dataUrl;
    }
}

/**
 * Speaks a line and returns the audio as a blob.
 */
export async function speak(text, { apiKey, model, voice, signal } = {}) {
    const response = await fetch(`${GEN_URL}/v1/audio/speech`, {
        method: "POST",
        headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({
            model: model || CONFIG.speechModel,
            input: text,
            voice: voice || CONFIG.speechVoice,
            response_format: "mp3",
        }),
        signal,
    });
    if (!response.ok) {
        throw new Error(await describeError(response, "The voice could not be generated."));
    }
    return await response.blob();
}
