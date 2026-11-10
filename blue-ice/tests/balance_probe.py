# -*- coding: utf-8 -*-
"""
关卡节奏 / 难度曲线诊断：模拟四类玩家画像，用真实游戏逻辑完整跑第一关。
不压缩波间准备期，贴近真人节奏。输出 tests/balance_report.json
"""
import json, os
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
ROOT = os.path.dirname(os.path.abspath(__file__))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

PROFILES = [
    {"name": "高手（每 2s 决策 / 大量合成与部署）", "interval": 2, "mergeMax": 8, "deployMax": 30, "mergeProb": 1.0},
    {"name": "普通玩家（每 5s / 每轮 2 次部署）", "interval": 5, "mergeMax": 4, "deployMax": 2, "mergeProb": 1.0},
    {"name": "新手（每 8s / 每轮 1 次部署 / 半数概率合成）", "interval": 8, "mergeMax": 2, "deployMax": 1, "mergeProb": 0.5},
    {"name": "完全不操作", "interval": 10, "mergeMax": 0, "deployMax": 0, "mergeProb": 0.0},
]

JS = """(p) => {
    const D = window.__ICE_DEBUG__, g = D.game;
    D.start();
    let t = 0;
    const timeline = [];
    let lastWave = 0;
    while (g.phase === 'playing' && t < 480) {
        let k = 0;
        if (Math.random() < p.mergeProb) {
            while (g.findMergePair() && k++ < p.mergeMax) g.autoMerge();
        }
        let n = 0;
        while (g.energy >= g.deployCost() && g.emptyCells().length > 0 && n++ < p.deployMax) g.autoDeploy();
        const steps = Math.round(p.interval * 20);
        for (let i = 0; i < steps && g.phase === 'playing'; i++) {
            g.update(1 / 20);
            if (g.wave !== lastWave) {
                lastWave = g.wave;
                timeline.push({wave: g.wave, at: +(t + i / 20).toFixed(1), link: Math.ceil(g.link),
                               towers: g.towers.length, lvMax: g.towers.reduce((m,x)=>Math.max(m,x.lv),0)});
            }
        }
        t += p.interval;
    }
    const s = D.state();
    return { elapsed: +t.toFixed(1), phase: s.phase, wave: s.wave, link: s.link,
             towers: s.towers, lvMax: s.lvMax, kills: s.stats.kills,
             merges: s.stats.merges, leaked: s.stats.leaked, timeline };
}"""


def main():
    out = {"run_at": datetime.now().astimezone().isoformat(), "profiles": [], "note":
           "真实游戏逻辑逐帧推进，波间准备期保持原时长；结果用于校准第一关难度曲线。"}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, executable_path=CHROME,
                               args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = b.new_page(viewport={"width": 1280, "height": 800})
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("() => window.__ICE_DEBUG__.start()")
        repeat = int(os.environ.get("REPEAT", "2"))
        out["repeat_per_profile"] = repeat
        for p in PROFILES:
            runs = []
            for i in range(repeat):
                r = page.evaluate(JS, p)
                r["run"] = i + 1
                runs.append(r)
                print("[%d/%d] %-38s -> %-5s wave=%2d link=%3d kills=%3d merges=%2d lvMax=%d towers=%2d %ss" % (
                    i + 1, repeat, p["name"], r["phase"], r["wave"], r["link"], r["kills"],
                    r["merges"], r["lvMax"], r["towers"], r["elapsed"]))
            wins = sum(1 for r in runs if r["phase"] == "win")
            out["profiles"].append({
                "name": p["name"], "settings": p, "runs": runs,
                "summary": {
                    "win_rate": round(wins / repeat, 2),
                    "avg_link": round(sum(r["link"] for r in runs) / repeat, 1),
                    "avg_wave": round(sum(r["wave"] for r in runs) / repeat, 1),
                    "avg_merges": round(sum(r["merges"] for r in runs) / repeat, 1),
                    "outcomes": [r["phase"] for r in runs],
                }
            })
        b.close()
    with open(os.path.join(ROOT, "balance_report.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out


if __name__ == "__main__":
    main()
