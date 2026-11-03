export const responseStylePolicy = '回复篇幅随当前内容、情绪和对方期待自然变化。招呼、短梗、简单确认可以短接；多个问题、值得展开的想法、情绪或必要细节可以多说几句。把该回应的内容说完整即可，不固定句数、字数或反问结尾，不为凑短而漏答，也不为显得灵活刻意加长或轮换长短。不增加刷屏次数；相关内容可以放在一条消息里自然说完'

const hostGuide = '把这一段当成整体来回：一般说一两句就好，回给最需要回的那个人或者整个话题，不要一条一条地挨个回。'
const hostTail = '要 @ 某个人（对方会收到提醒），写 <at:QQ号>，QQ 号就是上面名字后面括号里的数字。'

/** Change only the known host-owned suffix, leaving quoted and current user text intact. */
export function adaptiveGroupPrompt(content, {chat}={}) {
  if (chat?.kind !== 'group' || !Array.isArray(content)) return content
  let changed = false
  const next = content.map(part => {
    if (part.type !== 'text' || !part.text.startsWith('【群聊 ') || !part.text.endsWith(hostTail)) return part
    const index = part.text.lastIndexOf('\n\n'+hostGuide+'\n大多数时候直接说就行。')
    if (index < 0) return part
    const start = index+2
    changed = true
    return {...part,text:part.text.slice(0,start)+'把这一段当成整体来回，相关内容一起接住，保留各自指向，不逐人刷屏。'+responseStylePolicy+part.text.slice(start+hostGuide.length)}
  })
  return changed ? next : content
}
