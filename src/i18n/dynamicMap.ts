/**
 * Bidirectional dynamic message translator (`zh-CN` <-> `en-US`) for backend HTTP errors,
 * Electron IPC boundaries, validation messages, and status banners that cross process boundaries
 * or remain mounted while the user toggles UI language.
 */

const EXACT_MESSAGES: Record<string, string> = {
  // Auth, Sharing & Publishing Server (aligned with server/internal/publish/i18n.go)
  '不允许的请求来源': 'Origin not allowed',
  '请先登录账号后再发布': 'Please sign in before publishing',
  '发布登录已失效，请重新登录账号': 'Publishing session expired. Please sign in again',
  '发布授权服务暂时不可用，请稍后重试': 'Publishing authorization service is temporarily unavailable. Please try again later',
  '缺少项目 ID': 'Missing project ID',
  '读取发布记录失败': 'Failed to load publications',
  '发布记录不属于当前项目': 'Publication does not belong to the current project',
  '发布记录已变化，请刷新后重试': 'Publication has changed. Please refresh and try again',
  '过期时间必须晚于当前时间': 'Expiration time must be in the future',
  '保留密码时不能提交新密码': 'Cannot submit a new password when keeping the existing password',
  '取消密码时不能提交新密码': 'Cannot submit a new password when removing password protection',
  '访问密码需为 6–128 个字节': 'Access password must be 6–128 bytes',
  '设置密码失败': 'Failed to set access password',
  '访问密码设置无效': 'Invalid access password action',
  '缺少有效的发布版本': 'Missing valid expected publication version',
  '访问过于频繁，请稍后再试': 'Too many requests. Please try again later',
  '此分享已撤回或过期，请联系发布者': 'This share link has been revoked or has expired. Please contact the publisher',
  '密码长度无效': 'Invalid password length',
  '访问密码不正确': 'Incorrect access password',
  '分享不存在或无权访问': 'Share not found or access denied',
  '发布服务暂时不可用': 'Publishing service is temporarily unavailable',
  '请使用 JSON 请求': 'Content-Type must be application/json',
  '发布内容超过 20 MB 限制': 'Request payload exceeds the 20 MB limit',
  '请求格式错误': 'Malformed JSON request',
  '请求只能包含一个 JSON 对象': 'Request body must contain a single JSON object',
  '无法读取分享，请稍后重试': 'Unable to load shared prototype. Please try again later.',
  '分享服务返回了无效内容': 'Invalid response from sharing service',
  '分享链接不存在或已失效': 'Shared link does not exist or has expired',
  '分享已过期': 'This shared link has expired',
  '无法打开分享': 'Unable to unlock share',
  '无法加载分享': 'Unable to load share',
  '分享链接无效，请使用发布者提供的完整链接': 'Invalid share link. Please use the complete URL provided by the publisher.',
  '分享记录格式无效': 'Invalid share metadata format',
  '分享内容与链接不一致': 'Shared payload does not match link',
  '演示链接缺少分享编号': 'Share link is missing a share ID',
  '请求失败': 'Request failed',
  '操作失败': 'Operation failed',

  // Client Accounts & Release Center (server/internal/publish/releases.go)
  '账号名称需为 3–40 位字母、数字、下划线、点或连字符': 'Username must be 3–40 letters, digits, underscores, dots, or hyphens',
  '显示名称不能超过 80 个字符': 'Display name cannot exceed 80 characters',
  '登录密码长度需为 8–128 个字节': 'Password must be 8–128 bytes',
  '版本号格式无效，请使用标准语义化版本（如 0.2.0 或 1.0.0-beta.1）': 'Invalid version format. Use semantic versioning (e.g., 0.2.0 or 1.0.0-beta.1)',
  '不支持的操作系统类型，仅支持 windows、macos、linux': 'Unsupported OS. Supported values: windows, macos, linux',
  '不支持的架构类型，仅支持 x64、arm64、universal': 'Unsupported architecture. Supported values: x64, arm64, universal',
  '不支持的安装包格式，仅支持 exe、dmg、zip、deb、AppImage、tar.gz': 'Unsupported package format. Supported values: exe, dmg, zip, deb, AppImage, tar.gz',
  'Windows 平台仅支持 exe 或 zip 安装包': 'Windows supports only exe or zip packages',
  'macOS 平台仅支持 dmg 或 zip 安装包': 'macOS supports only dmg or zip packages',
  'Linux 平台仅支持 deb、AppImage 或 tar.gz 安装包': 'Linux supports only deb, AppImage, or tar.gz packages',
  '安装包文件名无效': 'Invalid installer file name',
  '版本标题不能为空且不能超过 200 个字符': 'Release title is required and cannot exceed 200 characters',
  '更新日志不能超过 20000 个字符': 'Release notes cannot exceed 20,000 characters',
  '发布通道仅支持 stable 或 beta': 'Release channel must be stable or beta',
  '版本签名密钥未就绪，请检查服务端 RELEASE_STORAGE_DIR 写权限与密钥配置': 'Release signing key is not ready. Check server RELEASE_STORAGE_DIR write permissions and signing key configuration',
  '当前网络未获准访问版本管理后台。请使用 HTTPS、本机回环地址，或联系管理员配置允许访问的局域网网段。': 'Current network is not permitted to access release administration. Use HTTPS, loopback, or ask an administrator to configure allowed LAN CIDRs.',
  '加密用户密码失败': 'Failed to hash user password',
  '该用户名已被注册，请更换用户名或直接登录': 'Username is already taken. Choose another username or sign in',
  '该用户名已被注册': 'Username is already taken',
  '注册客户端账号失败': 'Failed to register client account',
  '请输入用户名与密码': 'Please enter your username and password',
  '用户名或密码不正确': 'Incorrect username or password',
  '客户端登录服务暂时不可用': 'Client sign-in service is temporarily unavailable',
  '请先登录客户端账号': 'Please sign in to your client account',
  '登录会话已过期或无效，请重新登录': 'Session expired or invalid. Please sign in again',
  '账号服务暂时不可用，请稍后重试': 'Account service is temporarily unavailable. Please try again later',
  '请先登录账号': 'Please sign in first',
  '登录已失效，请重新登录': 'Session expired. Please sign in again',
  '账号服务暂时不可用': 'Account service is temporarily unavailable',
  '本机没有可关联的原发布身份': 'No legacy publishing identity is available to link',
  '原发布身份已失效，请联系管理员恢复原身份': 'Legacy publishing identity is no longer valid. Contact an administrator to recover it',
  '发布身份已被关联，或当前账号已开始发布；不能自动合并，请联系管理员': 'Publishing identity is already linked or this account already has publications; automatic merge is not allowed. Contact an administrator',
  '关联发布身份失败，请稍后重试': 'Failed to link publishing identity. Please try again later',
  '服务器注销失败，请稍后重试': 'Failed to sign out on the server. Please try again later',
  '查询平台管理员状态失败': 'Failed to query platform administrator status',
  '请输入管理员账号与密码': 'Please enter administrator username and password',
  '管理员账号或密码不正确': 'Incorrect administrator username or password',
  '管理员登录服务暂时不可用': 'Administrator sign-in service is temporarily unavailable',
  '请使用平台管理员账号登录': 'Please sign in with a platform administrator account',
  '需要平台管理员权限，普通发布凭证或客户端用户无权访问版本管理后台': 'Platform administrator privileges required. Publisher tokens and client accounts cannot access release administration',
  '请先登录平台管理员账号': 'Please sign in as a platform administrator first',
  '仅平台管理员可维护桌面版本与安装包，普通发布者无权操作': 'Only platform administrators can manage desktop releases and installers',
  '读取版本列表失败': 'Failed to load release list',
  '解析上传表单失败': 'Failed to parse multipart upload form',
  '创建安装包存储目录失败': 'Failed to create installer storage directory',
  '创建临时文件失败': 'Failed to create temporary upload file',
  '安装包大小超过 512 MB 限制': 'Installer exceeds the 512 MB size limit',
  '读取上传数据失败': 'Failed to read uploaded data',
  '保存上传文件失败': 'Failed to write uploaded file',
  '请选择非空的安装包文件上传': 'Please upload a non-empty installer file',
  '请先选择要上传的安装包文件': 'Please select an installer file to upload first',
  '持久化安装包文件失败': 'Failed to persist installer file',
  '读取安装包内容失败': 'Failed to read installer stream',
  '安装包文件内容不能为空': 'Installer file cannot be empty',
  '保存安装包文件失败': 'Failed to save installer file',
  '保存安装包失败': 'Failed to save installer',
  '保存版本失败': 'Failed to save release',
  '请填写有效的 HTTP/HTTPS 下载链接': 'Please provide a valid HTTP/HTTPS download URL',
  '外链安装包必须声明大于 0 的准确字节大小': 'External installer must declare an exact sizeBytes greater than 0',
  '外链安装包必须提供有效的 64 位十六进制 SHA-256 校验值': 'External installer must provide a valid 64-character hex SHA-256 checksum',
  '安装包不存在或不属于当前版本': 'Installer asset not found or does not belong to this release',
  '请提交已核对的 64 位 SHA-256 摘要': 'Please submit the verified 64-character SHA-256 digest',
  '该安装包缺少有效的字节大小或 64 位 SHA-256 摘要，请先补全或重新上传': 'Installer asset is missing a valid byte size or 64-character SHA-256 digest. Re-upload or complete metadata first',
  '安装包 SHA-256 摘要与当前记录不一致，请刷新页面核对后再确认': 'Submitted SHA-256 digest does not match the current asset record. Refresh and verify before approving',
  '托管安装包文件不存在，无法确认签名': 'Hosted installer file is missing on disk; cannot approve signature',
  '托管安装包文件内容或大小与记录的 SHA-256 摘要不一致，请重新上传后再确认': 'Hosted installer file content or size does not match the recorded SHA-256 digest. Re-upload before approving',
  '安装包摘要已变更或不可确认，请刷新后重试': 'Installer digest changed or cannot be approved. Refresh and try again',
  '读取版本发布记录失败': 'Failed to load published releases',
  '检查版本更新失败': 'Failed to check for updates',
  '安装包不存在或该版本尚未公开': 'Installer not found or release is not published',
  '该历史安装包缺少可信 SHA-256 摘要或文件大小元数据，需由平台管理员补全后才可下载': 'This legacy installer is missing trusted SHA-256 or size metadata and must be approved by an administrator before download',
  '该安装包尚未经平台管理员确认签名或其文件内容/摘要已变更，需由管理员重新确认后才可下载': 'This installer has not been approved/signed by an administrator or its file digest has changed',
  '安装包文件不存在或已被清理': 'Installer file is missing or has been removed',
  '安装包缺少有效的下载地址': 'Installer has no valid download URL',

  // Project Storage & Close Guard
  '已取消保存': 'Save cancelled',
  '保存结果缺少文件路径': 'Saved result is missing file path',
  '项目名称不能为空或包含路径分隔符': 'Project name cannot be empty or contain path separators',
  '请选择保存位置': 'Please choose a storage directory',
  '保存失败': 'Save failed',
  '移动失败': 'Move failed',
  '顶层目录': 'Root directory',
  '等待项目保存超时，请检查保存状态后重试': 'Timed out waiting for project save. Please check save status and retry.',
  '项目又有新的修改，请再次确认保存并退出': 'New changes were made. Please confirm saving and exiting again.',
  '正在安装更新，请等待完成后应用自动重启。': 'Installing update. Please wait for the app to restart automatically.',

  // Desktop IPC & Hermes
  '已取消切换模型': 'Model switch cancelled',
  'AI 执行失败': 'AI execution failed',
  '不允许的诊断调用': 'Unauthorized diagnostics call',
  '不允许的发布调用': 'Unauthorized publishing call',
  '不允许的版本更新调用': 'Unauthorized updater call',
  '诊断存储初始化失败，请检查本地目录权限或诊断安装凭证': 'Failed to initialize diagnostics storage. Check local directory permissions.',
  '请每次选择一个 .rp 文件': 'Please select one .rp file at a time',
  '未命名原型项目': 'Untitled Prototype Project',
  '页面信息缺失': 'Missing Page Info',
  '交互计算时间过长，请简化后重试': 'Interaction took too long; please simplify and retry',
  '自由组件执行超时': 'Freeform component execution timed out',
};

