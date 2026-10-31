#!/usr/bin/env node
/**
 * 温度 A/B：用**真实的复核 prompt**跑同一批日常输入，比较不同 temperature 下
 * 复核能否稳定产出合法 JSON、改写是否还守着发送契约、以及输出味道有没有变。
 *
 * 只读、不发消息、不写生产数据库。生成端在你自己机器上跑。
 *
 *   node tools/voice-ab.mjs --dry                      # 只打印 prompt，不联网
 *   node tools/voice-ab.mjs                            # 默认 0.6,0.9,1.2
 *   node tools/voice-ab.mjs --temps 0.4,0.7 --out .ab  # 自定义
 *
 * 环境变量：FY_MODEL_URL（默认 http://127.0.0.1:11435）、FY_MODEL_NAME
 * （默认 DeepSeek-V4.1-Flash）、FY_MODEL_TOKEN（必需，只从环境读，不落盘）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conversationReviewPrompt } from '../modules/conversation/index.mjs'
import { applyReviewDecision } from '../modules/conversation/decision.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)])
  return acc
}, []))

const fixturesPath = args.fixtures || join(HERE, 'voice-ab.fixtures.jsonl')
const temps = String(args.temps || '0.6,0.9,1.2').split(',').map(Number)
const outDir = args.out || join(HERE, '..', '.voice-ab')
const limit = Number(args.limit) || Infinity

// 判词/客服腔的机械特征。命中的是"结构"，不是词。
const BAN = [
  [/不是[^，。！？]{1,12}，是/, '不是X是Y'],
  [/真(?:正)?[^，。！？]{1,8}的人不/, '真X的人不'],
  [/账|筹码|价码|蝼蚁|棋子|本尊/, '万能名词'],
  [/就这|你急了|先活过/, '旧梗'],
  [/辛苦[了啦]|注意休息|早点休息|有什么可以帮/, '客服腔'],
]

const grams = (s, n = 6) => { const t = String(s).replace(/\s+/g, ''); const set = new Set(); for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n)); return set }

function readFixtures() {
  const raw = readFileSync(fixturesPath, 'utf8').split('\n').filter((l) => l.trim())
  return raw.slice(0, limit).map((line, i) => {
    const f = JSON.parse(line)
    return { id: f.id || String(i + 1), userText: f.userText, draft: f.draft || '嗯，知道了。', scene: f.scene || 'private', direct: f.direct !== false }
  })
}

function promptFor(f) {
  return conversationReviewPrompt({
    userText: f.userText, draft: f.draft, scene: f.scene, direct: f.direct,
    recent: [{ role: 'user', uid: '100001', text: f.userText, direct: f.direct }],
    personaCore: '', catalog: [], voiceEnabled: false,
  })
}

async function ask(f, temperature) {
  const url = (process.env.FY_MODEL_URL || 'http://127.0.0.1:11435').replace(/\/$/, '') + '/v1/chat/completions'
  const body = {
    model: process.env.FY_MODEL_NAME || 'DeepSeek-V4.1-Flash',
    stream: false, temperature,
    max_tokens: 1200,
    messages: [
      { role: 'system', content: '方源复核这句是否接得对' },
      { role: 'user', content: promptFor(f) },
    ],
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.FY_MODEL_TOKEN ? { Authorization: 'Bearer ' + process.env.FY_MODEL_TOKEN } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) throw new Error('http_' + r.status + ' ' + (await r.text()).slice(0, 200))
  const out = await r.json()
  return out.choices?.[0]?.message?.content || ''
}

function parse(raw) {
  try { return { ok: true, value: JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')) } } catch { return { ok: false, value: null } }
}

function score(rows) {
  const n = rows.length || 1
  const texts = rows.filter((r) => r.text).map((r) => r.text)
  const freq = new Map()
  for (const t of texts) for (const g of grams(t)) freq.set(g, (freq.get(g) || 0) + 1)
  const repeated = [...freq.values()].filter((c) => c > 1).length
  const hits = {}
  for (const [re, name] of BAN) {
    const count = texts.filter((t) => re.test(t)).length
    if (count) hits[name] = count
  }
  const lengths = texts.map((t) => [...t].length).sort((a, b) => a - b)
  return {
    jsonRate: rows.filter((r) => r.jsonOk).length / n,
    rewriteRate: rows.filter((r) => r.rewritten).length / n,
    contractRejected: rows.filter((r) => /^kept_(?!direct_silence)/.test(r.status || '')).length / n,
    repeat6: texts.length ? repeated / Math.max([...freq.keys()].length, 1) : 0,
    banHits: hits,
    avgChars: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
    medianChars: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0,
    splitRate: texts.filter((t) => t.includes('\n')).length / n,
    periodEnd: texts.filter((t) => /[。.]$/.test(t)).length / n,
  }
}

const pct = (x) => (x * 100).toFixed(0) + '%'

async function main() {
  const fixtures = readFixtures()
  if (args.dry) {
    console.log(`[dry] ${fixtures.length} 条 fixture，${temps.length} 个温度，共 ${fixtures.length * temps.length} 次调用`)
    console.log(promptFor(fixtures[0]))
    return
  }
  if (!process.env.FY_MODEL_TOKEN) {
    console.error('缺少 FY_MODEL_TOKEN。先在这台机器的环境里设置（不要写进仓库）。')
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })
  const rawLog = [], report = []

  for (const t of temps) {
    const rows = []
    for (const f of fixtures) {
      const raw = await ask(f, t).catch((e) => { throw new Error(`T=${t} ${f.id}: ${e.message}`) })
      const parsed = parse(raw)
      const decision = parsed.ok ? parsed.value : null
      const applied = decision?.change === true && typeof decision.text === 'string'
        ? applyReviewDecision(f.draft, decision, { direct: f.direct, catalog: [], voiceEnabled: false })
        : { text: f.draft, status: 'kept' }
      const row = {
        temp: t, id: f.id, userText: f.userText, draft: f.draft, raw,
        jsonOk: parsed.ok, rewritten: !!applied && applied.text !== f.draft,
        status: applied.status, text: applied.text,
      }
      rows.push(row); rawLog.push(row)
    }
    report.push({ temp: t, ...score(rows) })
  }

  writeFileSync(join(outDir, 'voice-ab-raw.jsonl'), rawLog.map((r) => JSON.stringify(r)).join('\n') + '\n')

  const lines = [
    '# 温度 A/B 报告',
    '',
    `fixtures: ${fixtures.length} 条　温度: ${temps.join(' / ')}　模型: ${process.env.FY_MODEL_NAME || 'DeepSeek-V4.1-Flash'}`,
    '',
    '| 指标 | ' + report.map((r) => `T=${r.temp}`).join(' | ') + ' | 说明 |',
    '| --- | ' + report.map(() => '---').join(' | ') + ' | --- |',
    ...(() => {
      const row = (label, get, note) => `| ${label} | ` + report.map((r) => get(r)).join(' | ') + ` | ${note} |`
      return [
        row('JSON 合法率', (r) => pct(r.jsonRate), '越低说明复核越会失效，草稿直接放行'),
        row('实际改写率', (r) => pct(r.rewriteRate), '复核真正改了多少条'),
        row('发送契约被拒', (r) => pct(r.contractRejected), '标签/媒体不合法而被退回原草稿的比例'),
        row('6 字重复率', (r) => pct(r.repeat6), '**越高越像复读**，temperature 治不了这个'),
        row('判词/客服腔', (r) => Object.entries(r.banHits).map(([k, v]) => `${k}×${v}`).join('、') || '0', '结构复读的直接证据'),
        row('平均字数', (r) => String(r.avgChars), '中位数 ' + report.map((x) => x.medianChars).join(' / ')),
        row('分条率', (r) => pct(r.splitRate), '输出里含换行=分条发送'),
        row('句号结尾', (r) => pct(r.periodEnd), '越高越像书面语'),
      ]
    })(),
    '',
    '## 读法',
    '',
    '- **JSON 合法率下降**：说明抬高 temperature 会复活"复核失效→出戏草稿放行"，这条是硬否决。',
    '- **6 字重复率随温度上升**：说明温度不是复读的解药，只是换了一种失败方式。',
    '- **判词/客服腔不随温度下降**：说明病根在条件（prompt/上下文），不在采样。',
    '- 原始输出在 `voice-ab-raw.jsonl`，人工打分请对照 `id` 逐条看。',
  ]
  writeFileSync(join(outDir, 'voice-ab-report.md'), lines.join('\n') + '\n')
  console.log(lines.join('\n'))
  console.log(`\n原始输出：${join(outDir, 'voice-ab-raw.jsonl')}`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })