import type { AiChatMessage } from '../store/useAiChatStore';
import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { RequirementSource } from '../proto/database/requirementReview';
import { tr } from '../i18n/runtime';

export function isResumeCommand(text: string) {
  const t = text.trim();
  return /^(继续任务|继续生成剩余页面|恢复生成)[。！!]?$/u.test(t) ||
    /^(?:continue(?:\s+task|\s+generating(?:\s+remaining\s+pages)?)?|resume(?:\s+generation|\s+task)?)[.!]*$/i.test(t);
}

const ATTACHED_NOTES_BADGE_PATTERN = /\n\n📎 (?:已附带关联笔记：|Attached notes: )[\s\S]*$/u;

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
    if (!isResumeCommand(cleanText) && !/^(?:沿用原方案|keep(?:\s+the)?\s+original\s+plan)[。！!.]*$/iu.test(cleanText)) {
      add('message:'+m.id, m.kind==='project' ? tr('项目对话原文', 'Project chat message') : tr('页面对话原文', 'Page chat message'), cleanText);
    }
    for (const image of m.images ?? []) {
      const id = 'image:'+m.id+':'+image.id;
      sources.set(id,{id,label:tr('随消息发送的图片', 'Attached image'),text:image.name,kind:'image'});
    }
    for (const map of m.mindmaps ?? []) {
      // Reuse the original source record only for the same map and identical sent contents.
      // A changed diagram remains a separate revision with its own original text.
      const prior = [...sources.values(), ...(snapshot.databaseRequirements ?? [])].find(r =>
        r.id.startsWith('map:') && r.id.slice(r.id.indexOf(':',4) + 1) === map.mindmapId && r.text === map.source);
      add(prior ? prior.id : 'map:'+m.id+':'+map.mindmapId, tr('随消息发送的脑图 '+map.title, 'Attached mindmap '+map.title), map.source);
    }
  }
  for (const p of snapshot.projectPlan?.pages ?? []) if ((!pageId || p.pageId===pageId) && snapshot.projectPlan?.approved)
    add('plan:'+p.pageId, tr('已确认页面需求 '+p.title, 'Confirmed page requirement '+p.title), p.requirements);
  for (const n of snapshot.stickyNotes) if (n.active && (!pageId || n.pageId===pageId))
    add('sticky:'+n.id, tr('启用的需求便签 '+n.targetWidgetName, 'Active sticky note '+n.targetWidgetName), n.text);
  return [...sources.values()];
}
