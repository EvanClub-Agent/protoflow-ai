package publish

import (
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
	"strings"
	"time"
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
		ID            string            `json:"id"`
		TableName     string            `json:"tableName"`
		CNName        string            `json:"cnName"`
		Domain        string            `json:"domain"`
		Description   string            `json:"description"`
		Columns       []json.RawMessage `json:"columns"`
		SharedByMenus []json.RawMessage `json:"sharedByMenus"`
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
	Notes      []PublishedNote      `json:"notes"`
	NoteAssets map[string]NoteAsset `json:"noteAssets"`
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

const (
	maxPublishedNotes     = 500
	maxPublishedNoteHTML  = 512 << 10
	maxPublishedNoteAsset = 8 << 20
	maxPublishedAssets    = 300
)

var noteAssetID = regexp.MustCompile(`^img-[a-z0-9]{3,48}$`)
var noteStatuses = map[string]bool{"draft": true, "pending_confirm": true, "confirmed": true, "implemented": true}
var notePriorities = map[string]bool{"P0": true, "P1": true, "P2": true}
var noteMimes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

func validateNotes(s *Snapshot, fields map[string]json.RawMessage, pages map[string]bool) error {
	_, hasNotes := fields["notes"]
	_, hasAssets := fields["noteAssets"]
	if s.FormatVersion != 4 {
		if hasNotes || hasAssets {
			return errors.New("此发布格式不包含项目笔记字段")
		}
		return nil
	}
	if s.Notes == nil || len(s.Notes) > maxPublishedNotes {
		return errors.New("发布笔记必须明确提供，且最多 500 篇")
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
	ids := map[string]bool{}
	for _, n := range s.Notes {
		if strings.TrimSpace(n.NoteID) == "" || ids[n.NoteID] || strings.TrimSpace(n.Title) == "" || len(n.Title) > 400 || len(n.Icon) > 64 || !noteStatuses[n.Status] || strings.TrimSpace(n.UpdatedAt) == "" || len(n.HTML) > maxPublishedNoteHTML || n.PageIDs == nil {
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
	if (s.FormatVersion < 1 || s.FormatVersion > 4) || strings.TrimSpace(s.ProjectID) == "" || len(s.ProjectID) > 200 || strings.TrimSpace(s.Title) == "" || len(s.Title) > 500 || len(s.Pages) == 0 || len(s.Pages) > 500 {
		return nil, errors.New("项目标识、标题、页面或格式版本无效")
	}
	pages := map[string]bool{}
	nodes := 0
	for _, p := range s.Pages {
		if p.PageID == "" || strings.TrimSpace(p.FolderID) == "" || pages[p.PageID] || strings.TrimSpace(p.Title) == "" {
			return nil, errors.New("页面标识缺失或重复")
		}
		pages[p.PageID] = true
		if err := validateNode(p.Doc.Root, 0, &nodes); err != nil {
			return nil, err
		}
	}
	if !pages[s.EntryPageID] {
		return nil, errors.New("入口页面不存在")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	if err := validateNotes(&s, fields, pages); err != nil {
		return nil, err
	}
	if s.FormatVersion >= 3 {
		if err := validateSitemap(&s); err != nil {
			return nil, err
		}
	} else if _, present := fields["sitemap"]; present {
		return nil, errors.New("旧版发布格式不包含菜单目录字段")
	}
	if s.FormatVersion == 1 {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return nil, err
		}
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
		if t.ID == "" || tables[t.ID] || t.TableName == "" || t.Columns == nil || t.SharedByMenus == nil {
			return nil, errors.New("表结构标识无效")
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
			if !ok || key == "" || ids[key] {
				return nil, errors.New("演示数据的行 ID 缺失或重复")
			}
			ids[key] = true
		}
	}
	return &s, nil
}

// A menu node ID is not a page ID. Empty/archived entries are retained without
// inventing a canvas, and every published canvas must keep its exact parent.
func validateSitemap(s *Snapshot) error {
	if s.Sitemap == nil {
		return errors.New("发布内容必须包含完整菜单目录")
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
		return err
	}
	for id := range parents {
		if !pageIDs[id] {
			return errors.New("发布页面缺少对应的菜单项")
		}
	}
	return nil
}

func validateNode(raw json.RawMessage, depth int, count *int) error {
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
	if n.Kind == "text" && n.Value != nil {
		return nil
	}
	if n.Kind != "node" || n.PfID == "" || n.Type == "" || n.Props == nil || n.Children == nil {
		return errors.New("页面节点标识或属性缺失")
	}
	for _, c := range n.Children {
		if err := validateNode(c, depth+1, count); err != nil {
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
