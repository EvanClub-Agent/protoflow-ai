import type { AiChatMessage } from '../store/useAiChatStore';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { RequirementSource } from '../proto/database/requirementReview';

export function isResumeCommand(text: string) {
  return /^(继续任务|继续生成剩余页面|恢复生成)[。！!]?$/u.test(text.trim());
}

const ATTACHED_NOTES_BADGE_PATTERN = /\n\n📎 已附带关联笔记：[\s\S]*$/u;

export function stripMessageUiChrome(text: string) {
  return text.replace(ATTACHED_NOTES_BADGE_PATTERN, '').trim();
}

export function databaseRequirementSources(snapshot:ProjectStateSnapshot, messages:AiChatMessage[], pageId?:string) {
  const sources = new Map<string,RequirementSource>();
  function add(id:string, label:string, text:string) {
    if (text.trim()) sources.set(id,{id,label,text});
  }
  // Clarifications can refer to earlier turns. Keep the user's original messages
  // since the last applied change; earlier accepted sources are already in the project.
  let begin = messages.length;
  while (begin > 0 && !messages[begin-1].changedDoc && !messages[begin-1].projectReviewDecision) begin--;
  for (const m of messages.slice(begin)) if (m.role==='user') {
    const cleanText = stripMessageUiChrome(m.text);
    if (!isResumeCommand(cleanText) && !/^沿用原方案[。！!]?$/.test(cleanText)) add('message:'+m.id, m.kind==='project'?'项目对话原文':'页面对话原文',cleanText);
    for (const image of m.images ?? []) {
      const id = 'image:'+m.id+':'+image.id;
      sources.set(id,{id,label:'随消息发送的图片',text:image.name,kind:'image'});
    }
    for (const map of m.mindmaps ?? []) {
      // Reuse the original source record only for the same map and identical sent contents.
      // A changed diagram remains a separate revision with its own original text.
      const prior = [...sources.values(), ...(snapshot.databaseRequirements ?? [])].find(r =>
        r.id.startsWith('map:') && r.id.slice(r.id.indexOf(':',4) + 1) === map.mindmapId && r.text === map.source);
      add(prior ? prior.id : 'map:'+m.id+':'+map.mindmapId, '随消息发送的脑图 '+map.title, map.source);
    }
  }
  for (const p of snapshot.projectPlan?.pages ?? []) if ((!pageId || p.pageId===pageId) && snapshot.projectPlan?.approved)
    add('plan:'+p.pageId,'已确认页面需求 '+p.title,p.requirements);
  for (const n of snapshot.stickyNotes) if (n.active && (!pageId || n.pageId===pageId))
    add('sticky:'+n.id,'启用的需求便签 '+n.targetWidgetName,n.text);
  return [...sources.values()];
}
