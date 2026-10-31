const { useState, useEffect } = React
return function Panel({ toast }) {
  const [state, setState] = useState(null)
  const [scope, setScope] = useState('')
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState(null)
  const [learning, setLearning] = useState(null)
  const load = async (next = scope) => {
    const r = await call('/memory', { scope: next, query })
    if (r.ok) { setState(r); setScope(r.scope) } else toast(r.message)
  }
  useEffect(() => { load(''); call('/profile').then(setProfile); call('/learning').then(setLearning); const timer = setInterval(() => call('/learning').then(setLearning), 30000); return () => clearInterval(timer) }, [])
  return h('div', null,
    h(ui.Card, { title: '每日学习与原著研读', desc: '每天凌晨 4 点复盘前一天；离线后补跑任务并补看可取得的消息。原著已收录与已经研读分别计数。' },
      learning?.ok ? h('div', null,
        learning.unrestrictedUsage ? h('p', null, '持续研读已启用：不设每日或累计 token、积分及调用次数上限；实际用量照常记录。') : null,
        h('p', null, '已收录 ' + learning.messages + ' 条消息，整理 ' + learning.items + ' 条理解；记忆语义索引 ' + learning.embeddings.indexed + '/' + learning.embeddings.total + '。'),
        h('p', null, '原著研读 ' + (learning.jobs.find((j) => j.kind === 'book' && j.status === 'done')?.n || 0) + '/' + (learning.book?.batches || 0) + ' 批，已保存 ' + learning.bookClaims + ' 条带引文的理解。全书理解仍需持续核对。'),
        h('p', null, '已完成分批研读的完整章节：' + (learning.bookProgress?.completedChapters || 0) + '/' + (learning.bookProgress?.totalChapters || 0) + '；每卷读完后继续复核前后因果与人物变化。'),
        h('p', null, '每日复盘完成 ' + (learning.jobs.find((j) => j.kind === 'daily' && j.status === 'done')?.n || 0) + ' 批；待查词语 ' + learning.terms.filter((t) => ['pending', 'failed'].includes(t.status)).reduce((n, t) => n + t.n, 0) + ' 个。'),
        h('p', { className: 'ab-muted ab-small' }, learning.pendingReasons?.some((j) => /budget|reserve_wait/.test(j.error)) ? '后台学习已保存进度，等待费用预留恢复；正常聊天继续。最早重试：' + new Date(Math.min(...learning.pendingReasons.filter((j) => /budget|reserve_wait/.test(j.error)).map((j) => j.retryAt))).toLocaleString('zh-CN', { timeZone: 'Asia/Taipei' }) : learning.worker?.ok === false ? '任务保留续跑。当前原因：' + learning.worker.error : '学习结果保留原句来源；私人内容不会进入其他人的会话。'),
        learning.coverage.some((c) => c.status !== 'covered') ? h('p', null, '部分离线消息仍有覆盖缺口，方源会如实说明。') : null) : h('p', null, '学习模块尚未就绪。')),
    h(ui.Card, { title: '主动昵称、签名与头像', desc: '方源会按关系、场合与自己的意愿接受或拒绝请求，也可主动改变公开资料。后台定期考虑，不强迫每天变更；收到提议可另行判断。' },
      profile ? h('div', null,
        h('label', null, h('input', { type: 'checkbox', checked: profile.nickname, onChange: (e) => setProfile({ ...profile, nickname: e.target.checked }) }), ' 允许主动考虑修改昵称'), h('br'),
        h('label', null, h('input', { type: 'checkbox', checked: profile.signature, onChange: (e) => setProfile({ ...profile, signature: e.target.checked }) }), ' 允许主动考虑修改签名'), h('br'),
        h('label', null, h('input', { type: 'checkbox', checked: profile.avatar, onChange: (e) => setProfile({ ...profile, avatar: e.target.checked }) }), ' 允许从已配置公开素材主动考虑换头像'),
        h('p', { className: 'ab-muted ab-small' }, '可用公开头像素材：' + profile.publicAvatarCount + ' 个。成功采用的头像会归档；新提议也可使用当前聊天图片或图片网址。'),
        h(ui.Btn, { onClick: async () => { const r = await call('/profile/settings', { autonomousNickname: profile.nickname, autonomousSignature: profile.signature, autonomousAvatar: profile.avatar }); toast(r.message) } }, '保存主动资料设置')) : null),
    h(ui.Card, { title: '共享人物印象与消息来源', desc: '同QQ号的群聊和私聊共同积累印象、交情与好感。这里按来源会话查证经历；私密原话保留在原会话，不代表把同一个人分成两套关系。' },
    state ? h('p', null, '交互来源 ' + state.counts.events + ' 条；当前有效摘要 ' + state.counts.activeFacts + ' 条。') : null,
    h('div', { className: 'ab-flex' },
      h('select', { className: 'ab-input', value: scope, 'aria-label': '记忆会话', onChange: (e) => load(e.target.value) },
        (state?.scopes || []).map((s) => h('option', { key: s, value: s }, s))),
      h('input', { className: 'ab-input', value: query, 'aria-label': '搜索分场景记忆', placeholder: '搜索原话或摘要', onChange: (e) => setQuery(e.target.value) }),
      h(ui.Btn, { onClick: () => load() }, '查询')),
    h('h4', null, '摘要与偏好'),
    ...(state?.facts || []).map((f) => h('div', { key: f.id, className: 'ab-card', style: { marginBottom: 8, opacity: f.active ? 1 : 0.65 } },
      h('b', null, f.uid + ' · ' + (f.active ? '有效' : '已停用') + ' · ' + f.authority),
      h('p', null, f.text), h('p', { className: 'ab-muted ab-small' }, '来源原话：' + f.quote),
      h('div', { className: 'ab-muted ab-small' }, f.event + ' · ' + new Date(f.at).toLocaleString()),
      !f.forgotten ? h(ui.Btn, { small: true, onClick: async () => { const r = await call('/memory/forget', { scope: f.scope, factId: f.id }); toast(r.message); if (r.ok) load() } }, '停止召回此来源') : null)),
    h('h4', null, '近期交互来源（最多 30 条）'),
    ...(state?.events || []).map((e) => h('div', { key: e.id, className: 'ab-card', style: { marginBottom: 8 } },
      h('b', null, e.uid + ' · ' + new Date(e.at).toLocaleString()), h('p', null, e.text),
      h('div', { className: 'ab-muted ab-small' }, e.id + (e.obsoleteSelfReport ? ' · 已失效旧自述，不召回' : ''))))))
}
