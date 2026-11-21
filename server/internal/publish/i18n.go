package publish

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// isEnRequest reports whether the request's Accept-Language header prefers
// English over Chinese. Empty headers, headers without English, or headers
// where Chinese has higher (or equal-weight earlier) preference return false
// so existing callers without Accept-Language keep Chinese responses.
func isEnRequest(c *gin.Context) bool {
	if c == nil || c.Request == nil {
		return false
	}
	raw := strings.TrimSpace(c.GetHeader("Accept-Language"))
	if raw == "" {
		return false
	}
	bestLang := ""
	bestQ := -1.0
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		segments := strings.Split(part, ";")
		tag := strings.ToLower(strings.TrimSpace(segments[0]))
		if tag == "" {
			continue
		}
		q := 1.0
		validQ := true
		for _, param := range segments[1:] {
			kv := strings.SplitN(strings.TrimSpace(param), "=", 2)
			if len(kv) == 2 && strings.EqualFold(strings.TrimSpace(kv[0]), "q") {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(kv[1]), 64)
				if err != nil || parsed <= 0 || parsed > 1 {
					if err == nil && parsed <= 0 {
						validQ = false
					}
					break
				}
				q = parsed
			}
		}
		if !validQ {
			continue
		}
		primary := tag
		if idx := strings.IndexAny(tag, "-_"); idx >= 0 {
			primary = tag[:idx]
		}
		if primary != "en" && primary != "zh" {
			continue
		}
		if q > bestQ {
			bestQ = q
			bestLang = primary
		}
	}
	return bestLang == "en"
}

func msg(c *gin.Context, zh, en string) string {
	if isEnRequest(c) {
		return en
	}
	return zh
}

