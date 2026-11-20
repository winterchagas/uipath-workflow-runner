// End-to-end tests: drive the production build in headless Chrome over the DevTools protocol.
// Run with `npm run test:e2e` (builds first). Needs Chrome or Chromium; set CHROME_PATH if it isn't found.
// Set E2E_SCREENSHOTS=<dir> to save a screenshot after each test.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PORT = Number(process.env.E2E_PORT ?? 4179)
const URL_ = `http://localhost:${PORT}/`
const SHOTS = process.env.E2E_SCREENSHOTS
const example = JSON.parse(readFileSync(join(ROOT, 'examples/sketch.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim()
    } catch {}
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(mac)) return mac
  throw new Error('Chrome/Chromium not found; set CHROME_PATH')
}

async function waitUntil(fn, ms, what) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

let server, chrome, profile, ws
let msgId = 0
const pending = new Map()
const pageErrors = []

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  return r.result.result.value
}

const waitFor = (expr, ms = 8000) => waitUntil(() => evaluate(expr), ms, expr)
const click = (expr) => evaluate(`(() => { const el = ${expr}; if (!el) throw new Error('missing: ' + ${JSON.stringify(expr)}); el.click(); return true })()`)
const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`)
const count = (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const menuItem = (label) => `[...document.querySelectorAll('.add-menu button')].find(b => b.textContent.includes(${JSON.stringify(label)}))`

async function seed(workflow) {
  await evaluate(`localStorage.setItem('workflow-runner:v1', ${JSON.stringify(JSON.stringify(workflow))}); location.reload(); true`)
  await sleep(300)
  await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`)
}

/** Press Run, fill the inputs dialog if it appears, and wait for the run to end. */
async function run(inputs = {}) {
  await click(`document.querySelector('.toolbar .run')`)
  if (await waitFor(`!!document.querySelector('.dialog') || document.querySelector('.toolbar .run').textContent.includes('Stop')`)) {
    if (await evaluate(`!!document.querySelector('.dialog')`)) {
      for (const [i, v] of Object.entries(inputs)) {
        await evaluate(`(() => {
          const input = document.querySelectorAll('.dialog input')[${i}]
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(v)})
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()`)
      }
      await click(`document.querySelector('.dialog button[type=submit]')`)
    }
  }
  await waitFor(`!document.querySelector('.toolbar .run').textContent.includes('Stop')`)
  await sleep(400) // let end-of-run animations settle for screenshots
}

const flow = (nodes, edges) => ({
  version: 1,
  nodes: nodes.map((n, i) => ({ position: { x: i * 220, y: 0 }, ...n })),
  edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
  lastInputs: {},
})
const scriptFlow = (code, timeoutMs = 5000) =>
  flow(
    [
      { id: 'start', type: 'start', data: { name: 'Start', inputs: [] } },
      { id: 's', type: 'script', data: { name: 'Script', code, timeoutMs } },
      { id: 'end', type: 'end', data: { name: 'End' } },
    ],
    [
      ['start', 's'],
      ['s', 'end'],
    ],
  )

before(async () => {
  server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  await waitUntil(() => fetch(URL_).then((r) => r.ok), 15000, 'vite preview')

  profile = mkdtempSync(join(tmpdir(), 'wf-e2e-'))
  chrome = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1500,860', 'about:blank'], {
    stdio: 'ignore',
  })
  const devtoolsPort = await waitUntil(
    () => readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0],
    15000,
    'Chrome DevTools port',
  )
  const target = await waitUntil(
    async () => (await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()).find((t) => t.type === 'page'),
    10000,
    'Chrome page',
  )
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 860, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL_ })
  await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`)
  await evaluate(`localStorage.clear(); location.reload(); true`)
  await sleep(300)
  await waitFor(`document.querySelectorAll('.react-flow__node').length > 0`)
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})

after(async () => {
  ws?.close()
  chrome?.kill()
  server?.kill()
  await sleep(200)
  if (profile) rmSync(profile, { recursive: true, force: true })
})

let shot = 0
async function screenshot(name) {
  if (!SHOTS) return
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`), Buffer.from(r.result.data, 'base64'))
}

test('a fresh canvas has a Start and an End node', async () => {
  assert.equal(await count('.react-flow__node-start'), 1)
  assert.equal(await count('.react-flow__node-end'), 1)
  await screenshot('fresh')
})

