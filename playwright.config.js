module.exports = {
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  use: { headless: true },
  reporter: [['list']],
};
