// node --test pi/extensions/artifact-review/browser.test.mjs
//
// The review panel in real headless Google Chrome, driven over the DevTools
// protocol with real mouse and key events: Option-click and text selection
// open a note card, the page's own tabs still work with plain clicks, Send
// posts what was on screen, and a change in the folder reloads the page at the
// same scroll position (or waits while a note is half written). The outline,
// the note card and the "Add note" button scroll with what they point at. Skipped when
// Chrome is not installed. Set ARTIFACT_REVIEW_SHOT=<file.png> to keep a
// screenshot of the panel with notes in it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReviewServer } from './server.ts';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'artifact-review-browser-')));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Demo</title>
<style>body{font:16px sans-serif;margin:40px} .tall{height:2400px} .tab[aria-pressed="true"]{background:#000;color:#fff}</style></head>
<body>
<h1>October in Auckland</h1>
<h2 id="five">Five days</h2>
<div class="tabs"><button class="tab" aria-pressed="true">Passives (A)</button><button class="tab" aria-pressed="false">Monthlies (C): a late day</button></div>
<label>Day <select id="pick"><option>Mon 13 Oct · 8 bookings</option><option selected>Tue 14 Oct · 9 bookings</option></select></label>
<h2>6. What this means</h2>
<h3>Book travel separately</h3>
<p id="drive">Google's drive time is good enough to plan with.</p>
<p><a id="link" href="https://example.com/">a link</a></p>
<div id="inner" style="height:120px;overflow:auto;border:1px solid #ccc"><div style="height:60px"></div><p id="deep">Deep inside a scrolling box</p><div style="height:600px"></div></div>
<div class="tall"></div>
<p id="bottom">Bottom of the page</p>
<script>
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) other.setAttribute('aria-pressed', String(other === tab));
  });
  window.pageLoads = (Number(sessionStorage.getItem('loads')) || 0) + 1;
  sessionStorage.setItem('loads', window.pageLoads);
</script>
</body></html>`;

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ''}`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of [...this.listeners]) listener(message);
      }
    };
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method, ms = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${method}`)), ms);
      const listener = (message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.listeners.splice(this.listeners.indexOf(listener), 1);
        resolve(message.params);
      };
      this.listeners.push(listener);
    });
  }
}

async function launchChrome() {
  const profile = join(root, 'profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(50);
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const cdp = new Cdp(`ws://127.0.0.1:${port}${path}`);
  await cdp.ready;
  return { chrome, cdp };
}

