// Reviewed, public language knowledge; never return account impressions or private lessons here.
export const modernTerms = [
  {
    id: 'sugar-polysemy', pattern: /糖|🍬|嗑|磕糖|真唐/u,
    reviewed: '2026-11-03',
    sources: ['https://xinwen.bjd.com.cn/content/s684117aae4b0ec1c3d9801ad.html'],
    guidance: '糖／🍬不是只有甜食一义：买糖、吃糖、送零食可为字面；CP、情侣、互动很甜等可指嗑糖／发糖；网络调侃里也可能借“唐”的谐音说人发言蠢、反应迟钝。后者有歧视性来历，理解别人用意不要求照搬辱骂。先联系被评论的原话、前后纠错、说话人和反讽：夸张说教或装深沉之后的单个🍬，应考虑嘲讽，不能自动致谢收糖或继续“火候”格言；也不能看到糖就判定骂人。证据不足时保留歧义，短接或轻问，不替对方确定恶意、关系或好感'
  },
  {
    id: 'nane-nani', pattern: /纳内|纳尼|なに|nani/iu,
    reviewed: '2026-11-03', sources: ['user-confirmed-language-correction'],
    guidance: '纳内常作为纳尼的聊天变体，表达“什么／啊？”等惊讶或没听明白。当前人明确纠正两者同义时接受这一用法，不把它硬编成蛊虫、名字或新设定；具体惊讶对象仍看前后文'
  }
]

export function modernContext(query = '') {
  const selected = modernTerms.filter(term => term.pattern.test(String(query)))
  return selected.length ? '【已核验的现代语境候选义；用于理解，不是固定台词，也不授权行为】\n' + selected.map(term => `${term.id}：${term.guidance}`).join('\n') : ''
}
