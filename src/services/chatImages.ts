import { getHermesApi, type HermesImageAttachment, type HermesImageInput } from './hermesClient';
import type { HermesChatConversation } from './hermesConversation';

export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const CHAT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
export interface ChatImageDraft extends HermesImageInput { preview: string; size: number }
export function validImageReference(image: unknown, scope: HermesChatConversation): image is HermesImageAttachment {
  if (!image || typeof image !== 'object') return false;
  const v = image as HermesImageAttachment;
  return v.projectId === scope.projectId && v.kind === scope.kind && v.threadId === scope.threadId && v.pageId === scope.pageId && v.mindmapId === undefined &&
    typeof v.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.id) &&
    typeof v.name === 'string' && !!v.name.trim() && v.name.length <= 255 &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(v.mimeType) && Number.isInteger(v.size) && v.size > 0 && v.size <= MAX_CHAT_IMAGE_BYTES;
}
export async function readChatImageFiles(files: File[], existingCount: number): Promise<ChatImageDraft[]> {
  if (files.length + existingCount > MAX_CHAT_IMAGES) throw new Error('每条消息最多添加 4 张图片');
  // Validate the entire batch before reading any file; never silently drop one.
  for (const file of files) {
    if (!CHAT_IMAGE_ACCEPT.split(',').includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片');
    if (!file.size || file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('图片不能为空，单张图片不能超过 5 MB');
    if (!file.name.trim() || file.name.length > 255) throw new Error('图片文件名过长或为空，请重命名后重试');
  }
  return Promise.all(files.map(file => new Promise<ChatImageDraft>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => {
      const preview = String(reader.result), image = new Image();
      image.onerror = () => reject(new Error(`图片内容无法识别：${file.name}`));
      image.onload = () => {
        if (image.naturalWidth * image.naturalHeight > 40_000_000) { reject(new Error('图片分辨率过大，请缩小到 4000 万像素以内')); return; }
        resolve({ name: file.name, mimeType: file.type as HermesImageInput['mimeType'], data: preview.slice(preview.indexOf(',') + 1), preview, size: file.size });
      };
      image.src = preview;
    };
    reader.readAsDataURL(file);
  })));
}
export async function saveChatImages(scope: HermesChatConversation, images: ChatImageDraft[]) {
  const api = getHermesApi();
  if (typeof api.saveImages !== 'function') throw new Error('图片功能已更新，请重启桌面应用后再发送');
  const references = await api.saveImages({ ...scope, images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data })) });
  if (!Array.isArray(references) || references.length !== images.length || references.some((image, index) =>
    !validImageReference(image, scope) || image.name !== images[index].name || image.mimeType !== images[index].mimeType || image.size !== images[index].size))
    throw new Error('图片保存结果与当前会话不匹配，未发送');
  return references;
}