var exactZhToEn = map[string]string{
	// http.go
	"不允许的请求来源":                "Origin not allowed",
	"请先登录账号后再发布":              "Please sign in before publishing",
	"发布登录已失效，请重新登录账号":         "Publishing session expired. Please sign in again",
	"发布授权服务暂时不可用，请稍后重试":       "Publishing authorization service is temporarily unavailable. Please try again later",
	"缺少项目 ID":                 "Missing project ID",
	"读取发布记录失败":                "Failed to load publications",
	"发布记录不属于当前项目":             "Publication does not belong to the current project",
	"发布记录已变化，请刷新后重试":          "Publication has changed. Please refresh and try again",
	"过期时间必须晚于当前时间":            "Expiration time must be in the future",
	"保留密码时不能提交新密码":            "Cannot submit a new password when keeping the existing password",
	"取消密码时不能提交新密码":            "Cannot submit a new password when removing password protection",
	"访问密码需为 6–128 个字节":        "Access password must be 6–128 bytes",
	"设置密码失败":                  "Failed to set access password",
	"访问密码设置无效":                "Invalid access password action",
	"缺少有效的发布版本":               "Missing valid expected publication version",
	"访问过于频繁，请稍后再试":            "Too many requests. Please try again later",
	"此分享已撤回或过期，请联系发布者":        "This share link has been revoked or has expired. Please contact the publisher",
	"密码长度无效":                  "Invalid password length",
	"访问密码不正确":                 "Incorrect access password",
	"分享不存在或无权访问":              "Share not found or access denied",
	"发布服务暂时不可用":               "Publishing service is temporarily unavailable",
	"请使用 JSON 请求":             "Content-Type must be application/json",
	"发布内容超过 20 MB 限制":         "Request payload exceeds the 20 MB limit",
	"请求格式错误":                  "Malformed JSON request",
	"请求只能包含一个 JSON 对象":        "Request body must contain a single JSON object",

	// model.go
	"此发布格式不包含项目笔记字段":            "This publication format version does not support project notes",
	"发布笔记必须明确提供，且最多 500 篇":      "Published notes must be explicitly provided (up to 500 notes)",
	"发布笔记图片集合必须是对象":             "Published note assets must be a JSON object",
	"发布笔记图片过多":                  "Too many published note images",
	"发布笔记图片标识或格式无效":             "Invalid published note image ID or MIME type",
	"发布笔记图片内容无效或超过 8 MB":        "Invalid published note image data or image exceeds 8 MB",
	"发布笔记格式无效":                  "Invalid published notes format",
	"发布笔记图标无效":                  "Invalid published note icon",
	"发布笔记优先级无效":                 "Invalid published note priority",
	"发布笔记日期无效":                  "Invalid published note date",
	"发布笔记关联页面格式无效":              "Invalid published note linked page IDs",
	"发布笔记标识、标题、状态或内容无效":         "Invalid published note ID, title, status, or content",
	"发布笔记关联了未发布的页面":             "Published note references an unpublished page",
	"发布内容格式错误或包含不支持的字段":         "Invalid snapshot format or unsupported fields",
	"项目标识、标题、页面或格式版本无效":         "Invalid project ID, title, pages, or format version",
	"页面标识缺失或重复":                 "Missing or duplicate page ID",
	"入口页面不存在":                   "Entry page does not exist",
	"旧版发布格式不包含菜单目录字段":           "Legacy publication format does not support sitemap",
	"旧版发布格式不包含便签字段":             "Legacy publication format does not support sticky notes",
	"发布便签必须明确提供，且最多 10000 条":    "Published sticky notes must be explicitly provided (up to 10,000 items)",
	"便签标识、页面、区域、内容、序号或状态无效":     "Invalid sticky note ID, page, target widget, text, index, or status",
	"表结构与演示数据必须明确提供，可为空":        "Tables and sample rows must be explicitly provided (may be empty)",
	"表结构标识无效":                   "Invalid database table metadata",
	"演示数据缺少表对应的明确数据集":           "Sample rows are missing an explicit dataset for a table",
	"演示数据引用未知表或数据集无效":           "Sample rows reference an unknown table or invalid dataset",
	"演示数据的行 ID 缺失或重复":           "Missing or duplicate sample row ID",
	"表字段格式错误":                   "Invalid table column format",
	"旧版发布格式不包含字段唯一约束":           "Legacy publication format does not support column unique constraints",
	"表字段属性类型无效":                 "Invalid table column property types",
	"表字段 ID 缺失、包含空白或重复":         "Missing, whitespace-padded, or duplicate column ID",
	"表字段标识或属性无效":                "Invalid table column name or attributes",
	"字段 isPrimaryKey 必须是布尔值":    "Column isPrimaryKey must be a boolean",
	"字段 isUnique 必须是布尔值":        "Column isUnique must be a boolean",
	"旧版发布格式不包含表级唯一约束字段":         "Legacy publication format does not support table-level uniqueConstraints",
	"发布内容必须包含完整菜单目录":            "Snapshot must include the full navigation sitemap",
	"发布菜单目录层级过深":                "Sitemap hierarchy exceeds maximum nesting depth",
	"发布菜单节点格式无效":                "Invalid sitemap node format",
	"发布菜单标识、名称或归档状态无效":          "Invalid sitemap item ID, title, or archived flag",
	"发布菜单数量过多":                  "Too many sitemap items",
	"发布菜单目录子节点无效":               "Invalid folder children in sitemap",
	"发布菜单页面字段无效":                "Invalid page fields in sitemap",
	"菜单页面标识缺失或重复":               "Missing or duplicate page ID in sitemap",
	"发布页面与菜单所属目录不一致":            "Published page folder does not match its sitemap parent",
	"发布菜单类型无效":                  "Invalid sitemap item type",
	"发布页面缺少对应的菜单项":              "Published page is missing a corresponding sitemap entry",
	"组件属性嵌套过深":                  "Component props exceed maximum nesting depth",
	"页面包含未支持的代码表达式":             "Page contains unsupported raw code expressions",
	"页面动作格式无效":                  "Invalid page action format",
	"动作名不能为空":                   "Action name cannot be empty",
	"跳转动作指向未发布的页面":              "Navigation action points to an unpublished page",
	"组件属性名无效":                   "Invalid component property name",
	"组件属性无效":                    "Invalid component property value",
	"设计内容超过页面复杂度限制":             "Page exceeds maximum node or nesting complexity",
	"页面节点格式错误":                  "Invalid page node format",
	"页面节点标识或属性缺失":               "Missing page node ID or properties",
	"页面根组件必须是 Page 或 MobilePage":  "Page root component must be Page or MobilePage",
	"页面组件 ID 重复":                "Duplicate component pfId on page",

	// releases.go
	"账号名称需为 3–40 位字母、数字、下划线、点或连字符":                      "Username must be 3–40 letters, digits, underscores, dots, or hyphens",
	"显示名称不能超过 80 个字符":                                   "Display name cannot exceed 80 characters",
	"登录密码长度需为 8–128 个字节":                                "Password must be 8–128 bytes",
	"版本号格式无效，请使用标准语义化版本（如 0.2.0 或 1.0.0-beta.1）":        "Invalid version format. Use semantic versioning (e.g., 0.2.0 or 1.0.0-beta.1)",
	"不支持的操作系统类型，仅支持 windows、macos、linux":                "Unsupported OS. Supported values: windows, macos, linux",
	"不支持的架构类型，仅支持 x64、arm64、universal":                  "Unsupported architecture. Supported values: x64, arm64, universal",
	"不支持的安装包格式，仅支持 exe、dmg、zip、deb、AppImage、tar.gz":     "Unsupported package format. Supported values: exe, dmg, zip, deb, AppImage, tar.gz",
	"Windows 平台仅支持 exe 或 zip 安装包":                       "Windows supports only exe or zip packages",
	"macOS 平台仅支持 dmg 或 zip 安装包":                         "macOS supports only dmg or zip packages",
	"Linux 平台仅支持 deb、AppImage 或 tar.gz 安装包":             "Linux supports only deb, AppImage, or tar.gz packages",
	"安装包文件名无效":                                          "Invalid installer file name",
	"版本标题不能为空且不能超过 200 个字符":                             "Release title is required and cannot exceed 200 characters",
	"更新日志不能超过 20000 个字符":                                "Release notes cannot exceed 20,000 characters",
	"发布通道仅支持 stable 或 beta":                             "Release channel must be stable or beta",
	"版本签名密钥未就绪，请检查服务端 RELEASE_STORAGE_DIR 写权限与密钥配置":     "Release signing key is not ready. Check server RELEASE_STORAGE_DIR write permissions and signing key configuration",
	"当前网络未获准访问版本管理后台。请使用 HTTPS、本机回环地址，或联系管理员配置允许访问的局域网网段。": "Current network is not permitted to access release administration. Use HTTPS, loopback, or ask an administrator to configure allowed LAN CIDRs.",
	"加密用户密码失败":                                    "Failed to hash user password",
	"该用户名已被注册，请更换用户名或直接登录":                        "Username is already taken. Choose another username or sign in",
	"注册客户端账号失败":                                   "Failed to register client account",
	"请输入用户名与密码":                                   "Please enter your username and password",
	"用户名或密码不正确":                                   "Incorrect username or password",
	"客户端登录服务暂时不可用":                                "Client sign-in service is temporarily unavailable",
	"请先登录客户端账号":                                   "Please sign in to your client account",
	"登录会话已过期或无效，请重新登录":                            "Session expired or invalid. Please sign in again",
	"账号服务暂时不可用，请稍后重试":                             "Account service is temporarily unavailable. Please try again later",
	"请先登录账号":                                      "Please sign in first",
	"登录已失效，请重新登录":                                 "Session expired. Please sign in again",
	"账号服务暂时不可用":                                   "Account service is temporarily unavailable",
	"本机没有可关联的原发布身份":                               "No legacy publishing identity is available to link",
	"原发布身份已失效，请联系管理员恢复原身份":                        "Legacy publishing identity is no longer valid. Contact an administrator to recover it",
	"发布身份已被关联，或当前账号已开始发布；不能自动合并，请联系管理员":           "Publishing identity is already linked or this account already has publications; automatic merge is not allowed. Contact an administrator",
	"关联发布身份失败，请稍后重试":                              "Failed to link publishing identity. Please try again later",
	"服务器注销失败，请稍后重试":                               "Failed to sign out on the server. Please try again later",
	"查询平台管理员状态失败":                                 "Failed to query platform administrator status",
	"请输入管理员账号与密码":                                 "Please enter administrator username and password",
	"管理员账号或密码不正确":                                 "Incorrect administrator username or password",
	"管理员登录服务暂时不可用":                                "Administrator sign-in service is temporarily unavailable",
	"请使用平台管理员账号登录":                                "Please sign in with a platform administrator account",
	"需要平台管理员权限，普通发布凭证或客户端用户无权访问版本管理后台":            "Platform administrator privileges required. Publisher tokens and client accounts cannot access release administration",
	"请先登录平台管理员账号":                                 "Please sign in as a platform administrator first",
	"仅平台管理员可维护桌面版本与安装包，普通发布者无权操作":                 "Only platform administrators can manage desktop releases and installers",
	"读取版本列表失败":                                    "Failed to load release list",
	"解析上传表单失败":                                    "Failed to parse multipart upload form",
	"创建安装包存储目录失败":                                 "Failed to create installer storage directory",
	"创建临时文件失败":                                    "Failed to create temporary upload file",
	"安装包大小超过 512 MB 限制":                           "Installer exceeds the 512 MB size limit",
	"读取上传数据失败":                                    "Failed to read uploaded data",
	"保存上传文件失败":                                    "Failed to write uploaded file",
	"请选择非空的安装包文件上传":                               "Please upload a non-empty installer file",
	"持久化安装包文件失败":                                  "Failed to persist installer file",
	"读取安装包内容失败":                                   "Failed to read installer stream",
	"安装包文件内容不能为空":                                 "Installer file cannot be empty",
	"保存安装包文件失败":                                   "Failed to save installer file",
	"请填写有效的 HTTP/HTTPS 下载链接":                      "Please provide a valid HTTP/HTTPS download URL",
	"外链安装包必须声明大于 0 的准确字节大小":                       "External installer must declare an exact sizeBytes greater than 0",
	"外链安装包必须提供有效的 64 位十六进制 SHA-256 校验值":           "External installer must provide a valid 64-character hex SHA-256 checksum",
	"安装包不存在或不属于当前版本":                              "Installer asset not found or does not belong to this release",
	"请提交已核对的 64 位 SHA-256 摘要":                     "Please submit the verified 64-character SHA-256 digest",
	"该安装包缺少有效的字节大小或 64 位 SHA-256 摘要，请先补全或重新上传":    "Installer asset is missing a valid byte size or 64-character SHA-256 digest. Re-upload or complete metadata first",
	"安装包 SHA-256 摘要与当前记录不一致，请刷新页面核对后再确认":          "Submitted SHA-256 digest does not match the current asset record. Refresh and verify before approving",
	"托管安装包文件不存在，无法确认签名":                           "Hosted installer file is missing on disk; cannot approve signature",
	"托管安装包文件内容或大小与记录的 SHA-256 摘要不一致，请重新上传后再确认":    "Hosted installer file content or size does not match the recorded SHA-256 digest. Re-upload before approving",
	"安装包摘要已变更或不可确认，请刷新后重试":                        "Installer digest changed or cannot be approved. Refresh and try again",
	"读取版本发布记录失败":                                  "Failed to load published releases",
	"检查版本更新失败":                                    "Failed to check for updates",
	"安装包不存在或该版本尚未公开":                              "Installer not found or release is not published",
	"该历史安装包缺少可信 SHA-256 摘要或文件大小元数据，需由平台管理员补全后才可下载": "This legacy installer is missing trusted SHA-256 or size metadata and must be approved by an administrator before download",
	"该安装包尚未经平台管理员确认签名或其文件内容/摘要已变更，需由管理员重新确认后才可下载":  "This installer has not been approved/signed by an administrator or its file digest has changed",
	"安装包文件不存在或已被清理":                               "Installer file is missing or has been removed",
	"安装包缺少有效的下载地址":                                "Installer has no valid download URL",

	// diagnostics.go
	"诊断编号或时间无效":       "Invalid diagnostic ID or timestamp",
	"诊断来源无效":          "Invalid diagnostic category or source",
	"诊断版本或阶段无效":       "Invalid diagnostic version, platform, arch, or stage",
	"诊断错误信息无效":        "Invalid diagnostic error code, message, or stack",
	"诊断上下文标识无效":       "Invalid diagnostic context identifier",
	"诊断上下文超出限制":       "Diagnostic context exceeds limits",
	"诊断表标识无效":         "Invalid diagnostic bound table ID",
	"诊断检查项无效":         "Invalid diagnostic check entry",
	"诊断账号信息无效":        "Invalid diagnostic account details",
	"诊断账号状态无效":        "Invalid diagnostic account status",
	"诊断设备信息无效":        "Invalid diagnostic device info",
	"诊断失败类型无效":        "Invalid diagnostic failure reason or status",
	"诊断证据时间无效":        "Invalid diagnostic failure timestamp",
	"诊断失败指标无效":        "Invalid diagnostic failure metric",
	"诊断性能指标无效":        "Invalid diagnostic performance metric",
	"安装诊断凭证无效":        "Invalid diagnostic installation credentials",
	"安装诊断凭证冲突":        "Diagnostic installation credential conflict",
	"登记诊断安装失败":        "Failed to register diagnostic installation",
	"缺少安装诊断凭证":        "Missing diagnostic installation credentials",
	"诊断编号已被其他记录使用":    "Diagnostic ID is already used by another report",
	"保存诊断失败":          "Failed to store diagnostic report",
	"请使用获准的管理网络访问诊断记录": "Please access diagnostic reports from a permitted admin network",
	"仅平台管理员可查询诊断记录":   "Only platform administrators can query diagnostic reports",
	"诊断查询条件无效":        "Invalid diagnostic query parameters",
	"读取诊断失败":          "Failed to query diagnostic reports",
}

