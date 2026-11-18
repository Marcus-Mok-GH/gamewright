"""End-to-end test for the Gamewright app against a mocked Pollinations gateway."""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8124/test/mock.html"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + ("  [" + str(detail) + "]" if detail else ""))


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            permissions=["clipboard-read", "clipboard-write"],
        )
        page = context.new_page()
        page.goto(BASE)
        page.wait_for_timeout(500)

        check("mock key is picked up", page.locator("#signin-btn").inner_text().strip() == "Sign out",
              page.locator("#signin-btn").inner_text())
        check("balance chip shows", "POLLEN" in page.locator("#balance").inner_text().upper(),
              page.locator("#balance").inner_text())
        check("veil hidden when connected", page.locator("#connect-veil").is_hidden())

        page.fill("#prompt", "a duck dodges falling pizza")
        page.click("#forge-btn")
        page.wait_for_timeout(1500)

        check("title is set", page.locator("#game-title").inner_text() == "Mock Dodge",
              page.locator("#game-title").inner_text())
        check("stage empties out", page.locator("#stage-empty").is_hidden())
        check("cover art generated", page.locator("#cover").get_attribute("src").startswith("data:image/jpeg"),
              page.locator("#cover").get_attribute("src")[:24])

        frame = page.frame_locator("#game-frame")
        canvas = frame.locator("canvas")
        check("game canvas exists", canvas.count() == 1)
        painted = frame.locator("body").evaluate(
            """() => {
                const c = document.querySelector('canvas');
                if (!c) return 'no canvas';
                const ctx = c.getContext('2d');
                const d = ctx.getImageData(0, 0, c.width, c.height).data;
                let lit = 0;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] + d[i + 1] + d[i + 2] > 40) lit += 1;
                }
                return lit;
            }"""
        )
        check("game actually paints pixels", isinstance(painted, int) and painted > 100, painted)

        page.click("#share-btn")
        page.wait_for_timeout(400)
        share = page.evaluate("() => navigator.clipboard.readText()")
        check("share link copied", share.startswith("http") and "#g=" in share, share[:60])
        decoded = page.evaluate(
            """async (url) => {
                const mod = await import('/share.js');
                const payload = url.split('#g=')[1];
                const game = mod.decodeGame(payload);
                return game ? game.title : '';
            }""",
            share,
        )
        check("share link carries the title", decoded == "Mock Dodge", decoded)

        # A fresh context opens the shared link: the game must load with no key at all.
        context2 = browser.new_context(viewport={"width": 1280, "height": 900})
        page2 = context2.new_page()
        page2.goto(share)
        page2.wait_for_timeout(800)
        check("shared game loads", page2.locator("#game-title").inner_text() == "Mock Dodge",
              page2.locator("#game-title").inner_text())
        check("shared game is framed", page2.locator("#game-frame").is_visible())
        check("shared status message", "shared" in page2.locator("#status").inner_text().lower(),
              page2.locator("#status").inner_text())
        check("shared game is not in the shelf", page2.locator("#library-count").inner_text().strip() in ("0", ""),
              page2.locator("#library-count").inner_text())
        check("shared game has no cover", page2.locator("#cover").is_hidden())
        page2.screenshot(path="/tmp/gw-shared.png")

        # Change it: the mock returns the same game, so the title stays the same.
        page2.click("#remix-btn")
        page2.fill("#remix-input", "make the pizza bigger")
        page2.click("#remix-send")
        page2.wait_for_timeout(1500)
        check("remix updates the game", "Updated" in page2.locator("#status").inner_text(),
              page2.locator("#status").inner_text())
        check("remixed game is saved to the shelf",
              page2.locator("#library-count").inner_text().strip() == "1",
              page2.locator("#library-count").inner_text())

        # A broken game must be reported and repairable.
        page.fill("#prompt", "BROKEN")
        page.click("#forge-btn")
        page.wait_for_timeout(1500)
        status = page.locator("#status").inner_text()
        check("broken game is reported", "error" in status.lower(), status)
        check("fix button appears", page.locator("#fix-btn").is_visible())
        page.click("#fix-btn")
        page.wait_for_timeout(1500)
        check("repair runs", page.locator("#status").inner_text() != status,
              page.locator("#status").inner_text())

        # Download the game as a file.
        with page.expect_download() as info:
            page.click("#download-btn")
        download = info.value
        check("game downloads as html", download.suggested_filename.endswith(".html"),
              download.suggested_filename)

        # Mobile layout must not overlap the topbar.
        mobile = browser.new_context(viewport={"width": 390, "height": 844})
        mpage = mobile.new_page()
        mpage.goto(BASE)
        mpage.wait_for_timeout(500)
        box_brand = mpage.locator(".brand").bounding_box()
        box_right = mpage.locator("#topbar-right").bounding_box()
        overlap = not (
            box_brand["y"] + box_brand["height"] <= box_right["y"]
            or box_right["y"] + box_right["height"] <= box_brand["y"]
            or box_brand["x"] + box_brand["width"] <= box_right["x"]
            or box_right["x"] + box_right["width"] <= box_brand["x"]
        )
        check("mobile topbar does not overlap", not overlap,
              f"brand={box_brand} right={box_right}")
        mpage.screenshot(path="/tmp/gw-mobile.png")

        # Desktop screenshot with a game on stage.
        page.fill("#prompt", "a duck dodges falling pizza")
        page.click("#forge-btn")
        page.wait_for_timeout(1500)
        page.screenshot(path="/tmp/gw-desktop.png")

        # A first-time visitor (no key) must land on the demo game, with an
        # inline connect card instead of a blocking overlay.
        guest = browser.new_context(viewport={"width": 1280, "height": 900})
        gpage = guest.new_page()
        gpage.goto(BASE + "?nokey")
        gpage.wait_for_timeout(900)
        check("demo game loads for a guest", gpage.locator("#game-title").inner_text() == "Neon Drift",
              gpage.locator("#game-title").inner_text())
        check("demo canvas is painted", gpage.frame_locator("#game-frame").locator("canvas").count() == 1)
        check("connect card is visible to a guest", gpage.locator("#connect-veil").is_visible())
        veil_box = gpage.locator("#connect-veil").bounding_box()
        panel_box = gpage.locator(".panel").first.bounding_box()
        check("connect card sits inside the panel", veil_box["y"] >= panel_box["y"],
              f"card={veil_box} panel={panel_box}")
        gpage.screenshot(path="/tmp/gw-guest.png")
        guest.close()

        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())
