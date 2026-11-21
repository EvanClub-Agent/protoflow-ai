import { create } from 'zustand';
import { newId } from '../utils/identity';
import { tr } from '../i18n/runtime';
import { captureRuntimeError } from './runtimeDiagnostics';
import { encodePflowBinary, type PflowBinaryPayload, type PflowProjectMetadata } from '../utils/pflowBinaryCodec';
import { validateProjectPayload } from './projectValidation';

export const useProjectSaveStore = create<{
  status: 'idle' | 'saved' | 'pending' | 'saving' | 'error';
  error: string;
  savedAt: string | null;
}>(() => ({ status: 'idle', error: '', savedAt: null }));

export interface ProjectSaveBridge {
  saveCurrentProject(input: { projectId: string; dirPath: string; fileName: string; binaryBytes: Uint8Array }): Promise<{ saved: boolean }>;
}

/** One writer per open project. A successful older write never marks newer edits saved. */
export class ProjectAutosave {
  private meta: PflowProjectMetadata | null = null;
  private openId: string | null = null;
  private revision = 0;
  private savedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | null = null;
  private suspended = false;

  constructor(private options: {
    capture: () => PflowBinaryPayload;
    write: ProjectSaveBridge['saveCurrentProject'];
    onSaved: (payload: PflowBinaryPayload, isLatest: boolean) => void;
    delay?: number;
  }) {}

  get dirty() { return this.meta !== null && this.revision !== this.savedRevision; }
  get fileSession() { return this.meta && !this.suspended ? this.openId : null; }
  get liveRevision() { return this.fileSession ? this.fileSession + '/' + this.revision : null; }
  get projectId() { return this.meta?.projectId; }

  assertCanReplace() {
    if (this.dirty || this.writing || this.suspended) throw new Error(tr('当前项目尚未保存完成，请先保存后再切换项目', 'Current project has unsaved changes in progress; save before switching projects'));
  }

  opened(payload: PflowBinaryPayload) {
    this.assertCanReplace();
    this.openId = newId('file-session');
    this.meta = payload.meta;
    this.revision = this.savedRevision = 0;
    useProjectSaveStore.setState({ status: 'saved', error: '', savedAt: payload.meta.updatedAt });
  }

  changed() {
    if (!this.meta) return; // The welcome screen's example state is not a real open file.
    this.revision++;
    useProjectSaveStore.setState({ status: 'pending' });
    // Throttle instead of resetting the deadline on every keystroke.
    if (!this.timer && !this.suspended) this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(() => {}); // Error is retained in the visible save status.
    }, this.options.delay ?? 500);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.suspended) throw new Error(tr('项目正在删除，请等待操作完成', 'Project is being deleted; please wait'));
    if (this.writing) {
      await this.writing;
      return this.flush();
    }
    if (!this.dirty) return;
    const work = this.writeChanges();
    this.writing = work;
    try { await work; } finally { this.writing = null; }
  }

  private async writeChanges() {
    try {
      while (this.dirty) {
        const revision = this.revision;
        const payload = this.options.capture();
        if (!this.meta || payload.meta.projectId !== this.meta.projectId || payload.meta.storageDir !== this.meta.storageDir || payload.meta.fileName !== this.meta.fileName) {
          throw new Error(tr('当前项目与保存目标不一致，已停止写入', 'Current project mismatches save target; write aborted'));
        }
        validateProjectPayload(payload);
        useProjectSaveStore.setState({ status: 'saving' });
        const result = await this.options.write({ projectId: payload.meta.projectId, dirPath: payload.meta.storageDir, fileName: payload.meta.fileName, binaryBytes: encodePflowBinary(payload) });
        if (result.saved !== true) throw new Error(tr('工程未保存成功', 'Failed to save project'));
        this.savedRevision = revision;
        this.options.onSaved(payload, this.revision === revision);
        useProjectSaveStore.setState({ status: this.dirty ? 'pending' : 'saved', error: '', savedAt: payload.meta.updatedAt });
      }
    } catch (error) {
      void captureRuntimeError(error,{category:'storage',code:'PROJECT_SAVE_FAILED',stage:'autosave',context:{projectId:this.meta?.projectId}});
      useProjectSaveStore.setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async beforeDelete(projectId: string) {
    if (this.projectId !== projectId) return;
    await this.flush();
    this.suspended = true;
  }

  afterDelete(projectId: string, deleted: boolean) {
    if (this.projectId !== projectId) return;
    this.suspended = false;
    if (deleted) {
      this.meta = null;
      this.dispose();
      useProjectSaveStore.setState({ status: 'idle', error: '', savedAt: null });
    } else if (this.dirty) this.changed();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
