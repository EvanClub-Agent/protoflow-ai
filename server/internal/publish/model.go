package publish

import (
	"bytes"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
)

var ErrNotFound = errors.New("publication not found")
var ErrConflict = errors.New("publication version conflict")

type Publication struct {
	ID                string          `json:"id"`
	PublisherID       string          `json:"-"`
	ProjectID         string          `json:"projectId"`
	Title             string          `json:"title"`
	Snapshot          json.RawMessage `json:"-"`
	Version           int             `json:"version"`
	PasswordHash      string          `json:"-"`
	PasswordProtected bool            `json:"passwordProtected"`
	ExpiresAt         *time.Time      `json:"expiresAt"`
	RevokedAt         *time.Time      `json:"revokedAt"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
	ShareURL          string          `json:"shareUrl"`
}

type Snapshot struct {
	FormatVersion int               `json:"formatVersion"`
	Sitemap       []json.RawMessage `json:"sitemap"`
	ProjectID     string            `json:"projectId"`
	Title         string            `json:"title"`
	EntryPageID   string            `json:"entryPageId"`
	Pages         []struct {
		PageID   string `json:"pageId"`
		Title    string `json:"title"`
		FolderID string `json:"folderId"`
		Doc      struct {
			Header []string        `json:"header"`
			Root   json.RawMessage `json:"root"`
		} `json:"doc"`
	} `json:"pages"`
	Tables []struct {
		ID                string            `json:"id"`
		TableName         string            `json:"tableName"`
		CNName            string            `json:"cnName"`
		Domain            string            `json:"domain"`
		Description       string            `json:"description"`
		UniqueConstraints json.RawMessage   `json:"uniqueConstraints"`
		Columns           []json.RawMessage `json:"columns"`
		SharedByMenus     []json.RawMessage `json:"sharedByMenus"`
	} `json:"tables"`
	TableRows   map[string][]map[string]any `json:"tableRows"`
	StickyNotes []struct {
		ID               string  `json:"id"`
		PageID           string  `json:"pageId"`
		TargetWidgetID   string  `json:"targetWidgetId"`
		TargetWidgetName *string `json:"targetWidgetName"`
		Index            *int    `json:"index"`
		Text             string  `json:"text"`
		Active           *bool   `json:"active"`
	} `json:"stickyNotes"`
	// Format 4: read-only project notes the author explicitly marked shareable.
	Notes        []PublishedNote      `json:"notes"`
	NoteAssets   map[string]NoteAsset `json:"noteAssets"`
	DesignTokens json.RawMessage      `json:"designTokens,omitempty"`
}

type PublishedDesignTokens struct {
	Preset         string  `json:"preset"`
	PrimaryColor   *string `json:"primaryColor,omitempty"`
	Radius         *string `json:"radius,omitempty"`
	Density        *string `json:"density,omitempty"`
	SurfaceVariant *string `json:"surfaceVariant,omitempty"`
	ColorMode      *string `json:"colorMode,omitempty"`
}

type PublishedNote struct {
	NoteID      string   `json:"noteId"`
	Title       string   `json:"title"`
	Icon        string   `json:"icon"`
	Status      string   `json:"status"`
	Priority    *string  `json:"priority"`
	MeetingDate *string  `json:"meetingDate"`
	UpdatedAt   string   `json:"updatedAt"`
	HTML        string   `json:"html"`
	PageIDs     []string `json:"pageIds"`
}

type NoteAsset struct {
	Mime string `json:"mime"`
	Data string `json:"data"`
}

type PublishedUniqueConstraint struct {
	Name      string   `json:"name"`
	ColumnIDs []string `json:"columnIds"`
}

var constraintNameRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)

const (
	maxPublishedNotes     = 500
	maxPublishedNoteHTML  = 512 << 10
	maxPublishedNoteAsset = 8 << 20
	maxPublishedAssets    = 300
)

var noteAssetID = regexp.MustCompile(`^img-[a-z0-9]{3,48}$`)
var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var designPresets = map[string]bool{"classic_antd": true, "modern_minimal": true, "collab_soft": true, "enterprise_compact": true}
var designRadii = map[string]bool{"sharp": true, "rounded": true, "generous": true}
var designDensities = map[string]bool{"compact": true, "comfortable": true, "spacious": true}
var designSurfaces = map[string]bool{"bordered": true, "subtle": true, "elevated": true}
var designColorModes = map[string]bool{"auto": true, "light": true, "dark": true}
var noteStatuses = map[string]bool{"draft": true, "pending_confirm": true, "confirmed": true, "implemented": true}
var notePriorities = map[string]bool{"P0": true, "P1": true, "P2": true}
var noteMimes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}
var allowedPublishedActions = map[string]bool{
	"openModal":                true,
	"openDrawer":               true,
	"closeOverlay":             true,
	"submitForm":               true,
	"resetForm":                true,
	"confirm":                  true,
	"toast":                    true,
	"refresh":                  true,
	"selectRow":                true,
	"deleteRow":                true,
	"updateRow":                true,
	"importPurchaseOrderLines": true,
	"returnSelection":          true,
	"switchTab":                true,
	"navigate":                 true,
	"setVar":                   true,
	"show":                     true,
	"hide":                     true,
}

var allowedSnapshotKeys = map[string]bool{
	"formatVersion": true,
	"sitemap":       true,
	"projectId":     true,
	"title":         true,
	"entryPageId":   true,
	"pages":         true,
	"tables":        true,
	"tableRows":     true,
	"stickyNotes":   true,
	"notes":         true,
	"noteAssets":    true,
	"designTokens":  true,
}

var allowedDesignTokenKeys = map[string]bool{
	"preset":         true,
	"primaryColor":   true,
	"radius":         true,
	"density":        true,
	"surfaceVariant": true,
	"colorMode":      true,
}

func decodeStrictJSONObjectKeys(raw []byte, allowed map[string]bool) (map[string]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, errors.New("JSON 对象格式无效")
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return nil, errors.New("JSON 对象格式无效")
	}
	out := make(map[string]json.RawMessage)
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, errors.New("JSON 键名格式无效")
		}
		key, ok := keyTok.(string)
		if !ok || (allowed != nil && !allowed[key]) {
			return nil, errors.New("包含不支持的字段或字段大小写无效")
		}
		if _, dup := out[key]; dup {
			return nil, errors.New("包含重复的 JSON 字段")
		}
		var val json.RawMessage
		if err := dec.Decode(&val); err != nil {
			return nil, errors.New("JSON 字段值无效")
		}
		out[key] = val
	}
	endTok, err := dec.Token()
	if err != nil || endTok != json.Delim('}') || dec.More() {
		return nil, errors.New("JSON 对象结尾格式无效")
	}
	return out, nil
}

func validateDesignTokens(s *Snapshot, fields map[string]json.RawMessage) error {
	rawTokens, present := fields["designTokens"]
	if !present {
		return nil
	}
	if s.FormatVersion < 5 {
		return errors.New("此发布格式不包含设计令牌字段")
	}
	tokenFields, err := decodeStrictJSONObjectKeys(rawTokens, allowedDesignTokenKeys)
	if err != nil {
		return errors.New("设计令牌格式无效或包含不支持的字段")
	}
	if _, hasPreset := tokenFields["preset"]; !hasPreset {
		return errors.New("设计令牌缺少必填字段 preset")
	}
	for k, rv := range tokenFields {
		if bytes.Equal(bytes.TrimSpace(rv), []byte("null")) {
			return fmt.Errorf("设计令牌字段 %s 不能为 null", k)
		}
	}
	var dt PublishedDesignTokens
	dec := json.NewDecoder(bytes.NewReader(bytes.TrimSpace(rawTokens)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&dt); err != nil {
		return errors.New("设计令牌包含不支持的字段或类型无效")
	}
	if !designPresets[dt.Preset] {
		return errors.New("设计令牌预设无效")
	}
	if dt.PrimaryColor != nil && !hexColorRe.MatchString(*dt.PrimaryColor) {
		return errors.New("设计令牌主色格式无效")
	}
	if dt.Radius != nil && !designRadii[*dt.Radius] {
		return errors.New("设计令牌圆角无效")
	}
	if dt.Density != nil && !designDensities[*dt.Density] {
		return errors.New("设计令牌紧凑度无效")
	}
	if dt.SurfaceVariant != nil && !designSurfaces[*dt.SurfaceVariant] {
		return errors.New("设计令牌表面质感无效")
	}
	if dt.ColorMode != nil && !designColorModes[*dt.ColorMode] {
		return errors.New("设计令牌色彩模式无效")
	}
	return nil
}

func validateNotes(s *Snapshot, fields map[string]json.RawMessage, pages map[string]bool) error {
	rawNotes, hasNotes := fields["notes"]
	rawAssets, hasAssets := fields["noteAssets"]
	if s.FormatVersion < 4 {
		if hasNotes || hasAssets {
			return errors.New("此发布格式不包含项目笔记字段")
		}
		return nil
	}
	if s.FormatVersion == 5 && !hasNotes && !hasAssets {
		return nil
	}
	if s.Notes == nil || len(s.Notes) > maxPublishedNotes {
		return errors.New("发布笔记必须明确提供，且最多 500 篇")
	}
	if hasAssets {
		trimmedAssets := bytes.TrimSpace(rawAssets)
		if len(trimmedAssets) == 0 || trimmedAssets[0] != '{' {
			return errors.New("发布笔记图片集合必须是对象")
		}
	}
	if len(s.NoteAssets) > maxPublishedAssets {
		return errors.New("发布笔记图片过多")
	}
	for id, asset := range s.NoteAssets {
		if !noteAssetID.MatchString(id) || !noteMimes[asset.Mime] || asset.Data == "" {
			return errors.New("发布笔记图片标识或格式无效")
		}
		decoded, err := base64.StdEncoding.DecodeString(asset.Data)
		if err != nil || len(decoded) > maxPublishedNoteAsset {
			return errors.New("发布笔记图片内容无效或超过 8 MB")
		}
	}
	var rawNoteItems []map[string]json.RawMessage
	if err := json.Unmarshal(rawNotes, &rawNoteItems); err != nil || len(rawNoteItems) != len(s.Notes) {
		return errors.New("发布笔记格式无效")
	}
	ids := map[string]bool{}
	for idx, n := range s.Notes {
		noteFields := rawNoteItems[idx]
		if noteFields == nil {
			return errors.New("发布笔记格式无效")
		}
		rawIcon, hasIcon := noteFields["icon"]
		trimmedIcon := bytes.TrimSpace(rawIcon)
		if !hasIcon || len(trimmedIcon) == 0 || trimmedIcon[0] != '"' || len(utf16.Encode([]rune(n.Icon))) > 16 {
			return errors.New("发布笔记图标无效")
		}
		if rawPrio, hasPrio := noteFields["priority"]; hasPrio && bytes.Equal(bytes.TrimSpace(rawPrio), []byte("null")) {
			return errors.New("发布笔记优先级无效")
		}
		if rawDate, hasDate := noteFields["meetingDate"]; hasDate && bytes.Equal(bytes.TrimSpace(rawDate), []byte("null")) {
			return errors.New("发布笔记日期无效")
		}
		var rawPageIDs []*string
		if err := json.Unmarshal(noteFields["pageIds"], &rawPageIDs); err != nil {
			return errors.New("发布笔记关联页面格式无效")
		}
		for _, pid := range rawPageIDs {
			if pid == nil {
				return errors.New("发布笔记关联页面格式无效")
			}
		}
		if strings.TrimSpace(n.NoteID) == "" || ids[n.NoteID] || strings.TrimSpace(n.Title) == "" || len(n.Title) > 400 || !noteStatuses[n.Status] || strings.TrimSpace(n.UpdatedAt) == "" || len(n.HTML) > maxPublishedNoteHTML || n.PageIDs == nil {
			return errors.New("发布笔记标识、标题、状态或内容无效")
		}
		if n.Priority != nil && !notePriorities[*n.Priority] {
			return errors.New("发布笔记优先级无效")
		}
		ids[n.NoteID] = true
		for _, pageID := range n.PageIDs {
			if !pages[pageID] {
				return errors.New("发布笔记关联了未发布的页面")
			}
		}
	}
	return nil
}

// Only the versioned publish DTO is accepted. Project archives, local paths and
// editor/AI state are deliberately absent from this wire contract.
func ValidateSnapshot(raw json.RawMessage) (*Snapshot, error) {
	var s Snapshot
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(&s); err != nil {
		return nil, errors.New("发布内容格式错误或包含不支持的字段")
	}
	if (s.FormatVersion < 1 || s.FormatVersion > 5) || strings.TrimSpace(s.ProjectID) == "" || len(s.ProjectID) > 200 || strings.TrimSpace(s.Title) == "" || len(s.Title) > 500 || len(s.Pages) == 0 || len(s.Pages) > 500 {
		return nil, errors.New("项目标识、标题、页面或格式版本无效")
	}
	pages := map[string]bool{}
	navigationIDs := map[string]bool{}
	for _, p := range s.Pages {
		if strings.TrimSpace(p.PageID) == "" || strings.TrimSpace(p.FolderID) == "" || pages[p.PageID] || strings.TrimSpace(p.Title) == "" || p.Doc.Header == nil {
			return nil, errors.New("页面标识缺失或重复")
		}
		pages[p.PageID] = true
		navigationIDs[p.PageID] = true
	}
	if !pages[s.EntryPageID] {
		return nil, errors.New("入口页面不存在")
	}
	fields, err := decodeStrictJSONObjectKeys(raw, allowedSnapshotKeys)
	if err != nil {
		return nil, errors.New("发布内容格式错误或包含不支持的字段")
	}
	if err := validateNotes(&s, fields, pages); err != nil {
		return nil, err
	}
	if err := validateDesignTokens(&s, fields); err != nil {
		return nil, err
	}
	if s.FormatVersion >= 3 {
		sitemapPageIDs, err := validateSitemap(&s)
		if err != nil {
			return nil, err
		}
		for id := range sitemapPageIDs {
			navigationIDs[id] = true
		}
	} else if _, present := fields["sitemap"]; present {
		return nil, errors.New("旧版发布格式不包含菜单目录字段")
	}
	nodes := 0
	for _, p := range s.Pages {
		seenPfIDs := map[string]bool{}
		if err := validateNode(p.Doc.Root, 0, &nodes, seenPfIDs, navigationIDs); err != nil {
			return nil, err
		}
	}
	if s.FormatVersion == 1 {
		if _, present := fields["stickyNotes"]; present {
			return nil, errors.New("旧版发布格式不包含便签字段")
		}
	} else {
		if s.StickyNotes == nil || len(s.StickyNotes) > 10000 {
			return nil, errors.New("发布便签必须明确提供，且最多 10000 条")
		}
		noteIDs := map[string]bool{}
		for _, note := range s.StickyNotes {
			if strings.TrimSpace(note.ID) == "" || noteIDs[note.ID] || !pages[note.PageID] || strings.TrimSpace(note.TargetWidgetID) == "" || note.TargetWidgetName == nil || strings.TrimSpace(note.Text) == "" || note.Index == nil || *note.Index < 1 || note.Active == nil {
				return nil, errors.New("便签标识、页面、区域、内容、序号或状态无效")
			}
			noteIDs[note.ID] = true
		}
	}
	if s.Tables == nil || s.TableRows == nil {
		return nil, errors.New("表结构与演示数据必须明确提供，可为空")
	}
	tables := map[string]bool{}
	for _, t := range s.Tables {
		if strings.TrimSpace(t.ID) == "" || tables[t.ID] || strings.TrimSpace(t.TableName) == "" || strings.TrimSpace(t.CNName) == "" || t.Columns == nil || t.SharedByMenus == nil {
			return nil, errors.New("表结构标识无效")
		}
		if err := validateTableConstraints(s.FormatVersion, t.TableName, t.Columns, t.UniqueConstraints); err != nil {
			return nil, err
		}
		tables[t.ID] = true
		if _, ok := s.TableRows[t.ID]; !ok {
			return nil, errors.New("演示数据缺少表对应的明确数据集")
		}
	}
	for id, rows := range s.TableRows {
		if !tables[id] || rows == nil {
			return nil, errors.New("演示数据引用未知表或数据集无效")
		}
		ids := map[string]bool{}
		for _, row := range rows {
			key, ok := row["id"].(string)
			if !ok || strings.TrimSpace(key) == "" || ids[key] {
				return nil, errors.New("演示数据的行 ID 缺失或重复")
			}
			ids[key] = true
		}
	}
	return &s, nil
}

func validateTableConstraints(formatVersion int, tableName string, rawColumns []json.RawMessage, rawUniqueConstraints json.RawMessage) error {
	colByID := map[string]string{}
	colNames := map[string]bool{}
	reservedConstraintNames := map[string]bool{"primary": true}
	seenKeySets := map[string]bool{}
	var pkIDs []string

	signature := func(ids []string) string {
		cp := append([]string(nil), ids...)
		sort.Strings(cp)
		b, _ := json.Marshal(cp)
		return string(b)
	}

	for _, rawCol := range rawColumns {
		trimmedCol := bytes.TrimSpace(rawCol)
		if len(trimmedCol) == 0 || trimmedCol[0] != '{' {
			return errors.New("表字段格式错误")
		}
		var colFields map[string]json.RawMessage
		if err := json.Unmarshal(trimmedCol, &colFields); err != nil || colFields == nil {
			return errors.New("表字段格式错误")
		}
		if formatVersion < 5 {
			if _, hasUnique := colFields["isUnique"]; hasUnique {
				return errors.New("旧版发布格式不包含字段唯一约束")
			}
			continue
		}
		var col struct {
			ID           string `json:"id"`
			Name         string `json:"name"`
			DataType     string `json:"dataType"`
			Nullable     *bool  `json:"nullable"`
			IsPrimaryKey *bool  `json:"isPrimaryKey"`
			IsUnique     *bool  `json:"isUnique"`
		}
		if err := json.Unmarshal(trimmedCol, &col); err != nil {
			return errors.New("表字段属性类型无效")
		}
		if strings.TrimSpace(col.ID) == "" || col.ID != strings.TrimSpace(col.ID) || colByID[col.ID] != "" {
			return errors.New("表字段 ID 缺失、包含空白或重复")
		}
		if strings.TrimSpace(col.Name) == "" || col.Name != strings.TrimSpace(col.Name) || strings.TrimSpace(col.DataType) == "" || col.Nullable == nil || colNames[col.Name] {
			return errors.New("表字段标识或属性无效")
		}
		if rawPK, present := colFields["isPrimaryKey"]; present {
			trimmedPK := string(bytes.TrimSpace(rawPK))
			if trimmedPK != "true" && trimmedPK != "false" {
				return errors.New("字段 isPrimaryKey 必须是布尔值")
			}
		}
		if rawUnique, present := colFields["isUnique"]; present {
			trimmedUnique := string(bytes.TrimSpace(rawUnique))
			if trimmedUnique != "true" && trimmedUnique != "false" {
				return errors.New("字段 isUnique 必须是布尔值")
			}
		}
		colNames[col.Name] = true
		colByID[col.ID] = col.Name
		if col.IsPrimaryKey != nil && *col.IsPrimaryKey {
			pkIDs = append(pkIDs, col.ID)
		}
		if col.IsUnique != nil && *col.IsUnique {
			reservedConstraintNames[strings.ToLower(col.Name)] = true
			seenKeySets[signature([]string{col.ID})] = true
		}
	}

	if formatVersion < 5 {
		if len(rawUniqueConstraints) > 0 {
			return errors.New("旧版发布格式不包含表级唯一约束字段")
		}
		return nil
	}

	seenKeySets[signature(pkIDs)] = true

	if len(rawUniqueConstraints) == 0 {
		return nil
	}
	trimmedUC := bytes.TrimSpace(rawUniqueConstraints)
	if len(trimmedUC) == 0 || trimmedUC[0] != '[' {
		return fmt.Errorf("%s.uniqueConstraints 必须是数组", tableName)
	}
	var rawUCItems []json.RawMessage
	if err := json.Unmarshal(trimmedUC, &rawUCItems); err != nil {
		return fmt.Errorf("%s.uniqueConstraints 必须是数组", tableName)
	}
	for _, rawUC := range rawUCItems {
		trimmedItem := bytes.TrimSpace(rawUC)
		if len(trimmedItem) == 0 || trimmedItem[0] != '{' {
			return fmt.Errorf("%s 唯一约束格式无效", tableName)
		}
		var uc struct {
			Name      *string   `json:"name"`
			ColumnIDs *[]*string `json:"columnIds"`
		}
		dec := json.NewDecoder(bytes.NewReader(trimmedItem))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&uc); err != nil || uc.Name == nil || uc.ColumnIDs == nil {
			return fmt.Errorf("%s 唯一约束格式无效", tableName)
		}
		if !constraintNameRe.MatchString(*uc.Name) {
			return fmt.Errorf("%s 唯一约束名无效", tableName)
		}
		lowerName := strings.ToLower(*uc.Name)
		if reservedConstraintNames[lowerName] {
			return fmt.Errorf("%s 唯一约束名 %s 重复或已保留", tableName, *uc.Name)
		}
		reservedConstraintNames[lowerName] = true
		rawColIDs := *uc.ColumnIDs
		if len(rawColIDs) == 0 || len(rawColIDs) > 16 {
			return fmt.Errorf("%s 唯一约束字段数量无效", tableName)
		}
		colIDs := make([]string, 0, len(rawColIDs))
		localSeen := map[string]bool{}
		for _, cidPtr := range rawColIDs {
			if cidPtr == nil || colByID[*cidPtr] == "" || localSeen[*cidPtr] {
				return fmt.Errorf("%s 唯一约束引用了无效或重复的字段 ID", tableName)
			}
			localSeen[*cidPtr] = true
			colIDs = append(colIDs, *cidPtr)
		}
		sig := signature(colIDs)
		if seenKeySets[sig] {
			return fmt.Errorf("%s 唯一约束与主键或已有唯一约束重复", tableName)
		}
		seenKeySets[sig] = true
	}
	return nil
}

// A menu node ID is not a page ID. Empty/archived entries are retained without
// inventing a canvas, and every published canvas must keep its exact parent.
func validateSitemap(s *Snapshot) (map[string]bool, error) {
	if s.Sitemap == nil {
		return nil, errors.New("发布内容必须包含完整菜单目录")
	}
	ids, pageIDs := map[string]bool{}, map[string]bool{}
	parents := map[string]string{}
	for _, p := range s.Pages {
		parents[p.PageID] = p.FolderID
	}
	var visit func([]json.RawMessage, string, int) error
	visit = func(items []json.RawMessage, parent string, depth int) error {
		if depth > 40 {
			return errors.New("发布菜单目录层级过深")
		}
		for _, raw := range items {
			var n struct {
				ID         string             `json:"id"`
				Title      string             `json:"title"`
				Type       string             `json:"type"`
				Deprecated *bool              `json:"deprecated"`
				PageID     *string            `json:"pageId"`
				Children   *[]json.RawMessage `json:"children"`
			}
			d := json.NewDecoder(strings.NewReader(string(raw)))
			d.DisallowUnknownFields()
			if err := d.Decode(&n); err != nil {
				return errors.New("发布菜单节点格式无效")
			}
			if strings.TrimSpace(n.ID) == "" || ids[n.ID] || strings.TrimSpace(n.Title) == "" || n.Deprecated == nil {
				return errors.New("发布菜单标识、名称或归档状态无效")
			}
			ids[n.ID] = true
			if len(ids) > 2000 {
				return errors.New("发布菜单数量过多")
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(raw, &fields); err != nil {
				return err
			}
			_, hasPage := fields["pageId"]
			_, hasChildren := fields["children"]
			switch n.Type {
			case "folder":
				if n.Children == nil || hasPage {
					return errors.New("发布菜单目录子节点无效")
				}
				if err := visit(*n.Children, n.ID, depth+1); err != nil {
					return err
				}
			case "page", "doc":
				if hasChildren || !hasPage {
					return errors.New("发布菜单页面字段无效")
				}
				if n.PageID == nil && n.Type == "page" && *n.Deprecated {
					continue
				}
				if n.PageID == nil || strings.TrimSpace(*n.PageID) == "" || pageIDs[*n.PageID] {
					return errors.New("菜单页面标识缺失或重复")
				}
				pageIDs[*n.PageID] = true
				if folder, present := parents[*n.PageID]; present && (n.Type != "page" || folder != parent) {
					return errors.New("发布页面与菜单所属目录不一致")
				}
			default:
				return errors.New("发布菜单类型无效")
			}
		}
		return nil
	}
	if err := visit(s.Sitemap, "", 0); err != nil {
		return nil, err
	}
	for id := range parents {
		if !pageIDs[id] {
			return nil, errors.New("发布页面缺少对应的菜单项")
		}
	}
	return pageIDs, nil
}

func validatePropValue(v any, depth int, navigationIDs map[string]bool) error {
	if depth > 80 {
		return errors.New("组件属性嵌套过深")
	}
	switch val := v.(type) {
	case nil, string, bool, float64:
		return nil
	case []any:
		for _, elem := range val {
			if err := validatePropValue(elem, depth+1, navigationIDs); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		if kind, _ := val["$kind"].(string); kind == "raw" {
			return errors.New("页面包含未支持的代码表达式")
		}
		if kind, _ := val["$kind"].(string); kind == "actions" {
			calls, ok := val["calls"].([]any)
			if !ok {
				return errors.New("页面动作格式无效")
			}
			for _, callItem := range calls {
				call, ok := callItem.(map[string]any)
				if !ok {
					return errors.New("页面动作格式无效")
				}
				name, ok := call["name"].(string)
				if !ok || strings.TrimSpace(name) == "" {
					return errors.New("动作名不能为空")
				}
				args, hasArgs := call["args"].([]any)
				if !allowedPublishedActions[name] || !hasArgs {
					return fmt.Errorf("不支持的页面动作：%s", name)
				}
				if name == "navigate" {
					if len(args) == 0 {
						return errors.New("跳转动作指向未发布的页面")
					}
					target, ok := args[0].(string)
					if !ok || !navigationIDs[target] {
						return errors.New("跳转动作指向未发布的页面")
					}
				}
			}
		}
		for k, item := range val {
			if k == "__proto__" || k == "prototype" || k == "constructor" {
				return errors.New("组件属性名无效")
			}
			if err := validatePropValue(item, depth+1, navigationIDs); err != nil {
				return err
			}
		}
		return nil
	default:
		return errors.New("组件属性无效")
	}
}

func validateNode(raw json.RawMessage, depth int, count *int, seenPfIDs map[string]bool, navigationIDs map[string]bool) error {
	*count++
	if depth > 80 || *count > 50000 {
		return errors.New("设计内容超过页面复杂度限制")
	}
	var n struct {
		Kind     string            `json:"kind"`
		PfID     string            `json:"pfId"`
		Type     string            `json:"type"`
		Props    map[string]any    `json:"props"`
		Children []json.RawMessage `json:"children"`
		Value    *string           `json:"value"`
	}
	if json.Unmarshal(raw, &n) != nil {
		return errors.New("页面节点格式错误")
	}
	if n.Kind == "text" && n.Value != nil && depth > 0 {
		return nil
	}
	if n.Kind != "node" || strings.TrimSpace(n.PfID) == "" || strings.TrimSpace(n.Type) == "" || n.Props == nil || n.Children == nil {
		return errors.New("页面节点标识或属性缺失")
	}
	if depth == 0 && n.Type != "Page" && n.Type != "MobilePage" {
		return errors.New("页面根组件必须是 Page 或 MobilePage")
	}
	if seenPfIDs[n.PfID] {
		return errors.New("页面组件 ID 重复")
	}
	seenPfIDs[n.PfID] = true
	if err := validatePropValue(n.Props, 0, navigationIDs); err != nil {
		return err
	}
	for _, c := range n.Children {
		if err := validateNode(c, depth+1, count, seenPfIDs, navigationIDs); err != nil {
			return err
		}
	}
	return nil
}

func NewID() string { return rand.Text() }
func TokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
func HashPassword(password string) (string, error) {
	salt := make([]byte, 24)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, 310000, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$310000$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}
func CheckPassword(password, hash string) bool {
	p := strings.Split(hash, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" || p[1] != "310000" {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(p[2])
	if e != nil || len(salt) != 24 {
		return false
	}
	want, e := base64.RawStdEncoding.DecodeString(p[3])
	if e != nil || len(want) != 32 {
		return false
	}
	got, e := pbkdf2.Key(sha256.New, password, salt, 310000, 32)
	return e == nil && subtle.ConstantTimeCompare(got, want) == 1
}