test('Run is blocked on an invalid graph and lists the problems', async () => {
  await click(`document.querySelector('.toolbar .run')`)
  await waitFor(`document.body.innerText.includes("Can't run")`)
  assert.ok(await evaluate(`document.querySelector('.toolbar .run').classList.contains('is-shaking')`))
  assert.match(await text('.panel.right'), /Start: has no exit/)
  assert.equal(await count('.wf-node.has-problem'), 2)
  await screenshot('blocked')
})

test('the + menu adds a Script node and opens its code editor', async () => {
  await click(`document.querySelector('.toolbar .add')`)
  await waitFor(`getComputedStyle(document.querySelector('.add-menu')).visibility === 'visible'`)
  await screenshot('menu')
  await click(menuItem('Script'))
  await waitFor(`getComputedStyle(document.querySelector('.add-menu')).visibility === 'hidden'`)
  assert.equal(await count('.react-flow__node-script'), 1)
  await waitFor(`!!document.querySelector('.editor .cm-editor')`) // lazily loaded chunk
})

test('sketch with a > b: branches run in parallel and the join runs once', async () => {
  await seed(example)
  await click(`document.querySelector('.toolbar .run')`)
  await waitFor(`!!document.querySelector('.dialog')`)
  assert.equal(await evaluate(`[...document.querySelectorAll('.dialog input')].map(i => i.value).join(',')`), '5,2')
  await click(`document.querySelector('.dialog button[type=submit]')`)
  await waitFor(`!document.querySelector('.dialog')`, 2000)
  await waitFor(`document.querySelector('.toolbar .run').textContent.includes('Stop')`)
  assert.ok(await count('.wf-node.s-running'))
  assert.ok(await count('.react-flow__edge.e-flowing'))
  await screenshot('running')
  await waitFor(`!document.querySelector('.toolbar .run').textContent.includes('Stop')`)
  await sleep(400)

  const out = await text('.panel.right')
  assert.match(out, /Finished in/)
  assert.match(out, /c\s+7/)
  assert.match(out, /d\s+14/)
  assert.match(out, /c is 7/) // console.log captured
  assert.equal(await count('.react-flow__edge.e-skipped'), 1)
  assert.equal(await count('.badge.b-done'), 5)
  await click(`[...document.querySelectorAll('.tabs button')].find(b => b.textContent.includes('Trace'))`)
  assert.equal((await text('.panel.right')).match(/Double started/g)?.length, 1)
  await screenshot('done')
})

test('clicking a node shows its context before and after it ran', async () => {
  await click(`document.querySelector('.react-flow__node[data-id="s2"]')`)
  await waitFor(`document.querySelector('.panel.left').innerText.includes('after')`)
  assert.equal(await count('.panel.left tr.changed'), 1)
  assert.match(await text('.panel.left tr.changed'), /d\s+14/)
  await screenshot('node-context')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`)
  await waitFor(`!document.querySelector('.editor')`)
})

test('sketch with a <= b: the join still runs from the other branch', async () => {
  await run({ 0: '1', 1: '2' })
  const out = await text('.panel.right')
  assert.match(out, /c\s+3/)
  assert.match(out, /d\s+6/)
  await screenshot('done-false')
})

test('a throwing script fails the run and reports its line', async () => {
  await seed(scriptFlow("console.log('about to fail')\nconst x = 1\nnull.oops"))
  await run()
  const out = await text('.panel.right')
  assert.match(out, /Failed after/)
  assert.match(out, /line 3/)
  assert.match(out, /about to fail/)
  assert.equal(await count('.wf-node.s-failed .badge.b-failed'), 1)
  await screenshot('failed')
})

test('an infinite loop is killed by the script timeout', async () => {
  await seed(scriptFlow('while (true) {}', 500))
  await run()
  assert.match(await text('.panel.right'), /Timed out after 0\.5s/)
})

test('returning a function is rejected', async () => {
  await seed(scriptFlow('return { f: () => 1 }'))
  await run()
  assert.match(await text('.panel.right'), /plain data/)
})

test('Stop cancels a running workflow', async () => {
  await seed(scriptFlow('await new Promise((r) => setTimeout(r, 3000))'))
  await click(`document.querySelector('.toolbar .run')`)
  await waitFor(`document.querySelector('.toolbar .run').textContent.includes('Stop')`)
  await click(`document.querySelector('.toolbar .run')`)
  await waitFor(`document.body.innerText.includes('Stopped')`, 2000)
  assert.equal(await count('.wf-node.s-cancelled'), 1)
})

test('no errors were logged by the page', () => {
  assert.deepEqual(pageErrors, [])
})