test('the review panel in Chrome: notes, normal clicks, send, reload', { skip: !existsSync(CHROME) && 'Google Chrome is not installed', timeout: 60000 }, async () => {
  const folder = join(root, 'page');
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.html'), PAGE);
  const deliveries = [];
  // Set while a test leaves Pi's confirmation open: delivery waits until it resolves.
  let confirmation;
  const server = await startReviewServer({
    folder, entry: 'index.html', overlayPath: fileURLToPath(new URL('./overlay.js', import.meta.url)), title: 'Demo', busy: () => false, debounceMs: 100,
    async deliver(batch) {
      deliveries.push(batch);
      await confirmation;
      return { queued: false, text: 'the message' };
    },
  });
  const { chrome, cdp } = await launchChrome();
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => cdp.send(method, params, sessionId);
    await call('Page.enable');
    await call('Runtime.enable');
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      return result.value;
    };
    const ui = (expression) => evaluate(`(() => { const ui = document.getElementById('__artifact-review').shadowRoot; return ${expression}; })()`);
    const until = async (expression, what, ms = 5000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (await evaluate(expression).catch(() => false)) return;
        await sleep(50);
      }
      assert.fail(`timed out waiting for ${what}`);
    };
    const center = async (expression) => evaluate(`(() => { const r = (${expression}).getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 20), y: r.top + r.height / 2 }; })()`);
    const click = async (expression, modifiers = 0) => {
      const { x, y } = await center(expression);
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers });
    };
    const ALT = 1, META = 4;
    const key = async (keyName, modifiers = 0) => {
      const code = { Enter: 13, Escape: 27 }[keyName];
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code, modifiers, ...(keyName === 'Enter' && !modifiers ? { text: '\r' } : {}) });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code, modifiers });
    };
    const write = (text) => call('Input.insertText', { text });
    const loaded = () => cdp.once('Page.loadEventFired');
    const frames = () => evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))');
    // How far one thing is from another on screen; it must not change while the page scrolls.
    const gap = (a, b) => evaluate(`(() => { const one = (${a}).getBoundingClientRect(), two = (${b}).getBoundingClientRect(); return { x: Math.round(one.left - two.left), y: Math.round(one.top - two.top) }; })()`);
    const PANEL = `document.getElementById('__artifact-review').shadowRoot`;
    const CARD = `${PANEL}.querySelector('.card')`, OUTLINE = `${PANEL}.querySelector('.box.target')`, SELBTN = `${PANEL}.querySelector('.selbtn')`;

    let load = loaded();
    await call('Page.navigate', { url: server.url });
    await load;
    await until(`document.getElementById('__artifact-review')?.shadowRoot.querySelector('.status').textContent === 'Pi is ready'`, 'the panel to connect');
    assert.equal(await evaluate('window.pageLoads'), 1);

    // Option-click a heading: a card for it, with its section.
    await click(`document.querySelectorAll('h3')[0]`, ALT);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'the note card');
    assert.equal(await ui(`ui.querySelector('.card .what').textContent`), 'h3 “Book travel separately”');
    // Scrolling the page carries the card and the outline with the heading.
    const heading3 = `document.querySelectorAll('h3')[0]`;
    const cardGap = await gap(CARD, heading3);
    await evaluate('scrollBy(0, 150)');
    await frames();
    assert.equal(await evaluate('scrollY'), 150);
    assert.deepEqual(await gap(CARD, heading3), cardGap, 'the card scrolls with its heading');
    assert.deepEqual(await gap(OUTLINE, heading3), { x: -2, y: -2 }, 'the outline scrolls with its heading');
    await evaluate('scrollTo(0, 0)');
    await frames();
    await write('put this first');
    await key('Enter');
    assert.equal(await ui(`ui.querySelectorAll('.queue li').length`), 1);
    assert.equal(await ui(`ui.querySelector('.card').hidden`), true);

    // A plain click still works the page's own tab.
    await click(`document.querySelectorAll('.tab')[1]`);
    assert.equal(await evaluate(`document.querySelectorAll('.tab')[1].getAttribute('aria-pressed')`), 'true');
    assert.equal(await ui(`ui.querySelector('.card').hidden`), true);

    // Option-click a link: a note, not a visit.
    await click(`document.getElementById('link')`, ALT);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'the link card');
    assert.equal(await evaluate('location.href'), server.url);
    await write('link to the source instead');
    await key('Enter');

    // Inside a box that scrolls on its own, the card follows too.
    await click(`document.getElementById('deep')`, ALT);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'the card in the scrolling box');
    const deep = `document.getElementById('deep')`;
    const deepGap = await gap(CARD, deep);
    await evaluate(`document.getElementById('inner').scrollTop = 40`);
    await frames();
    assert.deepEqual(await gap(CARD, deep), deepGap, 'the card follows a box scrolled inside the page');
    assert.deepEqual(await gap(OUTLINE, deep), { x: -2, y: -2 });
    await key('Escape');
    assert.equal(await ui(`ui.querySelector('.card').hidden`), true, 'Escape closes an empty card');

    // Select text: an "Add note" button, then a card for the selection.
    await evaluate(`(() => { const range = document.createRange(); range.selectNodeContents(document.getElementById('drive').firstChild); getSelection().removeAllRanges(); getSelection().addRange(range); })()`);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.selbtn').hidden`, 'the Add note button');
    const drive = `document.getElementById('drive')`;
    const buttonGap = await gap(SELBTN, drive);
    await evaluate('scrollBy(0, 100)');
    await frames();
    assert.deepEqual(await gap(SELBTN, drive), buttonGap, 'the Add note button scrolls with the selected text');
    await evaluate('scrollTo(0, 0)');
    await frames();
    await click(`document.getElementById('__artifact-review').shadowRoot.querySelector('.selbtn')`);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'the selection card');
    assert.match(await ui(`ui.querySelector('.card .what').textContent`), /^Text “Google's drive time/);
    await write('say how far off, in minutes');
    await key('Enter');
    await ui(`(ui.querySelector('.pagenote').value = 'darker colours', ui.querySelector('.pagenote').dispatchEvent(new Event('input')))`);
    assert.equal(await ui(`ui.querySelector('.send').textContent`), 'Send 4 notes to Pi');
    if (process.env.ARTIFACT_REVIEW_SHOT) {
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(process.env.ARTIFACT_REVIEW_SHOT, Buffer.from(data, 'base64'));
    }

    await click(`document.getElementById('__artifact-review').shadowRoot.querySelector('.send')`);
    await until(`document.getElementById('__artifact-review').shadowRoot.querySelector('.message').textContent.startsWith('Sent 4 notes.')`, 'the sent message');
    assert.equal(deliveries.length, 1);
    const [heading, link, selection, page] = deliveries[0].notes;
    assert.deepEqual(heading, {
      kind: 'element', note: 'put this first',
      target: { tag: 'h3', selector: 'body > h3', text: 'Book travel separately', label: undefined, heading: '6. What this means' },
      screen: { pressed: ['Passives (A)'], pickers: [{ label: 'Day', value: 'Tue 14 Oct · 9 bookings' }] },
    });
    assert.deepEqual(link.target, { tag: 'a', selector: '#link', text: 'a link', label: undefined, heading: 'Book travel separately' });
    assert.deepEqual(link.screen.pressed, ['Monthlies (C): a late day'], 'the note says which tab was showing');
    assert.equal(selection.kind, 'selection');
    assert.equal(selection.quote, "Google's drive time is good enough to plan with.");
    assert.equal(selection.target.selector, '#drive');
    assert.deepEqual(page, { kind: 'page', note: 'darker colours', screen: { pressed: ['Monthlies (C): a late day'], pickers: [{ label: 'Day', value: 'Tue 14 Oct · 9 bookings' }] } });
    assert.equal(await ui(`ui.querySelectorAll('.queue li').length`), 0);

    // A change in the folder reloads the page where it was.
    await evaluate('scrollTo(0, 1500)');
    load = loaded();
    writeFileSync(join(folder, 'index.html'), PAGE.replace('Bottom of the page', 'Bottom, edited'));
    await load;
    await until(`window.pageLoads === 2 && document.getElementById('bottom').textContent === 'Bottom, edited'`, 'the reloaded page');
    await until(`Math.abs(scrollY - 1500) < 2`, 'the scroll position to return');
    await until(`document.getElementById('__artifact-review').shadowRoot.querySelector('.status').textContent === 'Page updated'`, 'the updated status');

    // A half-written note holds the reload until it is added.
    await click(`document.getElementById('bottom')`, ALT);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'the card at the bottom');
    await write('half written');
    writeFileSync(join(folder, 'index.html'), PAGE.replace('Bottom of the page', 'Bottom, edited twice'));
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.banner').hidden`, 'the page-changed banner');
    assert.equal(await evaluate('window.pageLoads'), 2, 'no reload while a note is being written');
    load = loaded();
    await key('Enter');
    await load;
    await until(`window.pageLoads === 3 && document.getElementById('bottom').textContent === 'Bottom, edited twice'`, 'the held reload');
    assert.equal(await ui(`ui.querySelectorAll('.queue li').length`), 1, 'the note added before reloading is kept');

    // While Pi waits for the person to confirm a batch, a note added on the page stays and a change waits.
    await click(`document.getElementById('__artifact-review').shadowRoot.querySelector('.queue li button')`);
    assert.equal(await ui(`ui.querySelectorAll('.queue li').length`), 0);
    await evaluate('scrollTo(0, 0)');
    await frames();
    await click(`document.querySelectorAll('h3')[0]`, ALT);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'a card for the batch');
    await write('first batch');
    await key('Enter');
    let confirm;
    confirmation = new Promise((done) => { confirm = done; });
    await click(`document.getElementById('__artifact-review').shadowRoot.querySelector('.send')`);
    for (const deadline = Date.now() + 5000; deliveries.length < 2; await sleep(20)) {
      if (Date.now() > deadline) assert.fail('timed out waiting for the batch to reach Pi');
    }
    await click(`document.querySelectorAll('h3')[0]`, ALT);
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.card').hidden`, 'a card while the batch waits');
    await write('added while Pi asks');
    await key('Enter');
    writeFileSync(join(folder, 'index.html'), PAGE.replace('Bottom of the page', 'Bottom, edited three times'));
    await until(`!document.getElementById('__artifact-review').shadowRoot.querySelector('.banner').hidden`, 'the change to wait for the batch');
    assert.equal(await evaluate('window.pageLoads'), 3, 'no reload while a batch waits for Pi');
    load = loaded();
    confirm();
    await load;
    await until(`window.pageLoads === 4 && document.getElementById('bottom').textContent === 'Bottom, edited three times'`, 'the reload after the batch');
    assert.deepEqual(deliveries[1].notes.map((note) => note.note), ['first batch']);
    assert.equal(await ui(`ui.querySelectorAll('.queue li').length`), 1, 'the note added while Pi asked is kept');
    assert.match(await ui(`ui.querySelector('.queue li').textContent`), /added while Pi asks/);

    // When the review stops, the panel says so and Send is off.
    await server.close();
    await until(`document.getElementById('__artifact-review').shadowRoot.querySelector('.status').textContent.startsWith('Review stopped')`, 'the stopped status');
    assert.equal(await ui(`ui.querySelector('.send').disabled`), true);
  } finally {
    cdp.ws.close();
    const exited = chrome.exitCode === null ? new Promise((done) => chrome.once('exit', done)) : null;
    chrome.kill();
    await exited;
    await server.close();
  }
});
