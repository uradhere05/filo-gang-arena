/**
 * Room 5-6 Picklebol simulation — 2 players, 2 visible Chrome windows.
 * Runs the full 11-assertion suite with headless:false so you can watch
 * both windows side-by-side.
 *
 * Uses room 95 to avoid stale PEER_ID collisions from previous runs.
 * Disables background-timer throttling so the game loop runs at full
 * speed even when windows are not the foreground focus.
 *
 * Run: node pong-sim.js
 */
const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:8080/pong.html';
const ROOM     = 95;          // isolated from rooms 5 & 6 used in production
const sleep    = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ PASS  ${label}`); passed++; }
  else     { console.log(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function openPlayer(browser, name, avatar, winX) {
  const ctx = await browser.newContext({
    viewport: { width: 640, height: 780 },
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:8080',
        localStorage: [
          { name: 'filoName',   value: name },
          { name: 'filoAvatar', value: avatar },
        ],
      }],
    },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}?room=${ROOM}`);
  // Position windows side-by-side
  await page.evaluate(x => window.moveTo(x, 60), winX).catch(() => {});
  console.log(`  ✓ ${name} — window at x=${winX}`);
  return page;
}

/** Poll until all pages show screenId (400 ms interval). */
async function waitForScreen(pages, screenId, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const all = await Promise.all(
      pages.map(p =>
        p.evaluate(id => document.getElementById(id)?.classList.contains('active'), screenId)
         .catch(() => false)
      )
    );
    if (all.every(Boolean)) return true;
    await sleep(400);
  }
  return false;
}

async function run() {
  console.log('\n🏓 Picklebol — 2 Players · 2 Chrome Windows\n');
  console.log(`  Room: ${ROOM}  |  First to 5 wins\n`);

  const browser = await chromium.launch({
    headless: false,
    channel:  'chrome',
    args: [
      '--window-size=660,820',
      '--disable-background-timer-throttling',   // keep game loop full-speed in bg
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  /* ── Open both players ── */
  console.log('── Opening windows ──────────────────────────────────\n');
  const p1 = await openPlayer(browser, 'Kuya AD', '🕵️',   20);
  await sleep(900);
  const p2 = await openPlayer(browser, 'Matt',    '👱',  700);

  /* ── Wait for PeerJS connection ── */
  console.log('\n⏳ Waiting for both players to reach s-game (up to 25s)…');
  const connected = await waitForScreen([p1, p2], 's-game', 25000);

  if (!connected) {
    for (const [pg, nm] of [[p1,'Kuya AD'],[p2,'Matt']]) {
      const st = await pg.evaluate(() => ({
        screen:   [...document.querySelectorAll('.screen.active')].map(s => s.id),
        peerOpen: peer?.open,
        role:     myRole,
      })).catch(() => null);
      console.log(`  ${nm}:`, JSON.stringify(st));
    }
    console.log('\n⚠ PeerJS connection failed — ensure http server is running on :8080');
    await browser.close();
    return;
  }

  /* Freeze ball immediately so it can't auto-score before our checks */
  await p1.evaluate(() => { ball.vx = 0; ball.vy = 0; });

  const p1InGame = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  const p2InGame = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  assert(p1InGame, 'Kuya AD (host/left) in game screen');
  assert(p2InGame, 'Matt (guest/right) in game screen');

  const p1Side = await p1.evaluate(() => mySide).catch(() => null);
  const p2Side = await p2.evaluate(() => mySide).catch(() => null);
  console.log(`\n  Sides — Kuya AD: ${p1Side}  |  Matt: ${p2Side}`);
  assert(p1Side === 'left' && p2Side === 'right', 'Host=left, Guest=right', `${p1Side}/${p2Side}`);

  /* ── Guest name on host vs-display ── */
  const vsText = await p1.evaluate(() => document.getElementById('vs-display')?.textContent || '').catch(() => '');
  assert(vsText.includes('Matt'), 'Host vs-display shows guest name', vsText);

  /* ── Score 5 points for left via ball injection ── */
  console.log('\n🎯 Scoring 5 points for left via ball injection…');
  for (let i = 0; i < 5; i++) {
    await p1.evaluate(() => { ball.x = 620; ball.y = 170; ball.vx = 8; ball.vy = 0; });
    await sleep(450);
    process.stdout.write(`  point ${i + 1}/5\r`);
  }
  await sleep(1500);
  console.log('');

  const p1Sc = await p1.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
  const p2Sc = await p2.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
  console.log(`  Kuya AD: left=${p1Sc?.l}  right=${p1Sc?.r}`);
  console.log(`  Matt:    left=${p2Sc?.l}  right=${p2Sc?.r}`);
  assert((p1Sc?.l ?? 0) >= 5, 'Left score ≥ 5', String(p1Sc?.l));

  /* ── Champion screen ── */
  await waitForScreen([p1], 's-champ', 4000).catch(() => {});
  const p1Champ = await p1.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  const p2Champ = await p2.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  assert(p1Champ || p2Champ, 'Champion screen shown after 5 wins');

  /* ── Two-click rematch ── */
  console.log('\n🔄 Rematch handshake…');
  await p1.locator('button', { hasText: /Rematch|🔄/ }).first().click();
  console.log('  ✓ Kuya AD clicked Rematch (1st click)');
  await sleep(2000);

  const p1Waiting = await p1.evaluate(() =>
    document.getElementById('s-champ')?.classList.contains('active') ||
    document.getElementById('s-game')?.classList.contains('active')
  ).catch(() => false);
  assert(p1Waiting, 'Kuya AD waiting after 1st Rematch click');

  await p2.locator('button', { hasText: /Rematch|🔄/ }).first().click();
  console.log('  ✓ Matt clicked Rematch (2nd click — starts game)');

  const rematchOk = await waitForScreen([p1, p2], 's-game', 8000);
  await p1.evaluate(() => { ball.vx = 0; ball.vy = 0; }).catch(() => {});
  assert(rematchOk, 'Both back in game after rematch');
  const scoresReset = await p1.evaluate(() => scores.left === 0 && scores.right === 0).catch(() => false);
  assert(scoresReset, 'Scores reset to 0 after rematch');

  /* ── Disconnect countdown cancellable ── */
  console.log('\n💥 Testing disconnect countdown cancel…');
  await p1.evaluate(() => { onDrop(); });
  await sleep(300);
  await p1.evaluate(() => {
    destroyPeer();
    window.location.href = `index.html?screen=lobby&name=${encodeURIComponent(myName)}`;
  });
  await sleep(6500);
  const p1OnLobby  = await p1.evaluate(() => document.getElementById('s-lobby')?.classList.contains('active')).catch(() => false);
  const ivCleared  = await p1.evaluate(() => dropCountdownIv === null).catch(() => false);
  assert(p1OnLobby, 'Kuya AD on lobby after navigation during countdown');
  assert(ivCleared,  'dropCountdownIv=null after destroyPeer');

  /* ── Results ── */
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open for 6 seconds for inspection…');
  await sleep(6000);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ Sim error:', err.message);
  process.exit(1);
});
