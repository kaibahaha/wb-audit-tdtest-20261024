# -*- coding: utf-8 -*-
"""
难度曲线诊断（固定随机种子）。
同一批种子下分别运行，用 waveTrace 记录每一波的：
  deepest = 本波干扰最深穿透到路径全长的百分比（1.0 = 抵达数据链路）
  leaks   = 本波漏怪数
  dmg     = 本波链路损失
用来判断「压力是否真实存在」，而不只是看最后胜负。

用法： python tests/diagnose_curve.py <label>
输出： tests/curve_<label>.json
"""
import json, os, sys
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
ROOT = os.path.dirname(os.path.abspath(__file__))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

PROFILES = [
    {"key": "expert", "name": "高手（每 2s 决策 / 大量合成与部署）", "interval": 2, "mergeMax": 8, "deployMax": 30, "mergeProb": 1.0},
    {"key": "normal", "name": "普通玩家（每 5s / 每轮 2 次部署）", "interval": 5, "mergeMax": 4, "deployMax": 2, "mergeProb": 1.0},
    {"key": "novice", "name": "新手（每 8s / 每轮 1 次部署 / 半数概率合成）", "interval": 8, "mergeMax": 2, "deployMax": 1, "mergeProb": 0.5},
    {"key": "sloppy", "name": "随手布阵（位置随机 / 仍会合成升级）", "interval": 5, "mergeMax": 3, "deployMax": 2, "mergeProb": 1.0, "randomPlace": True},
    {"key": "idle", "name": "完全不操作", "interval": 10, "mergeMax": 0, "deployMax": 0, "mergeProb": 0.0},
]
SEEDS = [11, 23, 37, 41, 53, 67, 79, 83, 97, 101]
# 快速调参模式：只跑三个有代表性的画像、四个种子
if os.environ.get("QUICK") == "1":
    SEEDS = [11, 37, 67, 97]

JS = """(p) => {
    const D = window.__ICE_DEBUG__, g = D.game;
    D.seed(p.seed);
    D.start();
    // 探针自身也用固定序列，保证「同一策略在同一局面」可复现
    let rs = (p.seed * 2654435761) >>> 0;
    const mr = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
    let t = 0;
    const bossSamples = [];
    while (g.phase === 'playing' && t < 900) {
        if (p.mergeProb > 0 && mr() < p.mergeProb) {
            let k = 0;
            if (p.balancedMerge) {
                while (k++ < p.mergeMax) {
                    const pair = g.findMergePair();
                    if (!pair) break;
                    // 均衡型玩家：装置太少时不再把 Lv.1 合掉，先保住覆盖面积
                    if (g.towers.length <= 10 && pair[0].lv === 1) break;
                    g.merge(pair[0], pair[1]);
                }
            } else {
                while (g.findMergePair() && k++ < p.mergeMax) g.autoMerge();
            }
        }
        let n = 0;
        while (g.energy >= g.deployCost() && g.emptyCells().length > 0 && n++ < p.deployMax) {
            if (p.randomPlace) {
                const cells = g.emptyCells();
                const q = cells[Math.floor(mr() * cells.length)];
                if (!q || !g.deployAt(q.c, q.r)) break;
            } else g.autoDeploy();
        }
        const steps = Math.round(p.interval * 20);
        for (let i = 0; i < steps && g.phase === 'playing'; i++) {
            g.update(1 / 20);
            if (g.bossRef && !g.bossRef.dead && i % 10 === 0) {
                bossSamples.push([+(t + i / 20).toFixed(1), Math.round(g.bossRef.hp), Math.ceil(g.link)]);
            }
        }
        t += p.interval;
    }
    const s = D.state();
    return { seed: p.seed, elapsed: +t.toFixed(1), phase: s.phase, wave: s.wave, link: s.link,
             towers: s.towers, lvMax: s.lvMax, kills: s.stats.kills, merges: s.stats.merges,
             leaked: s.stats.leaked, leakDamage: s.stats.leakDamage,
             bossPasses: s.stats.bossPasses || 0,
             waveTrace: s.waveTrace, bossSamples: bossSamples };
}"""


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "current"
    out = {"label": label, "run_at": datetime.now().astimezone().isoformat(),
           "seeds": SEEDS, "profiles": []}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, executable_path=CHROME,
                               args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = b.new_page(viewport={"width": 1280, "height": 800})
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("() => window.__ICE_DEBUG__.start()")
        profiles = PROFILES
        if os.environ.get("QUICK") == "1":
            profiles = [p for p in PROFILES if p["key"] in ("expert", "normal", "sloppy")]
        for p in profiles:
            runs = []
            for sd in SEEDS:
                arg = dict(p); arg["seed"] = sd
                r = page.evaluate(JS, arg)
                runs.append(r)
            wins = sum(1 for r in runs if r["phase"] == "win")
            # 逐波平均穿透深度（只统计跑到的波）
            per_wave = {}
            for r in runs:
                for w in r["waveTrace"]:
                    d = per_wave.setdefault(w["wave"], {"deepest": [], "leaks": [], "dmg": [], "link": []})
                    d["deepest"].append(w["deepest"]); d["leaks"].append(w["leaks"])
                    d["dmg"].append(w["dmg"]); d["link"].append(w["link"])
            waves = []
            for w in sorted(per_wave):
                d = per_wave[w]
                waves.append({
                    "wave": w, "n": len(d["deepest"]),
                    "avg_deepest": round(sum(d["deepest"]) / len(d["deepest"]), 3),
                    "avg_leaks": round(sum(d["leaks"]) / len(d["leaks"]), 2),
                    "avg_dmg": round(sum(d["dmg"]) / len(d["dmg"]), 2),
                    "avg_link": round(sum(d["link"]) / len(d["link"]), 1),
                })
            summary = {
                "win_rate": round(wins / len(runs), 2),
                "avg_link": round(sum(r["link"] for r in runs) / len(runs), 1),
                "avg_wave": round(sum(r["wave"] for r in runs) / len(runs), 1),
                "links": [r["link"] for r in runs],
                "boss_passes": [r["bossPasses"] for r in runs],
                "outcomes": [r["phase"] for r in runs],
            }
            out["profiles"].append({"key": p["key"], "name": p["name"],
                                    "summary": summary, "waves": waves, "runs": runs})
            print("=== %-34s win=%.2f avg_link=%5.1f avg_wave=%4.1f links=%s" % (
                p["key"], summary["win_rate"], summary["avg_link"], summary["avg_wave"], summary["links"]))
            print("    wave: " + " ".join("%2d" % w["wave"] for w in waves))
            print("    deep: " + " ".join("%.2f" % w["avg_deepest"] for w in waves))
            print("    leak: " + " ".join("%2d" % w["avg_leaks"] for w in waves))
            print("    link: " + " ".join("%3d" % w["avg_link"] for w in waves))
            print("    boss passes: %s" % summary["boss_passes"])
        b.close()
    path = os.path.join(ROOT, "curve_%s.json" % label)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\nsaved", path)
    return out


if __name__ == "__main__":
    main()