var (
	reUniqueConstraintReserved = regexp.MustCompile(`^(.+) 唯一约束名 (.+) 重复或已保留$`)
	reDuplicateReleaseCreate   = regexp.MustCompile(`^版本号 v(.+) 已存在，请修改版本号或直接编辑已有版本$`)
	reDuplicateReleaseUpdate   = regexp.MustCompile(`^版本号 v(.+) 已存在$`)
)

func translateZhMessage(message string) string {
	if en, ok := exactZhToEn[message]; ok {
		return en
	}
	if strings.HasPrefix(message, "不支持的页面动作：") {
		return "Unsupported page action: " + strings.TrimPrefix(message, "不支持的页面动作：")
	}
	if strings.HasSuffix(message, ".uniqueConstraints 必须是数组") {
		return strings.TrimSuffix(message, ".uniqueConstraints 必须是数组") + ".uniqueConstraints must be an array"
	}
	if strings.HasSuffix(message, " 唯一约束格式无效") {
		return fmt.Sprintf("Invalid unique constraint format on %s", strings.TrimSuffix(message, " 唯一约束格式无效"))
	}
	if strings.HasSuffix(message, " 唯一约束名无效") {
		return fmt.Sprintf("Invalid unique constraint name on %s", strings.TrimSuffix(message, " 唯一约束名无效"))
	}
	if m := reUniqueConstraintReserved.FindStringSubmatch(message); m != nil {
		return fmt.Sprintf("Duplicate or reserved unique constraint name %s on %s", m[2], m[1])
	}
	if strings.HasSuffix(message, " 唯一约束字段数量无效") {
		return fmt.Sprintf("Invalid column count in unique constraint on %s", strings.TrimSuffix(message, " 唯一约束字段数量无效"))
	}
	if strings.HasSuffix(message, " 唯一约束引用了无效或重复的字段 ID") {
		return fmt.Sprintf("Unique constraint on %s references an invalid or duplicate column ID", strings.TrimSuffix(message, " 唯一约束引用了无效或重复的字段 ID"))
	}
	if strings.HasSuffix(message, " 唯一约束与主键或已有唯一约束重复") {
		return fmt.Sprintf("Unique constraint on %s duplicates the primary key or an existing unique constraint", strings.TrimSuffix(message, " 唯一约束与主键或已有唯一约束重复"))
	}
	if m := reDuplicateReleaseCreate.FindStringSubmatch(message); m != nil {
		return fmt.Sprintf("Release v%s already exists. Change the version number or edit the existing release", m[1])
	}
	if m := reDuplicateReleaseUpdate.FindStringSubmatch(message); m != nil {
		return fmt.Sprintf("Release v%s already exists", m[1])
	}
	return message
}
