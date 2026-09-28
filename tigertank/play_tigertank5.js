// Play Tiger Tank - find Play Game button coords, avoid Escape/P, mouse-only controls
const { chromium } = require('/import/ml-sc-scratch1/chenw/CodeGuru/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  page.on('console', msg => {
    const t = msg.text();
    if (!t.includes('WebGL') && !t.includes('GPU stall') && !t.includes('willReadFrequently') && !t.includes('AudioContext')) {
      console.log('[browser]', msg.type(), t);
    }
  });
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  await page.route('**/game_api/v1*', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.gameApi = {
          saveData: function(d) { return Promise.resolve(); },
          loadData: function() { return Promise.resolve('{}'); },
          requestRewardedAd: function(id, onFinish, onError) { if(onFinish) onFinish(); },
          requestInterstitialAd: function(onEmpty) { if(onEmpty) onEmpty(); },
          isAudioEnabled: function() { return true; },
          applyAudioEnabled: function() {},
          isAvailable: function() { return false }
        };
        window.YT = window.gameApi;
      `
    });
  });

  console.log('Loading game...');
  await page.goto('https://393088398809336751.playables.usercontent.goog/v/assets/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: '/tmp/tigertank_10_title.png' });
  console.log('Saved title screenshot');

  // Inspect the canvas to find button positions by sampling pixel colors
  // The title screen has "Play Game" and "Quit Game" buttons. Let's find them.
  const buttonInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { error: 'no canvas' };
    const rect = canvas.getBoundingClientRect();
    // Try to read pixel data from the canvas to find button regions
    let ctx;
    try {
      ctx = canvas.getContext('2d');
    } catch (e) {
      return { error: 'no 2d ctx', w: canvas.width, h: canvas.height, rect };
    }
    if (!ctx) {
      // Try webgl
      return { error: 'no ctx', w: canvas.width, h: canvas.height, rect };
    }
    // Sample a vertical strip down the center to find non-background pixels
    const w = canvas.width, h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    // Find rows that have significant non-background content
    const rowActivity = [];
    for (let y = 0; y < h; y += 4) {
      let nonBg = 0;
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        // Background is likely dark; count pixels that are bright/colored
        if (r > 100 || g > 100 || b > 100) nonBg++;
      }
      rowActivity.push({ y, nonBg });
    }
    return { w, h, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, rowActivity: rowActivity.filter(r => r.nonBg > 20) };
  });
  console.log('Button info:', JSON.stringify(buttonInfo, null, 2).slice(0, 2000));

  // Try clicking at different Y positions to find Play Game
  // Title screen typically has Play Game in upper-middle area
  console.log('Trying clicks at various Y positions...');
  const tryPositions = [
    { x: 640, y: 450, label: 'upper' },
    { x: 640, y: 500, label: 'middle' },
    { x: 640, y: 550, label: 'lower' },
    { x: 640, y: 600, label: 'lowest' }
  ];

  for (const pos of tryPositions) {
    console.log(`Clicking at (${pos.x}, ${pos.y}) - ${pos.label}`);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `/tmp/tigertank_11_click_${pos.label}.png` });
    console.log(`Saved screenshot for ${pos.label}`);
  }

  // Check current state
  const stateInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      width: c.width, height: c.height
    }));
    return { canvases, bodyText: document.body.innerText.slice(0, 300) };
  });
  console.log('State after clicks:', JSON.stringify(stateInfo, null, 2));

  // Now try mouse-only play: move in circle, click to shoot
  console.log('Playing with mouse (no keyboard)...');
  for (let frame = 0; frame < 40; frame++) {
    const angle = frame * 0.15;
    const radius = 100 + Math.sin(frame * 0.08) * 60;
    const mx = 640 + Math.cos(angle) * radius;
    const my = 400 + Math.sin(angle) * radius;
    await page.mouse.move(mx, my);
    await page.waitForTimeout(80);
    if (frame % 4 === 0) {
      await page.mouse.down();
      await page.waitForTimeout(40);
      await page.mouse.up();
    }
    if (frame % 10 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_12_play_${frame}.png` });
      console.log(`Play frame ${frame} saved`);
    }
    await page.waitForTimeout(150);
  }

  await page.screenshot({ path: '/tmp/tigertank_13_final.png' });
  console.log('Saved final screenshot');

  await browser.close();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
