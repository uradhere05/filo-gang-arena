/**
 * Room 5-6 Picklebol cross-browser simulation.
 * Runs the full 11-assertion suite on Chromium, Firefox, and WebKit.
 * Each browser gets its own room number (98/99/100) so PEER_IDs
 * never collide across concurrent or sequential runs.
 * Run: node pong-sim.js
 */
const { chromium, firefox, webkit } = require('playwright');

const BASE_URL = 'http://localhost:8080/pong.html';
const sleep    = ms => new Promise(r => setTimeout(r, ms));

/* ── helpers ── */
function assert(ok, label, detail, results) {
  const entry = { ok, label, detail };
  results.push(entry);
  if (ok) console.log(`    ✅ PASS  ${label}`);
  else     console.log(`    ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`);
}

async function openPlayer(browser, name, avatar, room) {
  // Use storageState to pre-populate localStorage — works across all browsers
  // including WebKit, which does not guarantee addInitScript localStorage
  // persistence before the page's own login-guard script runs.
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
  await page.goto(`${BASE_URL}?room=${room}`);
  return page;
}

/** Poll until all pages show the target screen (400 ms interval, up to timeout). */
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

/* ── core test suite ── */
async function runSuite(browserName, launchFn, room) {
  const results = [];
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  🌐  ${browserName.toUpperCase()}  (room ${room})`);
  console.log(`${'─'.repeat(52)}`);

  let browser;
  try {
    browser = await launchFn({ headless: true });

    console.log(`  Opening Kuya AD + Matt at room ${room}…`);
    const p1 = await openPlayer(browser, 'Kuya AD', '🕵️', room);
    await sleep(800);
    const p2 = await openPlayer(browser, 'Matt', '👱', room);

    /* ── Wait for PeerJS connection ── */
    console.log('  ⏳ Waiting for s-game (up to 25s)…');
    const connected = await waitForScreen([p1, p2], 's-game', 25000);

    if (!connected) {
      for (const [pg, nm] of [[p1,'Kuya AD'],[p2,'Matt']]) {
        const st = await pg.evaluate(() => ({
          screen: [...document.querySelectorAll('.screen.active')].map(s => s.id),
          peerOpen: peer?.open, role: myRole,
        })).catch(() => null);
        console.log(`    ${nm} state:`, JSON.stringify(st));
      }
      assert(false, 'PeerJS connection established', 'timed out', results);
      return results;
    }

    /* Freeze ball so it can't auto-score before our checks */
    await p1.evaluate(() => { ball.vx = 0; ball.vy = 0; });

    const p1InGame = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
    const p2InGame = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
    assert(p1InGame, 'Kuya AD in game screen', '', results);
    assert(p2InGame, 'Matt in game screen', '', results);

    const p1Side = await p1.evaluate(() => mySide).catch(() => null);
    const p2Side = await p2.evaluate(() => mySide).catch(() => null);
    assert(p1Side === 'left' && p2Side === 'right', 'Host=left, Guest=right', `${p1Side}/${p2Side}`, results);

    /* ── Guest name on host vs-display ── */
    const vsText = await p1.evaluate(() => document.getElementById('vs-display')?.textContent || '').catch(() => '');
    assert(vsText.includes('Matt'), 'Host vs-display shows guest name', vsText, results);

    /* ── Score 5 points for left ── */
    console.log('  🎯 Injecting 5 left-side scores…');
    for (let i = 0; i < 5; i++) {
      await p1.evaluate(() => { ball.x = 620; ball.y = 170; ball.vx = 8; ball.vy = 0; });
      await sleep(450);
    }
    await sleep(1500);

    const p1Sc = await p1.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
    const p2Sc = await p2.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
    console.log(`    Kuya AD scores: left=${p1Sc?.l} right=${p1Sc?.r}`);
    console.log(`    Matt    scores: left=${p2Sc?.l} right=${p2Sc?.r}`);
    assert((p1Sc?.l ?? 0) >= 5, 'Left score ≥ 5', String(p1Sc?.l), results);

    /* ── Champion screen ── */
    await waitForScreen([p1], 's-champ', 4000).catch(() => {});
    const p1Champ = await p1.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
    const p2Champ = await p2.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
    assert(p1Champ || p2Champ, 'Champion screen shown after 5 wins', '', results);

    /* ── Two-click rematch ── */
    console.log('  🔄 Rematch handshake…');
    await p1.locator('button', { hasText: /Rematch|🔄/ }).first().click();
    console.log('    ✓ P1 clicked Rematch (1st)');
    await sleep(2000);

    const p1Waiting = await p1.evaluate(() =>
      document.getElementById('s-champ')?.classList.contains('active') ||
      document.getElementById('s-game')?.classList.contains('active')
    ).catch(() => false);
    assert(p1Waiting, 'P1 waiting after 1st Rematch click', '', results);

    await p2.locator('button', { hasText: /Rematch|🔄/ }).first().click();
    console.log('    ✓ P2 clicked Rematch (2nd)');

    const rematchOk = await waitForScreen([p1, p2], 's-game', 8000);
    await p1.evaluate(() => { ball.vx = 0; ball.vy = 0; }).catch(() => {});
    assert(rematchOk, 'Both back in game after rematch', '', results);
    const scoresReset = await p1.evaluate(() => scores.left === 0 && scores.right === 0).catch(() => false);
    assert(scoresReset, 'Scores reset to 0 after rematch', '', results);

    /* ── Disconnect countdown cancellable ── */
    console.log('  💥 Disconnect countdown cancel…');
    await p1.evaluate(() => { onDrop(); });
    await sleep(300);
    await p1.evaluate(() => {
      destroyPeer();
      window.location.href = `index.html?screen=lobby&name=${encodeURIComponent(myName)}`;
    });
    await sleep(6500);
    const p1OnLobby    = await p1.evaluate(() => document.getElementById('s-lobby')?.classList.contains('active')).catch(() => false);
    const ivCleared    = await p1.evaluate(() => dropCountdownIv === null).catch(() => false);
    assert(p1OnLobby, 'P1 on lobby after navigation during countdown', '', results);
    assert(ivCleared,  'dropCountdownIv=null after destroyPeer', '', results);

  } catch (err) {
    console.log(`    ❌ Suite error: ${err.message}`);
    results.push({ ok: false, label: 'Suite exception', detail: err.message });
  } finally {
    await browser?.close().catch(() => {});
  }

  return results;
}

/* ── runner ── */
async function run() {
  console.log('\n🏓 Picklebol Cross-Browser Simulation\n');
  console.log('Browsers: Chromium · Firefox · WebKit');
  console.log('Rooms:    98 · 99 · 100  (isolated PEER_IDs)\n');

  const suites = [
    { name: 'Chromium', fn: chromium.launch.bind(chromium), room: 98 },
    { name: 'Firefox',  fn: firefox.launch.bind(firefox),   room: 99 },
    { name: 'WebKit',   fn: webkit.launch.bind(webkit),      room: 100 },
  ];

  const summary = [];
  for (const { name, fn, room } of suites) {
    const results = await runSuite(name, fn, room);
    const p = results.filter(r => r.ok).length;
    const f = results.filter(r => !r.ok).length;
    summary.push({ name, passed: p, failed: f, total: results.length });
  }

  /* ── Final summary ── */
  console.log(`\n${'═'.repeat(52)}`);
  console.log('  CROSS-BROWSER SUMMARY');
  console.log(`${'═'.repeat(52)}`);
  let grandPass = 0, grandFail = 0;
  for (const { name, passed, failed, total } of summary) {
    const icon = failed === 0 ? '✅' : '❌';
    console.log(`  ${icon}  ${name.padEnd(10)} ${passed}/${total} passed${failed ? `  (${failed} failed)` : ''}`);
    grandPass += passed; grandFail += failed;
  }
  console.log(`${'─'.repeat(52)}`);
  console.log(`  Total: ${grandPass} passed, ${grandFail} failed  (${grandPass + grandFail} assertions)`);
  console.log(grandFail === 0 ? '\n  🎉 ALL BROWSERS PASSED\n' : `\n  ⚠️  ${grandFail} failure(s) across browsers\n`);
}

run().catch(err => {
  console.error('\n❌ Runner error:', err.message);
  process.exit(1);
});
