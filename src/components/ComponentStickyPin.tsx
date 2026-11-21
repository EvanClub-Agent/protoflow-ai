import React, { useState, useLayoutEffect, useRef } from 'react';
import {
  Pin,
  Plus,
  CheckSquare,
  Square,
  Trash2,
  X,
  Pencil,
  Check,
} from 'lucide-react';
import { useProtoStore, SelectableWidgetId, PageNodeId } from '../store/useProtoStore';
import { runStickyCompileWithHermes, reportAiError } from '../services/hermesBridge';
import { useI18n } from '../i18n';

/**
 * Formats requirement text for high readability:
 * - Splits multi-clause requirements (by `；`, `;`, or `\n`) into clean scannable bullet points
 * - Uses crisp dark `#0f172a` (`text-slate-900`) 13px text with relaxed line height
 */
export function renderStructuredRequirementText(text: string): React.ReactNode {
  const clauses = text
    .split(/[；;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (clauses.length <= 1) {
    return (
      <div className="text-[13.5px] text-slate-950 font-medium leading-6 break-words whitespace-normal">
        {text}
      </div>
    );
  }

  return (
    <ul className="space-y-2 text-[13.5px] text-slate-950 font-medium leading-6 break-words whitespace-normal">
      {clauses.map((clause, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0 mt-2.5" />
          <span className="flex-1 min-w-0">{clause}</span>
        </li>
      ))}
    </ul>
  );
}

export interface ComponentStickyPinProps {
  widgetId: SelectableWidgetId;
  widgetTitle?: string;
  pageId: PageNodeId;
  position?: 'right' | 'left' | 'bottom';
  badgeLabel?: string;
}

export const ComponentStickyPin: React.FC<ComponentStickyPinProps> = ({
  widgetId,
  widgetTitle,
  pageId,
  position = 'right',
}) => {
  const { tr } = useI18n();
  const {
    stickyNotes,
    widgets,
    showAllComponentPins,
    activePopoverWidgetId,
    setActivePopoverWidgetId,
    toggleStickyRule,
    updateStickyRuleText,
    deleteStickyRule,
  } = useProtoStore();

  const [newNoteText, setNewNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const widgetNotes = stickyNotes.filter((n) => n.pageId === pageId && n.targetWidgetId === widgetId);
  const widgetInfo = widgets[widgetId]?.pageId === pageId ? widgets[widgetId] : undefined;
  const displayTitle =
    widgetTitle ||
    widgetInfo?.name ||
    widgetNotes[0]?.targetWidgetName ||
    widgetId;
  const isOpen = activePopoverWidgetId === widgetId;

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !isOpen) return;
    el.style.transform = 'translateX(0px)';
    const rect = el.getBoundingClientRect();
    const paperEl = el.closest('.pf-paper, .pf-mobile-scope') ?? document.documentElement;
    const boundRect = paperEl.getBoundingClientRect();
    let dx = 0;
    if (rect.right > boundRect.right - 12) {
      dx = boundRect.right - 12 - rect.right;
    }
    if (rect.left + dx < boundRect.left + 12) {
      dx = boundRect.left + 12 - rect.left;
    }
    if (dx !== 0) {
      el.style.transform = `translateX(${Math.round(dx)}px)`;
    }
  }, [isOpen, widgetNotes.length]);

  if (!showAllComponentPins) return null;

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!newNoteText.trim()) return;
    try { await runStickyCompileWithHermes({
      pageId,
      widgetId,
      widgetName: displayTitle,
      text: newNoteText.trim(),
    });
    setNewNoteText(''); } catch (error) { reportAiError(error); }
  };

  const handleSaveEdit = (noteId: string) => {
    if (editingText.trim()) {
      updateStickyRuleText(noteId, editingText.trim());
    }
    setEditingNoteId(null);
  };

  const posClasses =
    position === 'left'
      ? 'right-0 top-7'
      : position === 'bottom'
      ? 'left-0 top-7'
      : 'left-0 top-7';

  return (
    <div
      data-pf-sticky-ui="1"
      className={`relative inline-block select-none ${isOpen ? 'z-50' : 'z-10'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Compact Annotation Trigger Pill (Pin Icon + Count only) */}
      <button
        type="button"
        onClick={() => setActivePopoverWidgetId(isOpen ? null : widgetId)}
        className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums leading-none shadow-2xs transition cursor-pointer border ${
          isOpen
            ? 'bg-amber-400 text-slate-950 border-amber-500 ring-2 ring-amber-400/40'
            : widgetNotes.length > 0
            ? 'bg-amber-100/95 hover:bg-amber-200 text-amber-950 border-amber-300'
            : 'bg-slate-100/95 hover:bg-amber-100 text-slate-700 hover:text-amber-950 border-slate-300'
        }`}
        title={
          widgetNotes.length > 0
            ? tr(`查看或编辑需求便签（${widgetNotes.length} 条）`, `View or edit spec notes (${widgetNotes.length})`)
            : tr('点击添加组件需求便签', 'Click to add widget spec note')
        }
      >
        <Pin className="w-3 h-3 text-amber-700 shrink-0" />
        <span>{widgetNotes.length > 0 ? widgetNotes.length : '+'}</span>
      </button>

      {/* High-Readability Floating Requirement Card */}
      {isOpen && (
        <div
          ref={popoverRef}
          className={`absolute ${posClasses} w-[380px] sm:w-[420px] rounded-2xl bg-white text-slate-900 shadow-2xl border-2 border-amber-300 z-50 overflow-hidden whitespace-normal text-left font-normal`}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded-lg bg-amber-400/30 border border-amber-300 flex items-center justify-center shrink-0">
                <Pin className="w-3.5 h-3.5 text-amber-800" />
              </span>
              <div className="min-w-0">
                <div className="font-bold text-[13px] text-slate-900 truncate">
                  {displayTitle}
                </div>
                <div className="text-[11px] text-amber-900/70 tabular-nums">
                  {tr(`组件需求说明（共 ${widgetNotes.length} 条）`, `Component Spec Notes (${widgetNotes.length})`)}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActivePopoverWidgetId(null)}
              className="p-1 rounded-lg hover:bg-amber-200/60 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
              title={tr('关闭', 'Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Requirement Notes List */}
          <div className="p-4 space-y-3">
            {widgetNotes.length === 0 ? (
              <div className="text-xs text-slate-500 py-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                {tr('暂无需求说明，在下方输入即可为该组件添加需求便签', 'No requirement notes yet — add a spec note for this widget below')}
              </div>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {widgetNotes.map((note) => {
                  const isEditing = editingNoteId === note.id;
                  return (
                    <div
                      key={note.id}
                      className={`p-3.5 rounded-xl border transition ${
                        note.active
                          ? 'bg-amber-50/40 border-amber-200/90'
                          : 'bg-slate-50 border-slate-200 opacity-60 line-through'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <button
                          type="button"
                          onClick={() => toggleStickyRule(note.id)}
                          className="inline-flex items-center gap-1.5 cursor-pointer text-left"
                          title={tr('点击切换需求启用/停用状态（不代表已实现）', 'Toggle active/inactive rule status (does not imply implemented)')}
                        >
                          {note.active ? (
                            <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className="px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-950 font-mono text-[11px] font-bold whitespace-nowrap">
                            {tr(`需求 #${note.index}`, `Spec #${note.index}`)}
                          </span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNoteId(note.id);
                              setEditingText(note.text);
                            }}
                            className="p-1 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                            title={tr('编辑需求内容', 'Edit note')}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteStickyRule(note.id)}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title={tr('删除此条便签', 'Delete note')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-2 mt-1">
                          <textarea
                            rows={3}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full p-2.5 rounded-lg bg-white border border-blue-400 text-[13px] text-slate-900 leading-relaxed focus:outline-none"
                          />
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingNoteId(null)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs cursor-pointer whitespace-nowrap"
                            >
                              {tr('取消', 'Cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(note.id)}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <Check className="w-3 h-3" />
                              <span>{tr('保存', 'Save')}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        renderStructuredRequirementText(note.text)
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add New Note Form */}
            <form onSubmit={handleAddNote} className="pt-1 flex gap-2">
              <input
                type="text"
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder={tr('输入新的需求规则（多条可用分号 ； 分隔）...', 'Enter new requirement rules (separate clauses with ;) ...')}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 focus:bg-white border border-slate-300 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{tr('添加', 'Add')}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
