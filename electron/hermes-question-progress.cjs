// Hermes ACP currently sends one elicitation per question without its batch ID.
// Its clarify tool-start carries the declared questions (rawInput, or a JSON
// content block in versions that render tool arguments). Use only a complete
// list and an unambiguous match to the next question; never count pending cards.
class QuestionProgress {
  constructor(runId) {
    this.runId = runId;
    this.batches = new Map();
  }
  observe(update) {
    const id = update.toolCallId;
    if (typeof id !== 'string' || !id) return;
    if (['completed', 'failed'].includes(update.status)) {
      this.batches.delete(id);
      return;
    }
    if (update.sessionUpdate !== 'tool_call' || typeof update.title !== 'string' || !/^clarify(?::|$)/.test(update.title)) return;
    if (this.batches.has(id)) return;
    this.batches.set(id, null); // An unreadable concurrent call still makes attribution ambiguous.
    let args = update.rawInput;
    if (args === undefined || args === null) {
      const blocks = update.content?.filter(block => block.type === 'content' && block.content?.type === 'text');
      if (!Array.isArray(blocks) || blocks.length !== 1) return;
      try { args = JSON.parse(blocks[0].content.text); } catch { return; } // Truncated previews are not a catalogue.
    }
    const questions = args?.questions;
    if (!Array.isArray(questions) || !questions.length || questions.some(item => typeof item?.question !== 'string' || !item.question.trim())) return;
    const messages = questions.map(item => item.question.trim()); // Hermes clarify normalizes question whitespace.
    if (new Set(messages).size !== messages.length) return;
    this.batches.set(id, { messages, current: 0 });
  }
  forQuestion(message) {
    // ACP omits a tool-call reference on elicitation. Concurrent clarify calls
    // cannot be reliably attributed, even if their labels happen to differ.
    if (this.batches.size !== 1) return undefined;
    const [batchId, batch] = [...this.batches][0];
    if (!batch || batch.messages[batch.current] !== message) return undefined;
    return { batchId, current: batch.current + 1, total: batch.messages.length };
  }
  resolve(progress) {
    if (!progress) return;
    const batch = this.batches.get(progress.batchId);
    if (batch && batch.current + 1 === progress.current) batch.current++;
  }
}
module.exports = { QuestionProgress };
