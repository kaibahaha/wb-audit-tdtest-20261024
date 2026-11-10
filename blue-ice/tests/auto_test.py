# -*- coding: utf-8 -*-
"""
《蓝冰猎影：宇宙幽灵》第一关 — 自动化验收脚本
使用真实 Chrome (Playwright) 验证：
  1. 页面无 JS 运行错误、资源全部加载
  2. 桌面 / 手机竖屏渲染正常
  3. 点击钻孔部署、拖拽合成、一键合成、回收
  4. 波次推进、敌人生成、链路扣减
  5. 完整胜利结算（12 波 + BOSS）
  6. 完整失败结算
  7. Web Audio 引擎初始化
输出 tests/test_report.json 与 tests/screenshots/*.png
"""
import json, os, time, sys
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
ROOT = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(ROOT, "screenshots")
os.makedirs(SHOT, exist_ok=True)

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
report = {
    "project": "蓝冰猎影：宇宙幽灵 / 第一关",
    "run_at": datetime.now().astimezone().isoformat(),
    "base_url": BASE,
    "browser": "Chrome (Playwright, headless)",
    "checks": [],
    "console_errors": [],
    "page_errors": [],
    "screenshots": [],
}
results = []


def check(name, cond, detail=""):
    ok = bool(cond)
    report["checks"].append({"name": name, "pass": ok, "detail": str(detail)})
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + ("  | " + str(detail) if detail else ""))
    return ok


def shot(page, name):
    path = os.path.join(SHOT, name + ".png")
    page.screenshot(path=path)
    report["screenshots"].append(os.path.relpath(path, ROOT).replace("\\", "/"))
    return path


