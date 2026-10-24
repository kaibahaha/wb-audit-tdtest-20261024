const { test, expect } = require('@playwright/test');
const path = require('path');

test('文字塔防 页面加载并推进一波', async ({ page }) => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);

  // 验收点1：标题正确
  await expect(page).toHaveTitle(/文字塔防/);
  // 验收点2：开始按钮可见
  const startBtn = page.locator('#start');
  await expect(startBtn).toBeVisible();
  // 验收点3：初始波次为 0
  const waveBefore = await page.locator('#wave').textContent();
  expect(waveBefore.trim()).toBe('0');
  // 验收点4：点击后波次增加
  await startBtn.click();
  await expect(page.locator('#wave')).not.toHaveText('0');
  // 验收点5：日志出现“波”
  await expect(page.locator('#log')).toContainText('波');
  // 验收点6：游戏状态对象可读
  const state = await page.evaluate(() => window.__GAME__.getState());
  expect(state.wave).toBeGreaterThan(0);
});
