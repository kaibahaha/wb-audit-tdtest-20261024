# -*- coding: utf-8 -*-
"""第二版取证：BOSS 穿透瞬间、结算面板对比度、受损血条中间态。"""
import os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
ROOT = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(ROOT, "screenshots")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, executable_path=CHROME,
                               args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = b.new_page(viewport={"width": 1440, "height": 860})
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(600)

        # --- BOSS 穿透瞬间：无防守，等幽灵走到链路 ---
        page.evaluate("""() => {
            const D = window.__ICE_DEBUG__, g = D.game;
            D.seed(7); D.start();
            g.d.tutorial.classList.add('hidden');
            g.energy = 0; g.towers.length = 0;
            g.waveState = 'running'; g.spawnQueue.length = 0; g.prepTimer = 1e9;
            g.spawnEnemy('ghost');
            let t = 0;
            while (g.phase === 'playing' && t < 90 && g.stats.bossPasses === 0) { g.update(1/20); t += 1/20; }
            for (let i = 0; i < 6; i++) g.update(1/20);   // 留几帧让特效展开
        }""")
        page.wait_for_timeout(120)
        page.screenshot(path=os.path.join(SHOT, "20_boss_penetration.png"))
        st = page.evaluate("() => window.__ICE_DEBUG__.state()")
        print("penetration:", st["link"], st["stats"]["bossPasses"], st["boss"])

        # --- 受损血条中间态：跑一局到第 11 波 ---
        page.evaluate("""() => {
            const D = window.__ICE_DEBUG__, g = D.game;
            D.seed(37); D.start();
            let t = 0;
            while (g.phase === 'playing' && g.wave < 12 && t < 400) {
                let k = 0;
                while (g.findMergePair() && k++ < 4) g.autoMerge();
                while (g.energy >= g.deployCost() && g.emptyCells().length > 0 && k++ < 2) g.autoDeploy();
                g.update(1/20); t += 1/20;
            }
        }""")
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(SHOT, "21_mid_damage_hud.png"))
        st = page.evaluate("() => window.__ICE_DEBUG__.state()")
        print("mid:", "wave", st["wave"], "link", st["link"])

        # --- 失败结算（第 12 波被幽灵抽干）---
        page.evaluate("""() => {
            const D = window.__ICE_DEBUG__, g = D.game;
            D.seed(37); D.start();
            let t = 0, slot = -1;
            while (g.phase === 'playing' && t < 420) {
                if (Math.floor(t / 5) !== slot) {
                    slot = Math.floor(t / 5);
                    let k = 0, n = 0;
                    while (g.findMergePair() && k++ < 4) g.autoMerge();
                    while (g.energy >= g.deployCost() && g.emptyCells().length > 0 && n++ < 2) g.autoDeploy();
                }
                g.update(1/20); t += 1/20;
            }
        }""")
        page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(SHOT, "22_defeat_boss.png"))
        st = page.evaluate("() => window.__ICE_DEBUG__.state()")
        print("defeat:", st["phase"], "wave", st["wave"], "link", st["link"],
              "passes", st["stats"]["bossPasses"])
        print("resDesc:", page.locator("#resDesc").inner_text()[:160])

        # --- 胜利结算 ---
        page.evaluate("""() => {
            const D = window.__ICE_DEBUG__, g = D.game;
            D.seed(83); D.start();
            let t = 0, slot = -1;
            while (g.phase === 'playing' && t < 420) {
                if (Math.floor(t / 5) !== slot) {
                    slot = Math.floor(t / 5);
                    let k = 0, n = 0;
                    while (g.findMergePair() && k++ < 4) g.autoMerge();
                    while (g.energy >= g.deployCost() && g.emptyCells().length > 0 && n++ < 2) g.autoDeploy();
                }
                g.update(1/20); t += 1/20;
            }
        }""")
        page.wait_for_timeout(2400)
        page.screenshot(path=os.path.join(SHOT, "23_victory_panel.png"))
        st = page.evaluate("() => window.__ICE_DEBUG__.state()")
        print("victory:", st["phase"], "link", st["link"])
        print("resDesc:", page.locator("#resDesc").inner_text()[:160])
        b.close()


if __name__ == "__main__":
    main()