def state(page):
    return page.evaluate("() => window.__ICE_DEBUG__.state()")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            executable_path=CHROME,
            args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                  "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
        )
        ctx = browser.new_context(viewport={"width": 1440, "height": 860}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("console", lambda m: report["console_errors"].append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: report["page_errors"].append(str(e)))
        page.on("requestfailed", lambda r: report["console_errors"].append("REQFAIL " + r.url))

        # ---------- 1. 加载 ----------
        resp = page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(900)
        check("首页 HTTP 200", resp is not None and resp.status == 200, resp.status if resp else "no response")
        check("游戏对象已初始化", page.evaluate("() => !!window.__ICE_DEBUG__"))
        check("三个脚本模块均加载", page.evaluate(
            "() => !!(window.IceAudio && window.IceRender && window.__ICE_DEBUG__ && window.IceRender.IceFX)"))
        s0 = state(page)
        check("初始状态为标题页", s0["phase"] == "title", s0["phase"])
        check("画布已按窗口尺寸建立", s0["canvas"]["w"] == 1440 and s0["canvas"]["h"] == 860, s0["canvas"])
        shot(page, "01_title")

        # ---------- 2. 进入游戏 ----------
        page.click("#btnStart")
        page.wait_for_timeout(300)
        check("教程简报出现", page.locator("#tutorial").is_visible())
        shot(page, "02_briefing")
        page.click("#btnTutOk")
        page.wait_for_timeout(600)
        s1 = state(page)
        check("进入 playing 状态", s1["phase"] == "playing", s1["phase"])
        check("初始光子预算 130", s1["energy"] == 130, s1["energy"])
        check("数据链路 100%", s1["link"] == 100, s1["link"])
        check("Web Audio 引擎已初始化", s1["audioReady"] is True, s1["audioReady"])
        check("HUD / 操作栏可见", page.locator("#hud").is_visible() and page.locator("#dock").is_visible())
        shot(page, "03_battle_empty")

        # ---------- 3. 真实指针点击部署 ----------
        # 找一个空且非路径的钻孔
        cellinfo = page.evaluate("""() => {
            const g = window.__ICE_DEBUG__.game;
            for (let r=0;r<5;r++) for(let c=0;c<8;c++)
              if(g.isActive(c,r) && !g.isPath(c,r) && !g.towerAt(c,r))
                return {x:g.gx0+(c+.5)*g.cell, y:g.gy0+(r+.5)*g.cell, c, r};
            return null;
        }""")
        page.mouse.click(cellinfo["x"], cellinfo["y"])
        page.wait_for_timeout(350)
        s2 = state(page)
        check("点击空钻孔成功部署 1 座装置", s2["towers"] == 1, s2["towers"])
        check("部署扣除 20 光子", s2["energy"] == 110, s2["energy"])
        shot(page, "04_deploy_click")

        # ---------- 4. 批量部署 + 合成 ----------
        page.evaluate("() => window.__ICE_DEBUG__.deploy(9)")
        page.wait_for_timeout(350)
        s3 = state(page)
        check("批量部署后共 10 座装置", s3["towers"] == 10, s3["towers"])
        shot(page, "05_deployed_array")

        pair_before = page.evaluate("() => !!window.__ICE_DEBUG__.game.findMergePair()")
        check("存在可合成的同种同级装置", pair_before, pair_before)
        page.evaluate("() => window.__ICE_DEBUG__.mergeAll()")
        page.wait_for_timeout(400)
        s4 = state(page)
        check("合成使装置数量减少", s4["towers"] < s3["towers"], "%d -> %d" % (s3["towers"], s4["towers"]))
        check("合成产生 Lv.2+ 装置", s4["lvMax"] >= 2, s4["lvMax"])
        shot(page, "06_merged_cherenkov")

        # 选中装置 → 信息卡 → 回收
        page.evaluate("""() => {
            const g = window.__ICE_DEBUG__.game;
            g.select(g.towers[0]);
        }""")
        page.wait_for_timeout(200)
        check("选中装置显示信息卡", page.locator("#inspector").is_visible())
        check("信息卡含等级与地形", "Lv." in page.locator("#inspLv").inner_text()
              and "地形" in page.locator("#inspTerrain").inner_text())
        shot(page, "07_inspector")
        e_before = state(page)["energy"]
        page.click("#btnRecycle")
        page.wait_for_timeout(200)
        check("回收返还光子预算", state(page)["energy"] > e_before,
              "%d -> %d" % (e_before, state(page)["energy"]))

        # ---------- 5. 波次 / 战斗 ----------
        page.evaluate("() => window.__ICE_DEBUG__.nextWave()")
        page.wait_for_timeout(1800)
        s5 = state(page)
        check("第 1 波已开始", s5["wave"] == 1 and s5["waveState"] == "running", (s5["wave"], s5["waveState"]))
        check("干扰粒子已从注入口生成", s5["enemies"] > 0 or s5["stats"]["kills"] > 0,
              "onfield=%d killed=%d queue=%d" % (s5["enemies"], s5["stats"]["kills"], s5["queue"]))
        page.wait_for_timeout(2600)
        s6 = state(page)
        check("装置正在攻击并滤除干扰", s6["stats"]["kills"] > 0 or s6["bullets"] > 0,
              "kills=%d bullets=%d" % (s6["stats"]["kills"], s6["bullets"]))
        shot(page, "08_wave_combat")

        # ---------- 6. 完整胜利流程（真实推进 12 波 + BOSS） ----------
        page.evaluate("""() => {
            const D = window.__ICE_DEBUG__;
            D.start();
            D.godMode(true);
            D.addEnergy(600);
            D.deploy(14);
        }""")
        v0 = state(page)
        check("胜利测试阵容就绪", v0["towers"] >= 14, v0["towers"])
        win = page.evaluate("() => window.__ICE_DEBUG__.advance(300, 1/20)")
        page.wait_for_timeout(320)
        v1 = state(page)
        shot(page, "09a_cherenkov_climax")   # 先取证切伦科夫蓝光高潮
        check("推进至第 12 波 BOSS", v1["wave"] == 12, v1["wave"])
        check("完整流程触发胜利结算", v1["phase"] == "win", v1["phase"])
        check("胜利时蓝光高潮先于结算面板", not page.locator("#resultScreen").is_visible())
        page.wait_for_timeout(1900)
        check("胜利面板可见", page.locator("#resultScreen").is_visible())
        check("胜利面板文案正确", "捕获成功" in page.locator("#resTitle").inner_text())
        check("统计包含 12 波 / 击杀数", "12 / 12" in page.locator("#resStats").inner_text()
              and v1["stats"]["kills"] > 0)
        shot(page, "09_victory")

        # ---------- 7. 完整失败流程 ----------
        page.evaluate("() => window.__ICE_DEBUG__.start()")
        lose = page.evaluate("() => window.__ICE_DEBUG__.advance(300, 1/20)")
        page.wait_for_timeout(900)
        l1 = state(page)
        check("无布阵时触发失败结算", l1["phase"] == "lose", l1["phase"])
        check("失败时链路归零", l1["link"] == 0, l1["link"])
        check("失败面板可见且文案正确", page.locator("#resultScreen").is_visible()
              and "击穿" in page.locator("#resTitle").inner_text())
        shot(page, "10_defeat")

        # ---------- 8. 正常难度平衡验证（无 godMode，模拟理性玩家） ----------
        normal = page.evaluate("""() => {
            const D = window.__ICE_DEBUG__, g = D.game;
            D.start();
            let t = 0, guard = 0;
            while (g.phase === 'playing' && t < 420) {
                let k = 0;
                while (g.findMergePair() && k++ < 8) g.autoMerge();
                while (g.energy >= g.deployCost() && g.emptyCells().length > 0 && k++ < 30) g.autoDeploy();
                g.advance(2, 1/20);
                t += 2;
            }
            return { simulated_seconds: t, state: D.state() };
        }""")
        ns = normal["state"]
        check("正常难度可完整通关（无 godMode）", ns["phase"] == "win",
              "phase=%s wave=%d link=%d kills=%d merges=%d maxLv=%d sim=%ss" % (
                  ns["phase"], ns["wave"], ns["link"], ns["stats"]["kills"],
                  ns["stats"]["merges"], ns["lvMax"], normal["simulated_seconds"]))
        check("正常难度通关后链路仍有余量（非险胜）", ns["link"] > 0, ns["link"])
        check("正常难度产生了合成升级", ns["stats"]["merges"] > 0 and ns["lvMax"] >= 3,
              "merges=%d maxLv=%d" % (ns["stats"]["merges"], ns["lvMax"]))
        report["normal_difficulty_run"] = normal
        shot(page, "10b_normal_balance")

        # ---------- 9. 手机竖屏 ----------
        m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.on("pageerror", lambda e: report["page_errors"].append("MOBILE " + str(e)))
        mp.goto(BASE, wait_until="networkidle")
        mp.wait_for_timeout(700)
        shot(mp, "11_mobile_title")
        mp.tap("#btnStart")
        mp.wait_for_timeout(300)
        mp.tap("#btnTutOk")
        mp.wait_for_timeout(500)
        mp.evaluate("() => window.__ICE_DEBUG__.deploy(8)")
        mp.wait_for_timeout(500)
        ms = mp.evaluate("() => window.__ICE_DEBUG__.state()")
        check("手机竖屏画布尺寸正确", ms["canvas"]["w"] == 390 and ms["canvas"]["h"] == 844, ms["canvas"])
        check("手机竖屏可正常部署", ms["towers"] >= 8, ms["towers"])
        check("手机竖屏钻孔尺寸可点", ms["canvas"]["cell"] >= 30, ms["canvas"]["cell"])
        shot(mp, "12_mobile_battle")

        # 触屏点击部署
        ci = mp.evaluate("""() => {
            const g = window.__ICE_DEBUG__.game;
            for (let r=0;r<5;r++) for(let c=0;c<8;c++)
              if(g.isActive(c,r) && !g.isPath(c,r) && !g.towerAt(c,r))
                return {x:g.gx0+(c+.5)*g.cell, y:g.gy0+(r+.5)*g.cell};
            return null;
        }""")
        if ci:
            mp.evaluate("() => window.__ICE_DEBUG__.addEnergy(100)")
            before = mp.evaluate("() => window.__ICE_DEBUG__.state().towers")
            mp.touchscreen.tap(ci["x"], ci["y"])
            mp.wait_for_timeout(300)
            after = mp.evaluate("() => window.__ICE_DEBUG__.state().towers")
            check("触屏点击可部署", after == before + 1, "%d -> %d" % (before, after))
        shot(mp, "13_mobile_touch")

        # ---------- 9. 无运行错误 ----------
        check("无 pageerror", len(report["page_errors"]) == 0, report["page_errors"][:3])
        check("无 console error / 资源加载失败", len(report["console_errors"]) == 0,
              report["console_errors"][:3])

        browser.close()

    report["summary"] = {
        "total": len(results), "passed": sum(results), "failed": len(results) - sum(results),
        "verdict": "PASS" if all(results) else "FAIL",
    }
    with open(os.path.join(ROOT, "test_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("\n== SUMMARY ==")
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