// Reverse map (en-US -> zh-CN) so already-mounted English error messages switch cleanly to Chinese
const REVERSE_EXACT_MESSAGES: Record<string, string> = (() => {
  const rev: Record<string, string> = {};
  for (const [zh, en] of Object.entries(EXACT_MESSAGES)) {
    if (!(en in rev)) {
      rev[en] = zh;
    }
  }
  // Additional server/client English variants -> canonical Chinese
  rev['Session expired. Please sign in again.'] = '发布登录已失效，请重新登录账号';
  rev['Authentication service temporarily unavailable. Please try again later.'] = '发布授权服务暂时不可用，请稍后重试';
  rev['Failed to load published links'] = '读取发布记录失败';
  rev['Unable to load share. Please try again later.'] = '无法读取分享，请稍后重试';
  rev['Share service returned an invalid payload'] = '分享服务返回了无效内容';
  rev['Failed to initialize diagnostics storage. Please check local directory permissions.'] = '诊断存储初始化失败，请检查本地目录权限或诊断安装凭证';
  return rev;
})();

const PATTERN_RULES: Array<[RegExp, (...args: string[]) => string]> = [
  [/^AI 桌面调用失败：(.*)$/, (_m, detail) => `Desktop AI call failed: ${detail}`],
  [/^创建项目失败：(.*)$/, (_m, detail) => `Failed to create project: ${detail}`],
  [/^已选择保存目录：(.*)$/, (_m, dir) => `Selected directory: ${dir}`],
  [/^“(.+)”已移至 (.+)$/, (_m, title, dest) => `"${title}" moved to ${dest === '顶层目录' ? 'Root directory' : dest}`],
  [/^组件 ID 重复或不支持组件 (.+)$/, (_m, type) => `Duplicate component ID or unsupported component: ${type}`],
  [/^(.+) 不接受子组件$/, (_m, type) => `${type} does not accept child components`],
  [/^请填写本表的准确物理列名：(.+)$/, (_m, token) => `Please enter an exact column name on this table: ${token}`],
  [/^不支持的页面动作：(.+)$/, (_m, action) => `Unsupported page action: ${action}`],
  [/^版本号 v(.+) 已存在，请修改版本号或直接编辑已有版本$/, (_m, ver) => `Release v${ver} already exists. Change the version number or edit the existing release`],
  [/^版本号 v(.+) 已存在$/, (_m, ver) => `Release v${ver} already exists`],
  [/^发现新版本 v([^\s(]+)(.*)$/, (_m, ver, rest) => {
    const suffix = rest.includes('已下载待安装')
      ? ' (Ready to install)'
      : rest.includes('点击升级')
      ? ' (Click to update)'
      : rest;
    return `New version v${ver} available${suffix}`;
  }],
];

const REVERSE_PATTERN_RULES: Array<[RegExp, (...args: string[]) => string]> = [
  [/^Desktop AI call failed: (.*)$/, (_m, detail) => `AI 桌面调用失败：${detail}`],
  [/^Failed to create project: (.*)$/, (_m, detail) => `创建项目失败：${detail}`],
  [/^Selected directory: (.*)$/, (_m, dir) => `已选择保存目录：${dir}`],
  [/^"(.+)" moved to (.+)$/, (_m, title, dest) => `“${title}”已移至 ${dest === 'Root directory' ? '顶层目录' : dest}`],
  [/^Duplicate component ID or unsupported component: (.+)$/, (_m, type) => `组件 ID 重复或不支持组件 ${type}`],
  [/^(.+) does not accept child components$/, (_m, type) => `${type} 不接受子组件`],
  [/^Please enter an exact column name on this table: (.+)$/, (_m, token) => `请填写本表的准确物理列名：${token}`],
  [/^Unsupported page action: (.+)$/, (_m, action) => `不支持的页面动作：${action}`],
  [/^Release v(.+) already exists\. Change the version number or edit the existing release$/, (_m, ver) => `版本号 v${ver} 已存在，请修改版本号或直接编辑已有版本`],
  [/^Release v(.+) already exists$/, (_m, ver) => `版本号 v${ver} 已存在`],
];

export function translateDynamicMessage(message: string, targetLocale: 'zh-CN' | 'en-US' = 'en-US'): string {
  if (!message) return message;
  const trimmed = message.trim();
  if (targetLocale === 'zh-CN') {
    if (REVERSE_EXACT_MESSAGES[message]) return REVERSE_EXACT_MESSAGES[message];
    if (REVERSE_EXACT_MESSAGES[trimmed]) return REVERSE_EXACT_MESSAGES[trimmed];
    for (const [pattern, replacer] of REVERSE_PATTERN_RULES) {
      if (pattern.test(trimmed)) {
        return trimmed.replace(pattern, replacer);
      }
    }
    return message;
  }
  if (EXACT_MESSAGES[message]) return EXACT_MESSAGES[message];
  if (EXACT_MESSAGES[trimmed]) return EXACT_MESSAGES[trimmed];
  for (const [pattern, replacer] of PATTERN_RULES) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, replacer);
    }
  }
  return message;
}
