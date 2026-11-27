package publish

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	mcpServerName       = "protoflow-spec"
	mcpServerVersion    = "0.1.4"
	maxMcpRequestBytes  = 64 << 10 // 64 KiB cap for read-only MCP JSON-RPC request bodies
	maxMcpBatchSize     = 16
	maxMcpResponseBytes = 4 << 20 // 4 MiB cumulative response cap per HTTP request
	maxMcpRpcIDBytes    = 256     // Decoded UTF-8 byte cap for string JSON-RPC IDs
)

var errMcpBatchTooLarge = errors.New("mcp batch exceeds limit")

var supportedMcpProtocols = map[string]bool{
	"2025-06-18": true,
	"2025-03-26": true,
	"2024-11-05": true,
}

type jsonRpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type jsonRpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *jsonRpcError   `json:"error,omitempty"`
}

type jsonRpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpSnapshot struct {
	FormatVersion int                  `json:"formatVersion"`
	Sitemap       []mcpSitemapItem     `json:"sitemap"`
	ProjectID     string               `json:"projectId"`
	Title         string               `json:"title"`
	EntryPageID   string               `json:"entryPageId"`
	Pages         []mcpPage            `json:"pages"`
	Tables        []mcpTable           `json:"tables"`
	TableRows     map[string][]any     `json:"tableRows"`
	StickyNotes   []mcpSticky            `json:"stickyNotes"`
	Notes         []PublishedNote        `json:"notes"`
	NoteAssets    map[string]NoteAsset   `json:"noteAssets"`
	DesignTokens  *PublishedDesignTokens `json:"designTokens,omitempty"`
}

type mcpSitemapItem struct {
	ID         string           `json:"id"`
	Title      string           `json:"title"`
	Type       string           `json:"type"`
	Deprecated bool             `json:"deprecated"`
	PageID     *string          `json:"pageId,omitempty"`
	Children   []mcpSitemapItem `json:"children,omitempty"`
}

type mcpPage struct {
	PageID   string `json:"pageId"`
	Title    string `json:"title"`
	FolderID string `json:"folderId"`
	Doc      struct {
		Header []string `json:"header"`
		Root   mcpNode  `json:"root"`
	} `json:"doc"`
}

type mcpNode struct {
	Kind     string         `json:"kind"`
	PfID     string         `json:"pfId"`
	Type     string         `json:"type"`
	Props    map[string]any `json:"props"`
	Children []mcpNode      `json:"children"`
	Value    string         `json:"value"`
}

type mcpTable struct {
	ID          string `json:"id"`
	TableName   string `json:"tableName"`
	CNName      string `json:"cnName"`
	Domain      string `json:"domain"`
	Description string `json:"description"`
	Modeling    *struct {
		Entity       string `json:"entity"`
		Grain        string `json:"grain"`
		Reason       string `json:"reason"`
		PendingRules []struct {
			Rule   string `json:"rule"`
			Reason string `json:"reason"`
		} `json:"pendingRules,omitempty"`
	} `json:"modeling,omitempty"`
	UniqueConstraints []struct {
		Name      string   `json:"name"`
		ColumnIDs []string `json:"columnIds"`
	} `json:"uniqueConstraints,omitempty"`
	SharedByMenus []struct {
		PageID           string `json:"pageId"`
		MenuTitle        string `json:"menuTitle"`
		AccessMode       string `json:"accessMode"`
		FieldMappingNote string `json:"fieldMappingNote"`
	} `json:"sharedByMenus"`
	Columns []mcpColumn `json:"columns"`
}

type mcpColumn struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	DataType          string `json:"dataType"`
	Nullable          bool   `json:"nullable"`
	IsPrimaryKey      bool   `json:"isPrimaryKey"`
	IsUnique          bool   `json:"isUnique"`
	IsForeignKey      bool   `json:"isForeignKey"`
	References        string `json:"references"`
	ForeignKeyOptions *struct {
		Name        string `json:"name,omitempty"`
		Cardinality string `json:"cardinality,omitempty"`
		OnDelete    string `json:"onDelete,omitempty"`
	} `json:"foreignKeyOptions,omitempty"`
	DefaultValue *string `json:"defaultValue,omitempty"`
	Comment      string  `json:"comment"`
}

type mcpSticky struct {
	ID               string `json:"id"`
	PageID           string `json:"pageId"`
	TargetWidgetID   string `json:"targetWidgetId"`
	TargetWidgetName string `json:"targetWidgetName"`
	Index            int    `json:"index"`
	Text             string `json:"text"`
	Active           bool   `json:"active"`
}

type mcpActionItem struct {
	PageID        string `json:"pageId"`
	PfID          string `json:"pfId"`
	ComponentType string `json:"componentType"`
	Event         string `json:"event"`
	ActionName    string `json:"actionName"`
	Args          []any  `json:"args"`
}

type mcpForeignKey struct {
	ConstraintName   string `json:"constraintName"`
	FromTable        string `json:"fromTable"`
	FromTableID      string `json:"-"`
	FromColumn       string `json:"fromColumn"`
	ReferencesTable  string `json:"referencesTable"`
	ReferencesID     string `json:"-"`
	ReferencesColumn string `json:"referencesColumn"`
	Cardinality      string `json:"cardinality"`
	OnDelete         string `json:"onDelete"`
}

type pageCatalogEntry struct {
	PageID     string
	Title      string
	Path       string
	Deprecated bool
	HasSource  bool
}

type mcpFkIssue struct {
	TableID string
	Message string
}

// mcpRequestContext caches the decoded snapshot and derived indices across a single HTTP
// request so batch calls never re-parse or re-walk the published snapshot.
type mcpRequestContext struct {
	pub               Publication
	shareURL          string
	en                bool
	loaded            bool
	loadErr           error
	snap              mcpSnapshot
	catalog           []pageCatalogEntry
	pageByID          map[string]mcpPage
	tableByID         map[string]mcpTable
	allUsages         []gin.H
	allActs           []mcpActionItem
	allFKs            []mcpForeignKey
	fkIssues          []mcpFkIssue
	axureSourceByCopy map[string]string
	axureCopyBySource map[string]string
	figmaSourceByCopy map[string]string
	figmaCopyBySource map[string]string
}

var remoteAxureCopyRe = regexp.MustCompile(`^rp-optimized-([a-f0-9]{32})$`)
var remoteFigmaCopyRe = regexp.MustCompile(`^fig-optimized-([a-z0-9_-]{4,48})$`)

func verifiedRemoteAxureSourceID(copyID string, header []string) string {
	m := remoteAxureCopyRe.FindStringSubmatch(copyID)
	if m == nil || len(header) == 0 {
		return ""
	}
	sourceID := "rp-page-" + m[1]
	expected := "// @alex-axure-source " + sourceID
	matched := 0
	for _, line := range header {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "// @alex-axure-source ") {
			if trimmed != expected {
				return ""
			}
			matched++
		}
	}
	if matched == 1 {
		return sourceID
	}
	return ""
}

func verifiedRemoteFigmaSourceID(copyID string, header []string) string {
	m := remoteFigmaCopyRe.FindStringSubmatch(copyID)
	if m == nil || len(header) == 0 {
		return ""
	}
	sourceID := "fig-page-" + m[1]
	expected := "// @alex-figma-source " + sourceID
	matched := 0
	for _, line := range header {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "// @alex-figma-source ") {
			if trimmed != expected {
				return ""
			}
			matched++
		}
	}
	if matched == 1 {
		return sourceID
	}
	return ""
}

func (rc *mcpRequestContext) ensureLoaded() error {
	if rc.loaded {
		return rc.loadErr
	}
	rc.loaded = true
	if err := json.Unmarshal(rc.pub.Snapshot, &rc.snap); err != nil {
		if rc.en {
			rc.loadErr = errors.New("Failed to parse published project snapshot")
		} else {
			rc.loadErr = errors.New("无法解析已发布的工程快照")
		}
		return rc.loadErr
	}
	rc.catalog = buildPageCatalog(&rc.snap)
	rc.pageByID = make(map[string]mcpPage, len(rc.snap.Pages))
	for _, p := range rc.snap.Pages {
		rc.pageByID[p.PageID] = p
	}
	validPageIDs := make(map[string]bool, len(rc.catalog)+len(rc.snap.Pages))
	for _, c := range rc.catalog {
		validPageIDs[c.PageID] = true
	}
	for _, p := range rc.snap.Pages {
		validPageIDs[p.PageID] = true
	}

	rc.tableByID = make(map[string]mcpTable, len(rc.snap.Tables))
	tableByName := make(map[string]mcpTable, len(rc.snap.Tables))
	tableNameCount := make(map[string]int, len(rc.snap.Tables))
	for _, t := range rc.snap.Tables {
		rc.tableByID[t.ID] = t
		tableByName[t.TableName] = t
		tableNameCount[t.TableName]++
	}

	rc.allUsages = make([]gin.H, 0)
	rc.allActs = make([]mcpActionItem, 0)
	for _, p := range rc.snap.Pages {
		collectNodeInfo(p.PageID, p.Doc.Root, &rc.allUsages, &rc.allActs, rc.tableByID)
	}

	// Merge explicit table.sharedByMenus bindings when not already covered by a component props.table binding.
	seenPageTable := make(map[string]bool, len(rc.allUsages))
	for _, u := range rc.allUsages {
		pid, _ := u["pageId"].(string)
		tid, _ := u["tableId"].(string)
		seenPageTable[pid+"\x00"+tid] = true
	}
	for _, t := range rc.snap.Tables {
		for _, m := range t.SharedByMenus {
			if !validPageIDs[m.PageID] {
				continue
			}
			key := m.PageID + "\x00" + t.ID
			if !seenPageTable[key] {
				seenPageTable[key] = true
				bindingPrefix := "菜单关联："
				if rc.en {
					bindingPrefix = "Menu binding: "
				}
				rc.allUsages = append(rc.allUsages, gin.H{
					"pageId":        m.PageID,
					"tableId":       t.ID,
					"tableName":     t.TableName,
					"cnName":        t.CNName,
					"componentPfId": nil,
					"componentType": nil,
					"bindingSource": bindingPrefix + m.AccessMode,
				})
			}
		}
	}

	rc.allFKs, rc.fkIssues = extractForeignKeys(rc.snap.Tables, tableByName, tableNameCount, rc.en)
	rc.axureSourceByCopy = make(map[string]string)
	rc.axureCopyBySource = make(map[string]string)
	rc.figmaSourceByCopy = make(map[string]string)
	rc.figmaCopyBySource = make(map[string]string)
	deprecatedByID := make(map[string]bool, len(rc.catalog))
	for _, entry := range rc.catalog {
		deprecatedByID[entry.PageID] = entry.Deprecated
	}
	for _, p := range rc.snap.Pages {
		if srcID := verifiedRemoteAxureSourceID(p.PageID, p.Doc.Header); srcID != "" {
			rc.axureSourceByCopy[p.PageID] = srcID
			if !deprecatedByID[p.PageID] && validPageIDs[srcID] {
				rc.axureCopyBySource[srcID] = p.PageID
			}
		}
		if srcID := verifiedRemoteFigmaSourceID(p.PageID, p.Doc.Header); srcID != "" {
			rc.figmaSourceByCopy[p.PageID] = srcID
			if !deprecatedByID[p.PageID] && validPageIDs[srcID] {
				rc.figmaCopyBySource[srcID] = p.PageID
			}
		}
	}
	return nil
}

func registerMcpRoutes(api *gin.RouterGroup, rateLimit gin.HandlerFunc, store Store, options Options) {
	mcpGroup := api.Group("/mcp")
	mcpGroup.Use(rateLimit)

	// Per MCP Streamable HTTP specification (2025-03-26), stateless servers that do not push
	// standalone server-initiated SSE streams return 405 Method Not Allowed on GET.
	mcpGroup.GET("/:id", func(c *gin.Context) {
		c.Header("Allow", "POST, DELETE, OPTIONS")
		c.Status(http.StatusMethodNotAllowed)
	})

	mcpGroup.DELETE("/:id", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	mcpGroup.POST("/:id", func(c *gin.Context) {
		if ct := c.ContentType(); ct != "application/json" {
			c.AbortWithStatusJSON(http.StatusUnsupportedMediaType, jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      json.RawMessage("null"),
				Error:   &jsonRpcError{Code: -32700, Message: "Content-Type must be application/json"},
			})
			return
		}

		p, err := store.Get(c.Request.Context(), c.Param("id"), "")
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				c.AbortWithStatusJSON(http.StatusNotFound, jsonRpcResponse{
					JSONRPC: "2.0",
					ID:      json.RawMessage("null"),
					Error:   &jsonRpcError{Code: -32004, Message: msg(c, "分享不存在或无权访问", "Share not found or access denied")},
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      json.RawMessage("null"),
				Error:   &jsonRpcError{Code: -32603, Message: msg(c, "发布服务暂时不可用", "Publishing service is temporarily unavailable")},
			})
			return
		}

		if p.RevokedAt != nil || (p.ExpiresAt != nil && !p.ExpiresAt.After(time.Now())) {
			c.AbortWithStatusJSON(http.StatusGone, jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      json.RawMessage("null"),
				Error:   &jsonRpcError{Code: -32010, Message: msg(c, "此分享已撤回或过期，请联系发布者", "This share link has been revoked or has expired. Please contact the publisher")},
			})
			return
		}

		if p.PasswordHash != "" {
			pw := extractMcpPassword(c)
			if pw == "" || len(pw) > 128 || !CheckPassword(pw, p.PasswordHash) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, jsonRpcResponse{
					JSONRPC: "2.0",
					ID:      json.RawMessage("null"),
					Error:   &jsonRpcError{Code: -32001, Message: msg(c, "此在线分享受访问密码保护，请在 MCP headers 中传入 X-Protoflow-Password", "This online share is password-protected. Pass X-Protoflow-Password in MCP headers")},
				})
				return
			}
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxMcpRequestBytes)
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, jsonRpcResponse{
					JSONRPC: "2.0",
					ID:      json.RawMessage("null"),
					Error:   &jsonRpcError{Code: -32600, Message: msg(c, "MCP 请求体超过 64 KiB 限制", "MCP request body exceeds the 64 KiB limit")},
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusBadRequest, jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      json.RawMessage("null"),
				Error:   &jsonRpcError{Code: -32700, Message: msg(c, "无法读取请求体", "Failed to read request body")},
			})
			return
		}

		trimmed := bytes.TrimSpace(bodyBytes)
		if len(trimmed) == 0 {
			c.AbortWithStatusJSON(http.StatusBadRequest, jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      json.RawMessage("null"),
				Error:   &jsonRpcError{Code: -32700, Message: msg(c, "空的 JSON-RPC 请求", "Empty JSON-RPC request")},
			})
			return
		}

		shareURL := options.PublicOrigin + "/p/" + p.ID
		if options.PublicOrigin == "" {
			scheme := "http"
			if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
				scheme = "https"
			}
			shareURL = scheme + "://" + c.Request.Host + "/p/" + p.ID
		}

		isEn := isEnRequest(c)
		reqCtx := &mcpRequestContext{pub: p, shareURL: shareURL, en: isEn}

		if trimmed[0] == '[' {
			batch, batchErr := decodeBoundedBatch(trimmed, maxMcpBatchSize)
			if errors.Is(batchErr, errMcpBatchTooLarge) {
				c.AbortWithStatusJSON(http.StatusOK, jsonRpcResponse{
					JSONRPC: "2.0",
					ID:      json.RawMessage("null"),
					Error: &jsonRpcError{Code: -32600, Message: msg(c,
						fmt.Sprintf("批量请求数量不能超过 %d 条", maxMcpBatchSize),
						fmt.Sprintf("Batch request cannot exceed %d items", maxMcpBatchSize),
					)},
				})
				return
			}
			if batchErr != nil || len(batch) == 0 {
				c.AbortWithStatusJSON(http.StatusOK, jsonRpcResponse{
					JSONRPC: "2.0",
					ID:      json.RawMessage("null"),
					Error:   &jsonRpcError{Code: -32600, Message: "Invalid batch JSON-RPC request"},
				})
				return
			}

			type batchSlot struct {
				expects  bool
				errFrame json.RawMessage
			}
			slots := make([]batchSlot, len(batch))
			for i, rawItem := range batch {
				expects, respID := classifyBatchItem(rawItem)
				if expects {
					ef, _ := json.Marshal(budgetLimitResponse(respID, isEn))
					slots[i] = batchSlot{expects: true, errFrame: ef}
				}
			}
			// Precompute exact byte reserve required after slot i if every remaining
			// non-notification item must fall back to a -32005 budget error frame.
			suffixReserve := make([]int, len(batch))
			priorExpected := make([]bool, len(batch))
			seenExp := false
			for i := range batch {
				priorExpected[i] = seenExp
				if slots[i].expects {
					seenExp = true
				}
			}
			runningSuffix := 0
			for i := len(batch) - 1; i >= 0; i-- {
				suffixReserve[i] = runningSuffix
				if slots[i].expects {
					sep := 0
					if priorExpected[i] {
						sep = 1
					}
					runningSuffix += sep + len(slots[i].errFrame)
				}
			}

			encodedItems := make([]json.RawMessage, 0, len(batch))
			totalBytes := 2 // '[' and ']'
			budgetExceeded := false
			appendFrame := func(frameBytes []byte) {
				if len(encodedItems) > 0 {
					totalBytes++
				}
				totalBytes += len(frameBytes)
				encodedItems = append(encodedItems, frameBytes)
			}

			for i, rawItem := range batch {
				if !slots[i].expects {
					continue
				}
				if budgetExceeded {
					appendFrame(slots[i].errFrame)
					continue
				}
				resp := dispatchSingleMcp(rawItem, reqCtx)
				if resp == nil {
					continue
				}
				frameBytes, err := json.Marshal(resp)
				sep := 0
				if len(encodedItems) > 0 {
					sep = 1
				}
				if err != nil || totalBytes+sep+len(frameBytes)+suffixReserve[i] > maxMcpResponseBytes {
					budgetExceeded = true
					appendFrame(slots[i].errFrame)
					continue
				}
				appendFrame(frameBytes)
			}
			if len(encodedItems) == 0 {
				c.Status(http.StatusAccepted)
				return
			}
			c.Data(http.StatusOK, "application/json; charset=utf-8", joinJsonArray(encodedItems))
			return
		}

		resp := dispatchSingleMcp(trimmed, reqCtx)
		if resp == nil {
			c.Status(http.StatusAccepted)
			return
		}
		frameBytes, err := json.Marshal(resp)
		if err != nil || len(frameBytes) > maxMcpResponseBytes {
			c.JSON(http.StatusOK, budgetLimitResponse(resp.ID, isEn))
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", frameBytes)
	})
}

func decodeBoundedBatch(body []byte, maxItems int) ([]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	delim, ok := tok.(json.Delim)
	if !ok || delim != '[' {
		return nil, errors.New("expected JSON array")
	}
	items := make([]json.RawMessage, 0, maxItems)
	for dec.More() {
		if len(items) >= maxItems {
			return nil, errMcpBatchTooLarge
		}
		var elem json.RawMessage
		if err := dec.Decode(&elem); err != nil {
			return nil, err
		}
		items = append(items, elem)
	}
	endTok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if endDelim, ok := endTok.(json.Delim); !ok || endDelim != ']' {
		return nil, errors.New("unclosed JSON array")
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("trailing tokens after batch array")
	}
	return items, nil
}

func marshalCompactJSON(v any) (json.RawMessage, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return json.RawMessage(bytes.TrimRight(buf.Bytes(), "\n")), nil
}

func sanitizeRpcID(raw json.RawMessage) (json.RawMessage, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return json.RawMessage("null"), true
	}
	if trimmed[0] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil || len(s) > maxMcpRpcIDBytes {
			return json.RawMessage("null"), false
		}
		canonical, err := marshalCompactJSON(s)
		if err != nil {
			return json.RawMessage("null"), false
		}
		return canonical, true
	}
	if (trimmed[0] == '-' || (trimmed[0] >= '0' && trimmed[0] <= '9')) && json.Valid(trimmed) {
		// Echo the exact number token. The request body already bounds its size.
		return trimmed, true
	}
	return json.RawMessage("null"), false
}

func optEn(isEn ...bool) bool {
	return len(isEn) > 0 && isEn[0]
}

func budgetLimitResponse(id json.RawMessage, isEn ...bool) jsonRpcResponse {
	safeID, _ := sanitizeRpcID(id)
	message := "MCP 响应体积超过单次 4 MiB 上限，请指定具体的 pageId 或 tableNames 按需分批读取"
	if optEn(isEn...) {
		message = "MCP response exceeds the 4 MiB single-request limit. Specify pageId or tableNames to read incrementally"
	}
	return jsonRpcResponse{
		JSONRPC: "2.0",
		ID:      safeID,
		Error: &jsonRpcError{
			Code:    -32005,
			Message: message,
		},
	}
}

func joinJsonArray(items []json.RawMessage) []byte {
	total := 2
	for i, it := range items {
		if i > 0 {
			total++
		}
		total += len(it)
	}
	out := make([]byte, 0, total)
	out = append(out, '[')
	for i, it := range items {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, it...)
	}
	out = append(out, ']')
	return out
}

func classifyBatchItem(raw json.RawMessage) (bool, json.RawMessage) {
	var req jsonRpcRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return true, json.RawMessage("null")
	}
	isNotification := len(req.ID) == 0
	id, validID := sanitizeRpcID(req.ID)
	if !isNotification && !validID {
		return true, json.RawMessage("null")
	}
	if req.Method == "" {
		if isNotification {
			return false, nil
		}
		return true, id
	}
	if isNotification || strings.HasPrefix(req.Method, "notifications/") {
		return false, nil
	}
	return true, id
}

func extractMcpPassword(c *gin.Context) string {
	if b64 := strings.TrimSpace(c.GetHeader("X-Protoflow-Password-Base64")); b64 != "" && len(b64) <= 256 {
		decoded, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			decoded, err = base64.RawStdEncoding.DecodeString(b64)
		}
		if err == nil && len(decoded) > 0 {
			return string(decoded)
		}
	}
	if pw := c.GetHeader("X-Protoflow-Password"); pw != "" {
		return pw
	}
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

func dispatchSingleMcp(raw json.RawMessage, reqCtx *mcpRequestContext) *jsonRpcResponse {
	var req jsonRpcRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return &jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      json.RawMessage("null"),
			Error:   &jsonRpcError{Code: -32700, Message: "Parse error"},
		}
	}
	isNotification := len(req.ID) == 0
	id, validID := sanitizeRpcID(req.ID)
	if !isNotification && !validID {
		return &jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      json.RawMessage("null"),
			Error:   &jsonRpcError{Code: -32600, Message: "Invalid JSON-RPC id"},
		}
	}
	if req.Method == "" {
		if isNotification {
			return nil
		}
		return &jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      id,
			Error:   &jsonRpcError{Code: -32600, Message: "Missing method"},
		}
	}
	if isNotification || strings.HasPrefix(req.Method, "notifications/") {
		return nil
	}

	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		proto := "2025-03-26"
		if supportedMcpProtocols[params.ProtocolVersion] {
			proto = params.ProtocolVersion
		}
		return &jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      id,
			Result: gin.H{
				"protocolVersion": proto,
				"capabilities": gin.H{
					"tools":     gin.H{},
					"prompts":   gin.H{},
					"resources": gin.H{},
				},
				"serverInfo": gin.H{
					"name":    mcpServerName,
					"version": mcpServerVersion,
				},
				"instructions": "Alex (ProtoFlow AI) Remote Read-Only Specification MCP Server. Call protoflow_get_project_overview first, then protoflow_get_database_schema and protoflow_get_page_spec.",
			},
		}

	case "ping":
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: gin.H{}}

	case "tools/list":
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: gin.H{"tools": mcpToolDefinitions()}}

	case "prompts/list":
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: gin.H{"prompts": mcpPromptDefinitions()}}

	case "resources/list":
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: gin.H{"resources": mcpResourceDefinitions()}}

	case "resources/templates/list":
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: gin.H{"resourceTemplates": []any{}}}

	case "tools/call":
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil || strings.TrimSpace(params.Name) == "" {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Error:   &jsonRpcError{Code: -32602, Message: "Missing or invalid tool name"},
			}
		}
		if err := reqCtx.ensureLoaded(); err != nil {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Result: gin.H{
					"content": []gin.H{{"type": "text", "text": err.Error()}},
					"isError": true,
				},
			}
		}
		out, toolErr := executeRemoteMcpTool(reqCtx, params.Name, params.Arguments)
		if toolErr != nil {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Result: gin.H{
					"content": []gin.H{{"type": "text", "text": toolErr.Error()}},
					"isError": true,
				},
			}
		}
		encoded, _ := json.MarshalIndent(out, "", "  ")
		return &jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      id,
			Result: gin.H{
				"content": []gin.H{{"type": "text", "text": string(encoded)}},
				"isError": false,
			},
		}

	case "prompts/get":
		var params struct {
			Name      string            `json:"name"`
			Arguments map[string]string `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil || strings.TrimSpace(params.Name) == "" {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Error:   &jsonRpcError{Code: -32602, Message: "Missing prompt name"},
			}
		}
		res, err := buildRemoteMcpPrompt(reqCtx.pub.Title, params.Name, params.Arguments, reqCtx.en)
		if err != nil {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Error:   &jsonRpcError{Code: -32602, Message: err.Error()},
			}
		}
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: res}

	case "resources/read":
		var params struct {
			URI string `json:"uri"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil || strings.TrimSpace(params.URI) == "" {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Error:   &jsonRpcError{Code: -32602, Message: "Missing resource uri"},
			}
		}
		if err := reqCtx.ensureLoaded(); err != nil {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Error:   &jsonRpcError{Code: -32603, Message: err.Error()},
			}
		}
		res, err := readRemoteMcpResource(reqCtx, params.URI)
		if err != nil {
			return &jsonRpcResponse{
				JSONRPC: "2.0",
				ID:      id,
				Error:   &jsonRpcError{Code: -32602, Message: err.Error()},
			}
		}
		return &jsonRpcResponse{JSONRPC: "2.0", ID: id, Result: res}

	default:
		return &jsonRpcResponse{
			JSONRPC: "2.0",
			ID:      id,
			Error:   &jsonRpcError{Code: -32601, Message: "Method not found: " + req.Method},
		}
	}
}

func normalizeRpcID(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return raw
}

func mcpToolDefinitions() []gin.H {
	ro := gin.H{"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}
	return []gin.H{
		{
			"name":        "protoflow_get_project_overview",
			"description": "Get the high-level architecture of the Alex (ProtoFlow AI) prototype project: metadata, hierarchical navigation sitemap, page catalog with table bindings, database table summary, and diagnostics. Call this tool FIRST.",
			"annotations": ro,
			"inputSchema": gin.H{
				"type": "object",
				"properties": gin.H{
					"includeDiagnostics": gin.H{"type": "boolean"},
				},
				"additionalProperties": false,
			},
		},
		{
			"name":        "protoflow_get_database_schema",
			"description": "Get ER physical table schemas, primary/foreign keys, unique constraints, PostgreSQL or MySQL DDL draft, and optional seed rows. Check uniqueConstraintsComplete and warnings before running DDL from legacy online shares.",
			"annotations": ro,
			"inputSchema": gin.H{
				"type": "object",
				"properties": gin.H{
					"tableNames":        gin.H{"type": "array", "items": gin.H{"type": "string"}},
					"dialect":           gin.H{"type": "string", "enum": []string{"postgres", "mysql"}},
					"includeSampleRows": gin.H{"type": "boolean"},
					"sampleRowLimit":    gin.H{"type": "integer", "minimum": 1, "maximum": 50},
				},
				"additionalProperties": false,
			},
		},
		{
			"name":        "protoflow_get_page_spec",
			"description": "Get the full specification of a single prototype page: route path, desktop/mobile viewport mode, bound physical tables, interactive actions, component-pinned product sticky notes, component outline, and TSX prototype source.",
			"annotations": ro,
			"inputSchema": gin.H{
				"type": "object",
				"properties": gin.H{
					"pageId":        gin.H{"type": "string"},
					"includeSource": gin.H{"type": "boolean"},
				},
				"required":             []string{"pageId"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "protoflow_get_docs_and_flows",
			"description": "Read product requirement notes (converted to clean Markdown) attached to the published prototype or linked to a specific page.",
			"annotations": ro,
			"inputSchema": gin.H{
				"type": "object",
				"properties": gin.H{
					"noteId":    gin.H{"type": "string"},
					"mindmapId": gin.H{"type": "string"},
					"pageId":    gin.H{"type": "string"},
				},
				"additionalProperties": false,
			},
		},
		{
			"name":        "protoflow_search_spec",
			"description": "Search across all database tables/columns, page TSX components, product sticky notes, and requirement notes by keyword.",
			"annotations": ro,
			"inputSchema": gin.H{
				"type": "object",
				"properties": gin.H{
					"query": gin.H{"type": "string", "minLength": 1},
					"limit": gin.H{"type": "integer", "minimum": 1, "maximum": 100},
				},
				"required":             []string{"query"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "protoflow_get_implementation_checklist",
			"description": "Generate a structured full-stack engineering checklist (database migrations, CRUD/state-transition API endpoints inferred from page actions, frontend pages, and active sticky-note business rules).",
			"annotations": ro,
			"inputSchema": gin.H{
				"type": "object",
				"properties": gin.H{
					"moduleKeyword": gin.H{"type": "string"},
				},
				"additionalProperties": false,
			},
		},
	}
}

func mcpPromptDefinitions() []gin.H {
	return []gin.H{
		{
			"name":        "implement-module",
			"description": "Step-by-step workflow to implement a production full-stack module from the Alex (ProtoFlow AI) prototype.",
			"arguments": []gin.H{
				{"name": "moduleKeyword", "description": "Target module or page keyword (optional).", "required": false},
				{"name": "techStack", "description": "Target production stack (optional).", "required": false},
			},
		},
		{
			"name":        "generate-db-layer",
			"description": "Generate database migrations, ORM models, foreign keys, and realistic seed data from the prototype ER schema.",
			"arguments": []gin.H{
				{"name": "dialect", "description": "postgres or mysql (default: postgres).", "required": false},
				{"name": "orm", "description": "Target ORM or migration tool.", "required": false},
			},
		},
	}
}

func mcpResourceDefinitions() []gin.H {
	return []gin.H{
		{
			"uri":         "protoflow://spec/markdown",
			"name":        "Full Project Specification (SPEC.md)",
			"description": "Complete Markdown specification compiled from published pages, ER tables, actions, and sticky notes.",
			"mimeType":    "text/markdown",
		},
		{
			"uri":         "protoflow://database/schema.postgres.sql",
			"name":        "PostgreSQL Schema Draft (DDL)",
			"description": "PostgreSQL CREATE TABLE and FOREIGN KEY DDL draft generated from the prototype ER model.",
			"mimeType":    "application/sql",
		},
		{
			"uri":         "protoflow://database/schema.mysql.sql",
			"name":        "MySQL Schema Draft (DDL)",
			"description": "MySQL CREATE TABLE and FOREIGN KEY DDL draft generated from the prototype ER model.",
			"mimeType":    "application/sql",
		},
	}
}

func buildPageCatalog(snap *mcpSnapshot) []pageCatalogEntry {
	pageSet := map[string]mcpPage{}
	for _, p := range snap.Pages {
		pageSet[p.PageID] = p
	}
	var out []pageCatalogEntry
	if snap.FormatVersion >= 3 && len(snap.Sitemap) > 0 {
		var visit func(items []mcpSitemapItem, prefix []string, archived bool)
		visit = func(items []mcpSitemapItem, prefix []string, archived bool) {
			for _, it := range items {
				dep := archived || it.Deprecated
				if it.Type == "folder" {
					visit(it.Children, append(append([]string{}, prefix...), it.Title), dep)
				} else if it.PageID != nil && *it.PageID != "" {
					_, hasSrc := pageSet[*it.PageID]
					out = append(out, pageCatalogEntry{
						PageID:     *it.PageID,
						Title:      it.Title,
						Path:       strings.Join(append(append([]string{}, prefix...), it.Title), " / "),
						Deprecated: dep,
						HasSource:  hasSrc,
					})
				}
			}
		}
		visit(snap.Sitemap, nil, false)
		return out
	}
	for _, p := range snap.Pages {
		out = append(out, pageCatalogEntry{
			PageID:    p.PageID,
			Title:     p.Title,
			Path:      p.FolderID + " / " + p.Title,
			HasSource: true,
		})
	}
	return out
}

func collectNodeInfo(pageID string, node mcpNode, usages *[]gin.H, actions *[]mcpActionItem, tableByID map[string]mcpTable) {
	if node.Kind != "node" {
		return
	}
	if tblID, ok := node.Props["table"].(string); ok && tblID != "" {
		if tbl, exists := tableByID[tblID]; exists {
			*usages = append(*usages, gin.H{
				"pageId":        pageID,
				"tableId":       tblID,
				"tableName":     tbl.TableName,
				"cnName":        tbl.CNName,
				"componentPfId": node.PfID,
				"componentType": node.Type,
				"bindingSource": node.Type + ".table",
			})
		}
	}
	if activeTblID, ok := node.Props["activeTable"].(string); ok && activeTblID != "" {
		if tbl, exists := tableByID[activeTblID]; exists {
			*usages = append(*usages, gin.H{
				"pageId":        pageID,
				"tableId":       activeTblID,
				"tableName":     tbl.TableName,
				"cnName":        tbl.CNName,
				"componentPfId": node.PfID,
				"componentType": node.Type,
				"bindingSource": node.Type + ".activeTable",
			})
		}
	}
	for eventKey, val := range node.Props {
		extractActionsFromValue(pageID, node.PfID, node.Type, eventKey, val, actions)
	}
	for _, child := range node.Children {
		collectNodeInfo(pageID, child, usages, actions, tableByID)
	}
}

func extractActionsFromValue(pageID, pfID, compType, event string, val any, out *[]mcpActionItem) {
	switch v := val.(type) {
	case map[string]any:
		if kind, _ := v["$kind"].(string); kind == "actions" {
			if rawCalls, ok := v["calls"].([]any); ok {
				for _, rc := range rawCalls {
					if cm, ok := rc.(map[string]any); ok {
						name, _ := cm["name"].(string)
						args, _ := cm["args"].([]any)
						if name != "" {
							*out = append(*out, mcpActionItem{
								PageID:        pageID,
								PfID:          pfID,
								ComponentType: compType,
								Event:         event,
								ActionName:    name,
								Args:          args,
							})
						}
					}
				}
			}
			return
		}
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			extractActionsFromValue(pageID, pfID, compType, event+"."+k, v[k], out)
		}
	case []any:
		for idx, elem := range v {
			extractActionsFromValue(pageID, pfID, compType, fmt.Sprintf("%s[%d]", event, idx), elem, out)
		}
	}
}

var fkRefRe = regexp.MustCompile(`^([A-Za-z0-9_]+)\(([A-Za-z0-9_]+)\)$`)
var jsIdentRe = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)

func tableHasColumnName(tbl mcpTable, colName string) bool {
	for _, col := range tbl.Columns {
		if col.Name == colName {
			return true
		}
	}
	return false
}

func tableSingleColumnUniqueSet(tbl mcpTable) map[string]bool {
	uniques := map[string]bool{}
	colNameByID := map[string]string{}
	var pkCols []string
	for _, col := range tbl.Columns {
		colNameByID[col.ID] = col.Name
		if col.IsPrimaryKey {
			pkCols = append(pkCols, col.Name)
		}
		if col.IsUnique {
			uniques[col.Name] = true
		}
	}
	if len(pkCols) == 1 {
		uniques[pkCols[0]] = true
	}
	for _, uc := range tbl.UniqueConstraints {
		if len(uc.ColumnIDs) == 1 {
			if cname := colNameByID[uc.ColumnIDs[0]]; cname != "" {
				uniques[cname] = true
			}
		}
	}
	return uniques
}

func extractForeignKeys(tables []mcpTable, tableByName map[string]mcpTable, tableNameCount map[string]int, isEnOpt ...bool) ([]mcpForeignKey, []mcpFkIssue) {
	isEn := optEn(isEnOpt...)
	fks := make([]mcpForeignKey, 0)
	issues := make([]mcpFkIssue, 0)
	singleUniquesByTableID := map[string]map[string]bool{}
	for _, t := range tables {
		singleUniquesByTableID[t.ID] = tableSingleColumnUniqueSet(t)
	}
	for _, t := range tables {
		for _, c := range t.Columns {
			refTrimmed := strings.TrimSpace(c.References)
			if refTrimmed == "" && !c.IsForeignKey {
				continue
			}
			m := fkRefRe.FindStringSubmatch(refTrimmed)
			parentTbl, exists := mcpTable{}, false
			if m != nil && tableNameCount[m[1]] == 1 {
				parentTbl, exists = tableByName[m[1]]
			}
			if m == nil || !exists || !tableHasColumnName(parentTbl, m[2]) {
				refLabel := refTrimmed
				if refLabel == "" {
					if isEn {
						refLabel = "unspecified"
					} else {
						refLabel = "未填写"
					}
				}
				msgText := fmt.Sprintf("%s.%s：外键引用 %s 无法解析", t.TableName, c.Name, refLabel)
				if isEn {
					msgText = fmt.Sprintf("%s.%s: foreign key reference %s could not be resolved", t.TableName, c.Name, refLabel)
				}
				issues = append(issues, mcpFkIssue{
					TableID: t.ID,
					Message: msgText,
				})
				continue
			}
			parentUniques := singleUniquesByTableID[parentTbl.ID]
			if parentUniques == nil {
				parentUniques = tableSingleColumnUniqueSet(parentTbl)
			}
			if !parentUniques[m[2]] {
				msgText := fmt.Sprintf("%s.%s：外键引用 %s 的目标列缺少单列主键或 UNIQUE 约束，已跳过外键 DDL", t.TableName, c.Name, refTrimmed)
				if isEn {
					msgText = fmt.Sprintf("%s.%s: target column of foreign key reference %s lacks a single-column PRIMARY KEY or UNIQUE constraint; skipped foreign key DDL", t.TableName, c.Name, refTrimmed)
				}
				issues = append(issues, mcpFkIssue{
					TableID: t.ID,
					Message: msgText,
				})
				continue
			}
			name := fmt.Sprintf("fk_%s_%s", t.TableName, c.Name)
			card := "1:N"
			onDel := "RESTRICT"
			if c.ForeignKeyOptions != nil {
				if c.ForeignKeyOptions.Name != "" {
					name = c.ForeignKeyOptions.Name
				}
				if c.ForeignKeyOptions.Cardinality != "" {
					card = c.ForeignKeyOptions.Cardinality
				}
				if c.ForeignKeyOptions.OnDelete != "" {
					onDel = c.ForeignKeyOptions.OnDelete
				}
			}
			fks = append(fks, mcpForeignKey{
				ConstraintName:   name,
				FromTable:        t.TableName,
				FromTableID:      t.ID,
				FromColumn:       c.Name,
				ReferencesTable:  m[1],
				ReferencesID:     parentTbl.ID,
				ReferencesColumn: m[2],
				Cardinality:      card,
				OnDelete:         onDel,
			})
		}
	}
	return fks, issues
}

func quoteIdent(name, dialect string) string {
	if dialect == "mysql" {
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

var (
	pgBoolTypeRe       = regexp.MustCompile(`(?i)^(?:TINYINT\s*\(\s*1\s*\)(?:\s+UNSIGNED)?|BOOL|BOOLEAN)$`)
	mysqlIntegerTypeRe = regexp.MustCompile(`(?i)^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\s*\(\s*\d+\s*\))?(?:\s+(SIGNED|UNSIGNED))?(?:\s+(ZEROFILL))?$`)
	pgTimestampTypeRe  = regexp.MustCompile(`(?i)^(?:DATETIME|TIMESTAMP)(?:\s*\(\s*0*([0-6])\s*\))?$`)
	pgTextTypeRe       = regexp.MustCompile(`(?i)^(?:TINYTEXT|MEDIUMTEXT|LONGTEXT)$`)
	pgJsonTypeRe       = regexp.MustCompile(`(?i)^JSON$`)
	pgDoubleTypeRe     = regexp.MustCompile(`(?i)^DOUBLE(?:\s+PRECISION)?(?:\s*\(\s*\d+\s*,\s*\d+\s*\))?(?:\s+(?:UNSIGNED|SIGNED))?$`)
	pgFloatTypeRe      = regexp.MustCompile(`(?i)^FLOAT(?:\s*\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\))?(?:\s+(?:UNSIGNED|SIGNED))?$`)
	pgByteaTypeRe      = regexp.MustCompile(`(?i)^(?:LONGBLOB|MEDIUMBLOB|TINYBLOB|BLOB|(?:VAR)?BINARY(?:\s*\(\s*\d+\s*\))?)$`)
	pgEnumTypeRe       = regexp.MustCompile(`(?i)^ENUM\s*\(.*\)$`)
)

type integerMapping struct {
	signedType   string
	unsignedType string
	maximum      string
}

var postgresIntegerTypes = map[string]integerMapping{
	"TINYINT":   {"SMALLINT", "SMALLINT", "255"},
	"SMALLINT":  {"SMALLINT", "INTEGER", "65535"},
	"MEDIUMINT": {"INTEGER", "INTEGER", "16777215"},
	"INT":       {"INTEGER", "BIGINT", "4294967295"},
	"BIGINT":    {"BIGINT", "NUMERIC(20,0)", "18446744073709551615"},
}

func postgresIntegerType(declaration string) (sqlType, unsignedMaximum string) {
	m := mysqlIntegerTypeRe.FindStringSubmatch(strings.ToUpper(strings.TrimSpace(declaration)))
	if m == nil {
		return "", ""
	}
	name := m[1]
	if name == "INTEGER" {
		name = "INT"
	}
	mapping := postgresIntegerTypes[name]
	// ZEROFILL implies UNSIGNED even when no sign modifier is written.
	if m[2] == "UNSIGNED" || m[3] == "ZEROFILL" {
		return mapping.unsignedType, mapping.maximum
	}
	return mapping.signedType, ""
}

func mapSqlType(rawType, dialect string) string {
	trimmed := strings.TrimSpace(rawType)
	if dialect == "mysql" || strings.HasSuffix(trimmed, "]") {
		return trimmed
	}
	if pgBoolTypeRe.MatchString(trimmed) {
		return "BOOLEAN"
	}
	if integer, _ := postgresIntegerType(trimmed); integer != "" {
		return integer
	}
	if timestamp := pgTimestampTypeRe.FindStringSubmatch(trimmed); timestamp != nil {
		if timestamp[1] != "" {
			return "TIMESTAMPTZ(" + timestamp[1] + ")"
		}
		return "TIMESTAMPTZ"
	}
	if float := pgFloatTypeRe.FindStringSubmatch(trimmed); float != nil {
		// FLOAT(p) selects storage by binary precision. FLOAT(M,D) uses single precision.
		if float[1] == "" || float[2] != "" {
			return "REAL"
		}
		precision, err := strconv.Atoi(float[1])
		if err == nil && precision <= 24 {
			return "REAL"
		}
		if err == nil && precision <= 53 {
			return "DOUBLE PRECISION"
		}
		return trimmed
	}
	switch {
	case pgTextTypeRe.MatchString(trimmed):
		return "TEXT"
	case pgJsonTypeRe.MatchString(trimmed):
		return "JSONB"
	case pgDoubleTypeRe.MatchString(trimmed):
		return "DOUBLE PRECISION"
	case pgByteaTypeRe.MatchString(trimmed):
		return "BYTEA"
	case pgEnumTypeRe.MatchString(trimmed):
		return "VARCHAR(64)"
	default:
		return trimmed
	}
}

var textColRe = regexp.MustCompile(`(?i)^(?:(?:VAR)?CHAR|(?:TINY|MEDIUM|LONG)?TEXT|ENUM)\b`)
var bareTextTokenRe = regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_]*$`)
var sqlValueKeywordRe = regexp.MustCompile(`(?i)^(?:NULL|TRUE|FALSE|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|CURRENT_USER|LOCALTIME|LOCALTIMESTAMP)$`)

func formatMcpDefaultSql(c mcpColumn, mappedType, dialect string) string {
	if c.DefaultValue == nil {
		return ""
	}
	dv := strings.TrimSpace(*c.DefaultValue)
	if dv == "" {
		return ""
	}
	if dialect == "postgres" {
		if mappedType == "BOOLEAN" {
			if dv == "1" || dv == "'1'" {
				return "TRUE"
			}
			if dv == "0" || dv == "'0'" {
				return "FALSE"
			}
		}
		upperCompact := strings.ReplaceAll(strings.ToUpper(dv), " ", "")
		if upperCompact == "CURRENT_TIMESTAMP()" {
			return "CURRENT_TIMESTAMP"
		}
		if upperCompact == "CURRENT_DATE()" {
			return "CURRENT_DATE"
		}
	}
	// Only quote bare unquoted word tokens (e.g. 草稿, pending) on text columns; preserve SQL expressions such as uuid() or gen_random_uuid() verbatim.
	if textColRe.MatchString(c.DataType) && bareTextTokenRe.MatchString(dv) && !sqlValueKeywordRe.MatchString(dv) {
		return "'" + strings.ReplaceAll(dv, "'", "''") + "'"
	}
	return dv
}

func generateMcpDdl(tables []mcpTable, fks []mcpForeignKey, fkIssues []mcpFkIssue, dialect string, isEnOpt ...bool) string {
	isEn := optEn(isEnOpt...)
	var blocks []string
	for _, t := range tables {
		colByID := map[string]string{}
		var cols []string
		var pks []string
		for _, c := range t.Columns {
			colByID[c.ID] = c.Name
			colType := mapSqlType(c.DataType, dialect)
			nullStr := "NOT NULL"
			if c.Nullable {
				nullStr = "NULL"
			}
			uniqStr := ""
			if c.IsUnique {
				uniqStr = " UNIQUE"
			}
			defVal := formatMcpDefaultSql(c, colType, dialect)
			defStr := ""
			if defVal != "" {
				defStr = " DEFAULT " + defVal
			}
			line := fmt.Sprintf("  %s %s %s%s%s", quoteIdent(c.Name, dialect), colType, nullStr, uniqStr, defStr)
			if dialect == "postgres" && colType != "BOOLEAN" {
				if _, maximum := postgresIntegerType(c.DataType); maximum != "" {
					line += fmt.Sprintf(" CHECK (%s BETWEEN 0 AND %s)", quoteIdent(c.Name, dialect), maximum)
				}
			}
			if dialect == "mysql" && strings.TrimSpace(c.Comment) != "" {
				esc := strings.ReplaceAll(strings.ReplaceAll(c.Comment, "\n", " "), "'", "''")
				line += fmt.Sprintf(" COMMENT '%s'", esc)
			}
			cols = append(cols, line)
			if c.IsPrimaryKey {
				pks = append(pks, quoteIdent(c.Name, dialect))
			}
		}
		if len(pks) > 0 {
			cols = append(cols, fmt.Sprintf("  PRIMARY KEY (%s)", strings.Join(pks, ", ")))
		}
		for _, uc := range t.UniqueConstraints {
			var uCols []string
			for _, cid := range uc.ColumnIDs {
				if cname := colByID[cid]; cname != "" {
					uCols = append(uCols, quoteIdent(cname, dialect))
				}
			}
			if len(uCols) > 0 && uc.Name != "" {
				cols = append(cols, fmt.Sprintf("  CONSTRAINT %s UNIQUE (%s)", quoteIdent(uc.Name, dialect), strings.Join(uCols, ", ")))
			}
		}
		tableLabel := "表"
		if isEn {
			tableLabel = "Table"
		}
		stmt := fmt.Sprintf("-- %s: %s (%s)\nCREATE TABLE IF NOT EXISTS %s (\n%s\n);", tableLabel, t.TableName, t.CNName, quoteIdent(t.TableName, dialect), strings.Join(cols, ",\n"))
		if dialect == "postgres" {
			var comments []string
			if strings.TrimSpace(t.CNName) != "" {
				comments = append(comments, fmt.Sprintf("COMMENT ON TABLE %s IS '%s';", quoteIdent(t.TableName, dialect), strings.ReplaceAll(t.CNName, "'", "''")))
			}
			for _, c := range t.Columns {
				if strings.TrimSpace(c.Comment) != "" {
					comments = append(comments, fmt.Sprintf("COMMENT ON COLUMN %s.%s IS '%s';", quoteIdent(t.TableName, dialect), quoteIdent(c.Name, dialect), strings.ReplaceAll(strings.ReplaceAll(c.Comment, "\n", " "), "'", "''")))
				}
			}
			if len(comments) > 0 {
				stmt += "\n" + strings.Join(comments, "\n")
			}
		}
		blocks = append(blocks, stmt)
	}
	for _, fk := range fks {
		blocks = append(blocks, fmt.Sprintf(
			"ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE %s;",
			quoteIdent(fk.FromTable, dialect),
			quoteIdent(fk.ConstraintName, dialect),
			quoteIdent(fk.FromColumn, dialect),
			quoteIdent(fk.ReferencesTable, dialect),
			quoteIdent(fk.ReferencesColumn, dialect),
			fk.OnDelete,
		))
	}
	issuePrefix := "-- 待修复的外键引用："
	if isEn {
		issuePrefix = "-- Unresolved foreign key reference: "
	}
	for _, issue := range fkIssues {
		blocks = append(blocks, issuePrefix+strings.ReplaceAll(issue.Message, "\n", " "))
	}
	return strings.Join(blocks, "\n\n")
}

func isNumericLiteral(s string) bool {
	if s == "" {
		return false
	}
	for i, ch := range s {
		if i == 0 && ch == '-' {
			continue
		}
		if (ch < '0' || ch > '9') && ch != '.' {
			return false
		}
	}
	return true
}

func quoteJsString(s string) string {
	r := strings.NewReplacer(
		`\`, `\\`,
		`'`, `\'`,
		"\r", `\r`,
		"\n", `\n`,
		"\u2028", `\u2028`,
		"\u2029", `\u2029`,
	)
	return "'" + r.Replace(s) + "'"
}

func escapeJsxText(s string) string {
	if strings.ContainsAny(s, "{}<>") {
		return "{" + quoteJsString(s) + "}"
	}
	return s
}

func printRemotePageTsx(page mcpPage) string {
	var b strings.Builder
	for _, h := range page.Doc.Header {
		b.WriteString(h)
		b.WriteByte('\n')
	}
	b.WriteString("export default function Page() {\n  return (\n")
	b.WriteString(printRemoteNode(page.Doc.Root, 2))
	b.WriteString("\n  );\n}\n")
	return b.String()
}

func printRemoteNode(n mcpNode, depth int) string {
	pad := strings.Repeat("  ", depth)
	if n.Kind == "text" {
		return pad + escapeJsxText(n.Value)
	}
	var attrs []string
	attrs = append(attrs, fmt.Sprintf(`pfId="%s"`, n.PfID))
	keys := make([]string, 0, len(n.Props))
	for k := range n.Props {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := n.Props[k]
		switch tv := v.(type) {
		case bool:
			if tv {
				attrs = append(attrs, k)
			} else {
				attrs = append(attrs, fmt.Sprintf("%s={false}", k))
			}
		case string:
			if !strings.ContainsAny(tv, "\"\r\n\u2028\u2029\\{}&") {
				attrs = append(attrs, fmt.Sprintf(`%s="%s"`, k, tv))
			} else {
				attrs = append(attrs, fmt.Sprintf("%s={%s}", k, quoteJsString(tv)))
			}
		default:
			attrs = append(attrs, fmt.Sprintf("%s={%s}", k, printRemoteExpr(v)))
		}
	}
	open := fmt.Sprintf("%s<%s %s", pad, n.Type, strings.Join(attrs, " "))
	if len(n.Children) == 0 {
		return open + " />"
	}
	var childLines []string
	for _, c := range n.Children {
		childLines = append(childLines, printRemoteNode(c, depth+1))
	}
	return fmt.Sprintf("%s>\n%s\n%s</%s>", open, strings.Join(childLines, "\n"), pad, n.Type)
}

func printRemoteExpr(v any) string {
	if v == nil {
		return "null"
	}
	switch tv := v.(type) {
	case string:
		return quoteJsString(tv)
	case bool:
		if tv {
			return "true"
		}
		return "false"
	case float64:
		jb, _ := json.Marshal(tv)
		return string(jb)
	case []any:
		if len(tv) == 0 {
			return "[]"
		}
		parts := make([]string, 0, len(tv))
		for _, elem := range tv {
			parts = append(parts, printRemoteExpr(elem))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case map[string]any:
		if kind, _ := tv["$kind"].(string); kind == "actions" {
			rawCalls, _ := tv["calls"].([]any)
			if len(rawCalls) == 0 {
				return "() => {}"
			}
			var calls []string
			for _, rc := range rawCalls {
				if cm, ok := rc.(map[string]any); ok {
					name, _ := cm["name"].(string)
					args, _ := cm["args"].([]any)
					var argStrs []string
					for _, a := range args {
						argStrs = append(argStrs, printRemoteExpr(a))
					}
					calls = append(calls, fmt.Sprintf("%s(%s)", name, strings.Join(argStrs, ", ")))
				}
			}
			if len(calls) == 1 {
				return "() => " + calls[0]
			}
			return "() => { " + strings.Join(calls, "; ") + "; }"
		}
		if kind, _ := tv["$kind"].(string); kind == "raw" {
			code, _ := tv["code"].(string)
			return code
		}
		if len(tv) == 0 {
			return "{}"
		}
		keys := make([]string, 0, len(tv))
		for k := range tv {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			propKey := k
			if !jsIdentRe.MatchString(k) {
				propKey = quoteJsString(k)
			}
			parts = append(parts, fmt.Sprintf("%s: %s", propKey, printRemoteExpr(tv[k])))
		}
		return "{ " + strings.Join(parts, ", ") + " }"
	default:
		jb, _ := json.Marshal(v)
		return string(jb)
	}
}

func buildRemoteOutline(n mcpNode, depth int) gin.H {
	summary := gin.H{}
	for _, k := range []string{"id", "title", "subtitle", "label", "name", "table", "sourceForeignKey", "statusField", "placeholder", "type", "variant", "tone", "appearance", "accent", "surfaceBg", "motion", "xField", "yField", "seriesField", "categoryField", "valueField", "targetField", "amountField", "labelField"} {
		if val, ok := n.Props[k]; ok {
			switch val.(type) {
			case string, float64, bool:
				summary[k] = val
			}
		}
	}
	if rawCols, ok := n.Props["columns"].([]any); ok {
		var cols []string
		for _, item := range rawCols {
			if rec, ok := item.(map[string]any); ok {
				fieldKey := ""
				if di, ok := rec["dataIndex"].(string); ok && strings.TrimSpace(di) != "" {
					fieldKey = strings.TrimSpace(di)
				} else if k, ok := rec["key"].(string); ok && strings.TrimSpace(k) != "" {
					fieldKey = strings.TrimSpace(k)
				}
				title := ""
				if t, ok := rec["title"].(string); ok && strings.TrimSpace(t) != "" {
					title = strings.TrimSpace(t)
				}
				if fieldKey != "" && title != "" {
					cols = append(cols, fmt.Sprintf("%s(%s)", fieldKey, title))
				} else if fieldKey != "" {
					cols = append(cols, fieldKey)
				} else if title != "" {
					cols = append(cols, title)
				}
			}
		}
		if len(cols) > 0 {
			summary["columns"] = cols
		}
	}
	var texts []string
	var kids []gin.H
	for _, c := range n.Children {
		if c.Kind == "text" && strings.TrimSpace(c.Value) != "" {
			texts = append(texts, strings.TrimSpace(c.Value))
		} else if c.Kind == "node" && depth < 8 {
			kids = append(kids, buildRemoteOutline(c, depth+1))
		}
	}
	resolvedText := strings.Join(texts, " ")
	if resolvedText == "" {
		if propTxt, ok := n.Props["text"].(string); ok && strings.TrimSpace(propTxt) != "" {
			resolvedText = strings.TrimSpace(propTxt)
		}
	}
	out := gin.H{"pfId": n.PfID, "type": n.Type}
	if len(summary) > 0 {
		out["summaryProps"] = summary
	}
	if resolvedText != "" {
		if runes := []rune(resolvedText); len(runes) > 120 {
			resolvedText = string(runes[:120])
		}
		out["text"] = resolvedText
	}
	if len(kids) > 0 {
		out["children"] = kids
	}
	return out
}

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)

func stripHtmlToMarkdown(title, icon, updatedAt, rawHTML string, isEnOpt ...bool) string {
	isEn := optEn(isEnOpt...)
	clean := rawHTML
	clean = strings.ReplaceAll(clean, "</p>", "\n\n")
	clean = strings.ReplaceAll(clean, "<br>", "\n")
	clean = strings.ReplaceAll(clean, "<br/>", "\n")
	clean = strings.ReplaceAll(clean, "<br />", "\n")
	clean = strings.ReplaceAll(clean, "<li>", "- ")
	clean = strings.ReplaceAll(clean, "</li>", "\n")
	clean = strings.ReplaceAll(clean, "</h1>", "\n\n")
	clean = strings.ReplaceAll(clean, "</h2>", "\n\n")
	clean = strings.ReplaceAll(clean, "</h3>", "\n\n")
	clean = htmlTagRe.ReplaceAllString(clean, "")
	clean = html.UnescapeString(clean)
	header := "# " + strings.TrimSpace(icon+" "+title)
	if isEn {
		return header + "\n> Updated: " + updatedAt + "\n\n" + strings.TrimSpace(clean)
	}
	return header + "\n> 更新时间：" + updatedAt + "\n\n" + strings.TrimSpace(clean)
}

func legacyUniqueWarning(formatVersion int, isEnOpt ...bool) string {
	isEn := optEn(isEnOpt...)
	if formatVersion >= 5 {
		return ""
	}
	if isEn {
		return fmt.Sprintf("This online share uses legacy publication format (V%d) without column-level isUnique or table-level uniqueConstraints metadata; republish in V5+ format or verify the source project before running DDL.", formatVersion)
	}
	return fmt.Sprintf("当前在线分享为旧版发布格式（V%d），未保存字段级 isUnique 与表级 uniqueConstraints 唯一约束元数据；请重新发布为 V5+ 格式或核对原工程后再执行建表。", formatVersion)
}

func executeRemoteMcpTool(rc *mcpRequestContext, name string, args map[string]any) (any, error) {
	if args == nil {
		args = map[string]any{}
	}
	snap := &rc.snap
	pub := rc.pub
	shareURL := rc.shareURL
	catalog := rc.catalog
	pageByID := rc.pageByID
	allUsages := rc.allUsages
	allActions := rc.allActs
	allFKs := rc.allFKs

	switch name {
	case "protoflow_get_project_overview":
		pagesOut := make([]gin.H, 0)
		activePages := 0
		archivedPages := 0
		for _, entry := range catalog {
			if entry.Deprecated {
				archivedPages++
			} else {
				activePages++
			}
			boundSet := map[string]bool{}
			boundList := make([]string, 0)
			for _, u := range allUsages {
				if u["pageId"] == entry.PageID {
					tn, _ := u["tableName"].(string)
					if tn != "" && !boundSet[tn] {
						boundSet[tn] = true
						boundList = append(boundList, tn)
					}
				}
			}
			stickyCnt := 0
			for _, s := range snap.StickyNotes {
				if s.PageID == entry.PageID && s.Active {
					stickyCnt++
				}
			}
			platform := "desktop"
			if pg, ok := pageByID[entry.PageID]; ok && pg.Doc.Root.Type == "MobilePage" {
				platform = "mobile"
			}
			pageItem := gin.H{
				"pageId":            entry.PageID,
				"title":             entry.Title,
				"path":              entry.Path,
				"platform":          platform,
				"hasSource":         entry.HasSource,
				"deprecated":        entry.Deprecated,
				"boundTables":       boundList,
				"activeStickyCount": stickyCnt,
			}
			if srcID := rc.axureSourceByCopy[entry.PageID]; srcID != "" {
				pageItem["axureSourcePageId"] = srcID
			}
			if srcID := rc.figmaSourceByCopy[entry.PageID]; srcID != "" {
				pageItem["figmaSourcePageId"] = srcID
			}
			if optID := rc.axureCopyBySource[entry.PageID]; optID != "" {
				pageItem["optimizedPageId"] = optID
			} else if optID := rc.figmaCopyBySource[entry.PageID]; optID != "" {
				pageItem["optimizedPageId"] = optID
			}
			pagesOut = append(pagesOut, pageItem)
		}

		tablesOut := make([]gin.H, 0)
		for _, t := range snap.Tables {
			tablesOut = append(tablesOut, gin.H{
				"id":             t.ID,
				"tableName":      t.TableName,
				"cnName":         t.CNName,
				"domain":         t.Domain,
				"description":    t.Description,
				"columnCount":    len(t.Columns),
				"sampleRowCount": len(snap.TableRows[t.ID]),
				"sharedMenus":    t.SharedByMenus,
			})
		}

		activeStickies := 0
		for _, s := range snap.StickyNotes {
			if s.Active {
				activeStickies++
			}
		}

		return gin.H{
			"project": gin.H{
				"projectId":                 snap.ProjectID,
				"projectName":               snap.Title,
				"sourceKind":                "remote",
				"source":                    shareURL,
				"revision":                  fmt.Sprintf("v%d", pub.Version),
				"formatVersion":             snap.FormatVersion,
				"uniqueConstraintsComplete": snap.FormatVersion >= 5,
				"updatedAt":                 pub.UpdatedAt.UTC().Format(time.RFC3339),
				"entryPageId":               snap.EntryPageID,
			},
			"designTokens": exportRemoteDesignTokensSpec(snap.DesignTokens, rc.en),
			"counts": gin.H{
				"pages":             activePages,
				"archivedPages":     archivedPages,
				"tables":            len(snap.Tables),
				"foreignKeys":       len(allFKs),
				"activeStickyNotes": activeStickies,
				"notes":             len(snap.Notes),
				"mindmaps":          0,
			},
			"sitemap":    snap.Sitemap,
			"pages":      pagesOut,
			"tables":     tablesOut,
			"agreements": []any{},
		}, nil

	case "protoflow_get_database_schema":
		dialect := "postgres"
		if d, ok := args["dialect"].(string); ok && d == "mysql" {
			dialect = "mysql"
		}
		includeRows := true
		if ir, ok := args["includeSampleRows"].(bool); ok {
			includeRows = ir
		}
		limit := 5
		if rl, ok := args["sampleRowLimit"].(float64); ok && rl >= 1 {
			limit = int(rl)
			if limit > 50 {
				limit = 50
			}
		}

		filterSet := map[string]bool{}
		if rawList, ok := args["tableNames"].([]any); ok {
			for _, item := range rawList {
				if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
					filterSet[strings.ToLower(strings.TrimSpace(s))] = true
				}
			}
		}

		var selected []mcpTable
		selectedIDs := map[string]bool{}
		for _, t := range snap.Tables {
			if len(filterSet) == 0 || filterSet[strings.ToLower(t.TableName)] || filterSet[strings.ToLower(t.ID)] {
				selected = append(selected, t)
				selectedIDs[t.ID] = true
			}
		}
		if len(filterSet) > 0 && len(selected) == 0 {
			if rc.en {
				return nil, fmt.Errorf("Requested database tables not found")
			}
			return nil, fmt.Errorf("未找到请求的数据表")
		}

		// Compute transitive upstream parent closure so DDL and foreignKeys share an exact, executable dependency scope.
		closureIDs := map[string]bool{}
		for id := range selectedIDs {
			closureIDs[id] = true
		}
		if len(selected) < len(snap.Tables) {
			added := true
			for added {
				added = false
				for _, fk := range allFKs {
					if closureIDs[fk.FromTableID] && !closureIDs[fk.ReferencesID] {
						closureIDs[fk.ReferencesID] = true
						added = true
					}
				}
			}
		}

		ddlTables := make([]mcpTable, 0, len(closureIDs))
		depTableNames := make([]string, 0)
		for _, t := range snap.Tables {
			if closureIDs[t.ID] {
				ddlTables = append(ddlTables, t)
				if !selectedIDs[t.ID] {
					depTableNames = append(depTableNames, t.TableName)
				}
			}
		}

		scopedFKs := make([]mcpForeignKey, 0)
		for _, fk := range allFKs {
			if closureIDs[fk.FromTableID] && closureIDs[fk.ReferencesID] {
				scopedFKs = append(scopedFKs, fk)
			}
		}

		tablesOut := make([]gin.H, 0, len(selected))
		for _, t := range selected {
			colByID := map[string]string{}
			for _, c := range t.Columns {
				colByID[c.ID] = c.Name
			}
			resolvedUniques := make([]gin.H, 0, len(t.UniqueConstraints))
			for _, uc := range t.UniqueConstraints {
				cols := make([]string, 0, len(uc.ColumnIDs))
				for _, cid := range uc.ColumnIDs {
					if cname := colByID[cid]; cname != "" {
						cols = append(cols, cname)
					}
				}
				if uc.Name != "" && len(cols) > 0 {
					resolvedUniques = append(resolvedUniques, gin.H{"name": uc.Name, "columns": cols})
				}
			}
			rows := snap.TableRows[t.ID]
			entry := gin.H{
				"id":                t.ID,
				"tableName":         t.TableName,
				"cnName":            t.CNName,
				"domain":            t.Domain,
				"description":       t.Description,
				"uniqueConstraints": resolvedUniques,
				"sharedByMenus":     t.SharedByMenus,
				"columns":           t.Columns,
				"totalSampleRows":   len(rows),
			}
			if t.Modeling != nil {
				entry["modeling"] = t.Modeling
			}
			if includeRows {
				end := len(rows)
				if end > limit {
					end = limit
				}
				if rows == nil {
					entry["sampleRows"] = []any{}
				} else {
					entry["sampleRows"] = rows[:end]
				}
			}
			tablesOut = append(tablesOut, entry)
		}

		scopedIssues := make([]mcpFkIssue, 0)
		for _, issue := range rc.fkIssues {
			if closureIDs[issue.TableID] {
				scopedIssues = append(scopedIssues, issue)
			}
		}

		rawDdl := generateMcpDdl(ddlTables, scopedFKs, scopedIssues, dialect, rc.en)
		warnMsg := legacyUniqueWarning(snap.FormatVersion, rc.en)
		ddl := rawDdl
		if warnMsg != "" {
			warnTag := "-- [警告] "
			if rc.en {
				warnTag = "-- [WARNING] "
			}
			ddl = warnTag + warnMsg + "\n\n" + rawDdl
		}

		warnings := make([]string, 0)
		if warnMsg != "" {
			warnings = append(warnings, warnMsg)
		}
		for _, issue := range scopedIssues {
			warnings = append(warnings, issue.Message)
		}

		out := gin.H{
			"dialect":                   dialect,
			"tableCount":                len(tablesOut),
			"uniqueConstraintsComplete": snap.FormatVersion >= 5,
			"tables":                    tablesOut,
			"foreignKeys":               scopedFKs,
			"ddl":                       ddl,
		}
		if len(depTableNames) > 0 {
			out["dependencyTables"] = depTableNames
		}
		if len(warnings) > 0 {
			out["warnings"] = warnings
		}
		return out, nil

	case "protoflow_get_page_spec":
		pageID, _ := args["pageId"].(string)
		pageID = strings.TrimSpace(pageID)
		if pageID == "" {
			if rc.en {
				return nil, errors.New("Missing required parameter pageId")
			}
			return nil, errors.New("缺少必填参数 pageId")
		}
		includeSource := true
		if is, ok := args["includeSource"].(bool); ok {
			includeSource = is
		}

		var catEntry *pageCatalogEntry
		for i := range catalog {
			if catalog[i].PageID == pageID {
				catEntry = &catalog[i]
				break
			}
		}
		pg, hasPage := pageByID[pageID]
		if catEntry == nil && !hasPage {
			if rc.en {
				return nil, fmt.Errorf("Page %q not found", pageID)
			}
			return nil, fmt.Errorf("找不到页面 %q", pageID)
		}

		bindings := make([]gin.H, 0)
		for _, u := range allUsages {
			if u["pageId"] == pageID {
				bindings = append(bindings, u)
			}
		}
		pageActions := make([]mcpActionItem, 0)
		outNav := make([]gin.H, 0)
		inNav := make([]gin.H, 0)
		for _, a := range allActions {
			if a.PageID == pageID {
				pageActions = append(pageActions, a)
				if a.ActionName == "navigate" && len(a.Args) > 0 {
					if to, ok := a.Args[0].(string); ok {
						outNav = append(outNav, gin.H{"fromPfId": a.PfID, "event": a.Event, "toPageId": to})
					}
				}
			} else if a.ActionName == "navigate" && len(a.Args) > 0 {
				if to, ok := a.Args[0].(string); ok && to == pageID {
					inNav = append(inNav, gin.H{"fromPageId": a.PageID, "fromPfId": a.PfID, "event": a.Event})
				}
			}
		}

		stickies := make([]gin.H, 0)
		for _, s := range snap.StickyNotes {
			if s.PageID == pageID {
				stickies = append(stickies, gin.H{
					"id":               s.ID,
					"index":            s.Index,
					"active":           s.Active,
					"targetWidgetId":   s.TargetWidgetID,
					"targetWidgetName": s.TargetWidgetName,
					"requirementText":  s.Text,
				})
			}
		}

		linkedNotes := make([]gin.H, 0)
		for _, n := range snap.Notes {
			for _, pid := range n.PageIDs {
				if pid == pageID {
					linkedNotes = append(linkedNotes, gin.H{"id": n.NoteID, "title": n.Title, "status": n.Status, "priority": n.Priority})
					break
				}
			}
		}

		platform := "desktop"
		if hasPage && pg.Doc.Root.Type == "MobilePage" {
			platform = "mobile"
		}
		title := pageID
		pathStr := pageID
		dep := false
		if catEntry != nil {
			title = catEntry.Title
			pathStr = catEntry.Path
			dep = catEntry.Deprecated
		} else if hasPage {
			title = pg.Title
		}

		pageMeta := gin.H{
			"pageId":     pageID,
			"title":      title,
			"path":       pathStr,
			"platform":   platform,
			"hasSource":  hasPage,
			"deprecated": dep,
		}
		if srcID := rc.axureSourceByCopy[pageID]; srcID != "" {
			pageMeta["axureSourcePageId"] = srcID
		}
		if srcID := rc.figmaSourceByCopy[pageID]; srcID != "" {
			pageMeta["figmaSourcePageId"] = srcID
		}
		if optID := rc.axureCopyBySource[pageID]; optID != "" {
			pageMeta["optimizedPageId"] = optID
		} else if optID := rc.figmaCopyBySource[pageID]; optID != "" {
			pageMeta["optimizedPageId"] = optID
		}
		boundTableIDs := map[string]bool{}
		for _, u := range bindings {
			if tid, ok := u["tableId"].(string); ok && tid != "" {
				boundTableIDs[tid] = true
			}
		}
		var rootPtr *mcpNode
		if hasPage {
			rootCopy := pg.Doc.Root
			rootPtr = &rootCopy
		}
		uiStackSpec, pokaYokeRules := extractRemotePageExperienceSpecs(rootPtr, rc.tableByID, boundTableIDs, pageActions, allFKs)

		res := gin.H{
			"page":               pageMeta,
			"tableBindings":      bindings,
			"actions":            pageActions,
			"uiStackSpec":        uiStackSpec,
			"pokaYokeRules":      pokaYokeRules,
			"outgoingNavigation": outNav,
			"incomingNavigation": inNav,
			"stickyNotes":        stickies,
			"linkedNotes":        linkedNotes,
		}
		if hasPage {
			res["componentOutline"] = buildRemoteOutline(pg.Doc.Root, 0)
			if includeSource {
				res["pageSourceTsx"] = printRemotePageTsx(pg)
			}
		}
		return res, nil

	case "protoflow_get_docs_and_flows":
		noteFilter, _ := args["noteId"].(string)
		pageFilter, _ := args["pageId"].(string)
		notesOut := make([]gin.H, 0)
		for _, n := range snap.Notes {
			if noteFilter != "" && n.NoteID != noteFilter {
				continue
			}
			if pageFilter != "" {
				matched := false
				for _, pid := range n.PageIDs {
					if pid == pageFilter {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
			}
			notesOut = append(notesOut, gin.H{
				"id":          n.NoteID,
				"title":       n.Title,
				"icon":        n.Icon,
				"status":      n.Status,
				"priority":    n.Priority,
				"meetingDate": n.MeetingDate,
				"updatedAt":   n.UpdatedAt,
				"pageIds":     n.PageIDs,
				"markdown":    stripHtmlToMarkdown(n.Title, n.Icon, n.UpdatedAt, n.HTML, rc.en),
			})
		}
		return gin.H{
			"noteCount":    len(notesOut),
			"mindmapCount": 0,
			"notes":        notesOut,
			"mindmaps":     []any{},
		}, nil

	case "protoflow_search_spec":
		q, _ := args["query"].(string)
		q = strings.TrimSpace(q)
		if q == "" {
			if rc.en {
				return nil, errors.New("Missing required search query")
			}
			return nil, errors.New("缺少搜索关键词 query")
		}
		limit := 25
		if l, ok := args["limit"].(float64); ok && l >= 1 {
			limit = int(l)
			if limit > 100 {
				limit = 100
			}
		}
		ql := strings.ToLower(q)
		hits := make([]gin.H, 0)
		push := func(h gin.H) {
			if len(hits) < limit {
				hits = append(hits, h)
			}
		}
		for _, t := range snap.Tables {
			if strings.Contains(strings.ToLower(t.TableName+" "+t.CNName+" "+t.Description), ql) {
				push(gin.H{"category": "table", "id": t.TableName, "title": t.TableName + " (" + t.CNName + ")", "location": "database/" + t.TableName, "snippet": t.Description})
			}
			for _, c := range t.Columns {
				if strings.Contains(strings.ToLower(c.Name+" "+c.Comment+" "+c.References), ql) {
					push(gin.H{"category": "column", "id": t.TableName + "." + c.Name, "title": t.TableName + "." + c.Name, "location": "database/" + t.TableName + "#" + c.Name, "snippet": c.Comment})
				}
			}
		}
		for _, s := range snap.StickyNotes {
			if strings.Contains(strings.ToLower(s.TargetWidgetName+" "+s.Text), ql) {
				stickyTitle := fmt.Sprintf("便签 #%d · %s", s.Index, s.TargetWidgetName)
				if rc.en {
					stickyTitle = fmt.Sprintf("Sticky #%d · %s", s.Index, s.TargetWidgetName)
				}
				push(gin.H{"category": "sticky_note", "id": s.ID, "title": stickyTitle, "location": "page:" + s.PageID + "#" + s.TargetWidgetID, "snippet": s.Text})
			}
		}
		for _, p := range snap.Pages {
			tsx := printRemotePageTsx(p)
			if strings.Contains(strings.ToLower(p.PageID+" "+p.Title+" "+tsx), ql) {
				push(gin.H{"category": "page", "id": p.PageID, "title": p.Title, "location": p.PageID, "snippet": p.Title})
			}
		}
		for _, n := range snap.Notes {
			md := stripHtmlToMarkdown(n.Title, n.Icon, n.UpdatedAt, n.HTML, rc.en)
			if strings.Contains(strings.ToLower(md), ql) {
				push(gin.H{"category": "note", "id": n.NoteID, "title": n.Title, "location": "notes/" + n.NoteID, "snippet": n.Title})
			}
		}
		return gin.H{"query": q, "matchCount": len(hits), "matches": hits}, nil

	case "protoflow_get_implementation_checklist":
		modKw, _ := args["moduleKeyword"].(string)
		modKw = strings.ToLower(strings.TrimSpace(modKw))

		pageTasks := make([]gin.H, 0)
		relevantTables := map[string]bool{}
		totalRules := 0

		for _, entry := range catalog {
			if entry.Deprecated {
				continue
			}
			if modKw != "" && !strings.Contains(strings.ToLower(entry.Path+" "+entry.PageID+" "+entry.Title), modKw) {
				continue
			}
			opsSet := map[string]bool{}
			ops := make([]string, 0)
			for _, u := range allUsages {
				if u["pageId"] == entry.PageID {
					tid, _ := u["tableId"].(string)
					tn, _ := u["tableName"].(string)
					relevantTables[tid] = true
					op := "READ/LIST " + tn
					if !opsSet[op] {
						opsSet[op] = true
						ops = append(ops, op)
					}
				}
			}
			actCnt := 0
			for _, a := range allActions {
				if a.PageID == entry.PageID {
					actCnt++
					var op string
					switch a.ActionName {
					case "submitForm":
						formTarget := a.PfID
						if len(a.Args) > 0 {
							if targetStr, ok := a.Args[0].(string); ok && targetStr != "" {
								formTarget = targetStr
							}
						}
						op = "CREATE/UPDATE via Form (" + formTarget + ")"
					case "updateRow":
						op = "PATCH/STATE_TRANSITION on " + a.PfID
					case "deleteRow":
						op = "DELETE row on " + a.PfID
					}
					if op != "" && !opsSet[op] {
						opsSet[op] = true
						ops = append(ops, op)
					}
				}
			}
			rules := make([]string, 0)
			for _, s := range snap.StickyNotes {
				if s.PageID == entry.PageID && s.Active {
					rules = append(rules, fmt.Sprintf("#%d [%s (%s)]: %s", s.Index, s.TargetWidgetName, s.TargetWidgetID, s.Text))
				}
			}
			totalRules += len(rules)
			platform := "desktop"
			if pg, ok := pageByID[entry.PageID]; ok && pg.Doc.Root.Type == "MobilePage" {
				platform = "mobile"
			}
			taskItem := gin.H{
				"pageId":                    entry.PageID,
				"title":                     entry.Title,
				"routePath":                 entry.Path,
				"platform":                  platform,
				"inferredBackendOperations": ops,
				"interactiveActionCount":    actCnt,
				"activeStickyRules":         rules,
			}
			if srcID := rc.axureSourceByCopy[entry.PageID]; srcID != "" {
				taskItem["axureSourcePageId"] = srcID
			}
			if srcID := rc.figmaSourceByCopy[entry.PageID]; srcID != "" {
				taskItem["figmaSourcePageId"] = srcID
			}
			if optID := rc.axureCopyBySource[entry.PageID]; optID != "" {
				taskItem["supersededByOptimizedPageId"] = optID
			} else if optID := rc.figmaCopyBySource[entry.PageID]; optID != "" {
				taskItem["supersededByOptimizedPageId"] = optID
			}
			pageTasks = append(pageTasks, taskItem)
		}

		dbTasks := make([]gin.H, 0)
		for _, t := range snap.Tables {
			if modKw != "" && !relevantTables[t.ID] {
				continue
			}
			pks := make([]string, 0)
			fkRefs := make([]string, 0)
			for _, c := range t.Columns {
				if c.IsPrimaryKey {
					pks = append(pks, c.Name)
				}
				if c.References != "" {
					fkRefs = append(fkRefs, c.Name+" -> "+c.References)
				}
			}
			dbTasks = append(dbTasks, gin.H{
				"tableName":   t.TableName,
				"cnName":      t.CNName,
				"columnCount": len(t.Columns),
				"primaryKeys": pks,
				"foreignKeys": fkRefs,
			})
		}

		openWarnings := make([]string, 0)
		if warn := legacyUniqueWarning(snap.FormatVersion, rc.en); warn != "" {
			openWarnings = append(openWarnings, warn)
		}
		for _, issue := range rc.fkIssues {
			if modKw == "" || relevantTables[issue.TableID] {
				openWarnings = append(openWarnings, issue.Message)
			}
		}

		scope := "all_modules"
		if modKw != "" {
			scope = modKw
		}
		return gin.H{
			"scope": scope,
			"summary": gin.H{
				"tablesToImplement": len(dbTasks),
				"pagesToImplement":  len(pageTasks),
				"activeStickyRules": totalRules,
			},
			"databaseTasks":   dbTasks,
			"pageAndApiTasks": pageTasks,
			"openWarnings":    openWarnings,
		}, nil

	default:
		if rc.en {
			return nil, fmt.Errorf("Unknown MCP tool: %s", name)
		}
		return nil, fmt.Errorf("未知的 MCP 工具：%s", name)
	}
}

func buildRemoteMcpPrompt(projectTitle, name string, args map[string]string, isEnOpt ...bool) (any, error) {
	isEn := optEn(isEnOpt...)
	switch name {
	case "implement-module":
		mod := strings.TrimSpace(args["moduleKeyword"])
		if mod == "" {
			if isEn {
				mod = "all core modules"
			} else {
				mod = "全部核心模块"
			}
		}
		stack := strings.TrimSpace(args["techStack"])
		if stack == "" {
			if isEn {
				stack = "the repository's default stack"
			} else {
				stack = "当前仓库默认技术栈"
			}
		}
		if isEn {
			text := strings.Join([]string{
				fmt.Sprintf("Implement production-ready full-stack code from the Alex (ProtoFlow AI) online prototype %q (scope: %s; stack: %s).", projectTitle, mod, stack),
				"",
				"1. Call `protoflow_get_project_overview` first to understand the route tree and module boundaries;",
				"2. Call `protoflow_get_database_schema` for physical tables, primary/foreign keys, and seed rows, then align database migrations and API contracts;",
				"3. Call `protoflow_get_page_spec` for each page to implement UI, interactive action chains, and sticky-note business rules;",
				"4. Finally call `protoflow_get_implementation_checklist` to verify every requirement.",
			}, "\n")
			return gin.H{
				"description": fmt.Sprintf("Implement module from %s prototype specification: %s", projectTitle, mod),
				"messages": []gin.H{
					{"role": "user", "content": gin.H{"type": "text", "text": text}},
				},
			}, nil
		}
		text := strings.Join([]string{
			fmt.Sprintf("请基于 Alex (ProtoFlow AI) 在线原型「%s」实现生产级全栈代码（目标范围：%s；技术栈：%s）。", projectTitle, mod, stack),
			"",
			"1. 先调用 `protoflow_get_project_overview` 了解路由结构与模块边界；",
			"2. 调用 `protoflow_get_database_schema` 获取物理表、主外键与种子数据，先完成数据库与接口契约；",
			"3. 对每个页面调用 `protoflow_get_page_spec` 还原 UI、交互动作链与产品便签规则；",
			"4. 最后调用 `protoflow_get_implementation_checklist` 逐项核销。",
		}, "\n")
		return gin.H{
			"description": fmt.Sprintf("按照 %s 原型规格实现模块：%s", projectTitle, mod),
			"messages": []gin.H{
				{"role": "user", "content": gin.H{"type": "text", "text": text}},
			},
		}, nil

	case "generate-db-layer":
		dialect := "postgres"
		if args["dialect"] == "mysql" {
			dialect = "mysql"
		}
		orm := strings.TrimSpace(args["orm"])
		if orm == "" {
			if isEn {
				orm = "the project's existing ORM / SQL migrations"
			} else {
				orm = "项目现有 ORM / SQL Migration"
			}
		}
		if isEn {
			text := fmt.Sprintf("Call `protoflow_get_database_schema` (dialect: %q, includeSampleRows: true) to read the ER physical table schema of %q and generate models, migrations, and seed data for **%s**.", dialect, projectTitle, orm)
			return gin.H{
				"description": "Generate database layer from prototype ER schema",
				"messages": []gin.H{
					{"role": "user", "content": gin.H{"type": "text", "text": text}},
				},
			}, nil
		}
		text := fmt.Sprintf("请调用 `protoflow_get_database_schema`（dialect: %q, includeSampleRows: true）读取「%s」的 ER 物理表设计，并生成适配 **%s** 的模型、Migration 与 Seed 数据。", dialect, projectTitle, orm)
		return gin.H{
			"description": "基于原型 ER 物理表生成数据库层",
			"messages": []gin.H{
				{"role": "user", "content": gin.H{"type": "text", "text": text}},
			},
		}, nil

	default:
		if isEn {
			return nil, fmt.Errorf("Unknown MCP Prompt: %s", name)
		}
		return nil, fmt.Errorf("未知的 MCP Prompt：%s", name)
	}
}

func readRemoteMcpResource(rc *mcpRequestContext, uri string) (any, error) {
	snap := &rc.snap
	pub := rc.pub
	prefix := ""
	if warn := legacyUniqueWarning(snap.FormatVersion, rc.en); warn != "" {
		if rc.en {
			prefix = "-- [WARNING] " + warn + "\n\n"
		} else {
			prefix = "-- [警告] " + warn + "\n\n"
		}
	}
	switch uri {
	case "protoflow://database/schema.postgres.sql":
		return gin.H{
			"contents": []gin.H{
				{"uri": uri, "mimeType": "application/sql", "text": prefix + generateMcpDdl(snap.Tables, rc.allFKs, rc.fkIssues, "postgres", rc.en)},
			},
		}, nil
	case "protoflow://database/schema.mysql.sql":
		return gin.H{
			"contents": []gin.H{
				{"uri": uri, "mimeType": "application/sql", "text": prefix + generateMcpDdl(snap.Tables, rc.allFKs, rc.fkIssues, "mysql", rc.en)},
			},
		}, nil
	case "protoflow://spec/markdown":
		var b strings.Builder
		if rc.en {
			fmt.Fprintf(&b, "# %s · Online Prototype Specification (v%d)\n\n", snap.Title, pub.Version)
			if warn := legacyUniqueWarning(snap.FormatVersion, true); warn != "" {
				fmt.Fprintf(&b, "> ⚠️ %s\n\n", warn)
			}
			fmt.Fprintf(&b, "## Page Catalog (%d pages)\n", len(snap.Pages))
			for _, p := range rc.catalog {
				fmt.Fprintf(&b, "- **%s** (`%s`)\n", p.Path, p.PageID)
			}
			fmt.Fprintf(&b, "\n## Physical Database Tables (%d tables)\n", len(snap.Tables))
			for _, t := range snap.Tables {
				fmt.Fprintf(&b, "- `%s` (%s): %d columns\n", t.TableName, t.CNName, len(t.Columns))
			}
		} else {
			fmt.Fprintf(&b, "# %s · 在线原型工程规格 (v%d)\n\n", snap.Title, pub.Version)
			if warn := legacyUniqueWarning(snap.FormatVersion, false); warn != "" {
				fmt.Fprintf(&b, "> ⚠️ %s\n\n", warn)
			}
			fmt.Fprintf(&b, "## 页面目录 (%d 页)\n", len(snap.Pages))
			for _, p := range rc.catalog {
				fmt.Fprintf(&b, "- **%s** (`%s`)\n", p.Path, p.PageID)
			}
			fmt.Fprintf(&b, "\n## 物理数据表 (%d 张)\n", len(snap.Tables))
			for _, t := range snap.Tables {
				fmt.Fprintf(&b, "- `%s`（%s）：%d 列\n", t.TableName, t.CNName, len(t.Columns))
			}
		}
		return gin.H{
			"contents": []gin.H{
				{"uri": uri, "mimeType": "text/markdown", "text": b.String()},
			},
		}, nil
	default:
		if rc.en {
			return nil, fmt.Errorf("Unknown MCP Resource URI: %s", uri)
		}
		return nil, fmt.Errorf("未知的 MCP Resource URI：%s", uri)
	}
}

var mcpFieldComponentTypes = map[string]bool{
	"Input": true, "NumberInput": true, "Textarea": true, "Select": true,
	"DatePicker": true, "DateRange": true, "TimePicker": true, "Radio": true,
	"Checkbox": true, "Switch": true, "Upload": true, "PickerInput": true,
	"Slider": true, "Rate": true, "Cascader": true, "TreeSelect": true,
	"AutoComplete": true, "Segmented": true,
	"MField": true, "MSheetPicker": true, "MChipSelect": true, "MMediaInput": true,
}

func exportRemoteDesignTokensSpec(tokens *PublishedDesignTokens, en bool) gin.H {
	preset := "classic_antd"
	if tokens != nil && designPresets[tokens.Preset] {
		preset = tokens.Preset
	}
	primaryColor := "#2563eb"
	radius := "rounded"
	density := "comfortable"
	surfaceVariant := "bordered"
	colorMode := "auto"
	presetZh := "经典企业蓝白"
	presetEn := "Classic Enterprise"

	switch preset {
	case "modern_minimal":
		primaryColor = "#18181b"
		radius = "rounded"
		density = "comfortable"
		surfaceVariant = "elevated"
		presetZh = "现代极简 SaaS"
		presetEn = "Modern Minimal SaaS"
	case "collab_soft":
		primaryColor = "#4f46e5"
		radius = "generous"
		density = "spacious"
		surfaceVariant = "subtle"
		presetZh = "柔和协同效率"
		presetEn = "Soft Collaborative"
	case "enterprise_compact":
		primaryColor = "#0284c7"
		radius = "sharp"
		density = "compact"
		surfaceVariant = "bordered"
		presetZh = "高密专业业财"
		presetEn = "Compact Finance & ERP"
	}

	if tokens != nil {
		if tokens.PrimaryColor != nil && hexColorRe.MatchString(*tokens.PrimaryColor) {
			primaryColor = strings.ToLower(*tokens.PrimaryColor)
		}
		if tokens.Radius != nil && designRadii[*tokens.Radius] {
			radius = *tokens.Radius
		}
		if tokens.Density != nil && designDensities[*tokens.Density] {
			density = *tokens.Density
		}
		if tokens.SurfaceVariant != nil && designSurfaces[*tokens.SurfaceVariant] {
			surfaceVariant = *tokens.SurfaceVariant
		}
		if tokens.ColorMode != nil && designColorModes[*tokens.ColorMode] {
			colorMode = *tokens.ColorMode
		}
	}

	radiusPx := 6
	if radius == "sharp" {
		radiusPx = 4
	} else if radius == "generous" {
		radiusPx = 12
	} else if preset == "modern_minimal" {
		radiusPx = 8
	}
	cardRadiusPx := 12
	if radius == "sharp" {
		cardRadiusPx = 6
	} else if radius == "generous" {
		cardRadiusPx = 16
	}
	fontSizePx := 13
	if density == "compact" {
		fontSizePx = 12
	} else if density == "spacious" {
		fontSizePx = 14
	}

	buildCssVars := func(mode string) gin.H {
		dark := mode == "dark"
		effPrimary := primaryColor
		if dark && strings.ToLower(primaryColor) == "#18181b" {
			effPrimary = "#818cf8"
		}
		bgLayout := "#f8fafc"
		if dark {
			bgLayout = "#09090b"
		} else if preset == "collab_soft" {
			bgLayout = "#f4f6fb"
		} else if preset == "modern_minimal" {
			bgLayout = "#fafafa"
		}
		bgContainer := "#ffffff"
		if dark {
			bgContainer = "#141417"
		}
		border := "#e2e8f0"
		if dark {
			border = "#27272a"
		} else if preset == "modern_minimal" {
			border = "#e4e4e7"
		}
		borderSec := "#f1f5f9"
		if dark {
			borderSec = "#1f1f23"
		}
		textCol := "#0f172a"
		textSec := "#64748b"
		if dark {
			textCol = "#f4f4f5"
			textSec = "#a1a1aa"
		}
		return gin.H{
			"--pf-color-scheme":     mode,
			"--pf-primary":          effPrimary,
			"--pf-radius-control":   fmt.Sprintf("%dpx", radiusPx),
			"--pf-radius-card":      fmt.Sprintf("%dpx", cardRadiusPx),
			"--pf-font-size":        fmt.Sprintf("%dpx", fontSizePx),
			"--pf-bg-layout":        bgLayout,
			"--pf-bg-container":     bgContainer,
			"--pf-border":           border,
			"--pf-border-secondary": borderSec,
			"--pf-text":             textCol,
			"--pf-text-secondary":   textSec,
		}
	}

	presetLabel := presetZh
	if en {
		presetLabel = presetEn
	}
	return gin.H{
		"preset":      preset,
		"presetLabel": presetLabel,
		"tokens": gin.H{
			"preset":         preset,
			"primaryColor":   primaryColor,
			"radius":         radius,
			"radiusPx":       radiusPx,
			"cardRadiusPx":   cardRadiusPx,
			"density":        density,
			"fontSizePx":     fontSizePx,
			"surfaceVariant": surfaceVariant,
			"colorMode":      colorMode,
		},
		"cssVariables": gin.H{
			"light": buildCssVars("light"),
			"dark":  buildCssVars("dark"),
		},
		"antdThemeToken": gin.H{
			"colorPrimary": primaryColor,
			"borderRadius": radiusPx,
			"fontSize":     fontSizePx,
			"compact":      density == "compact",
		},
	}
}

func extractRemotePageExperienceSpecs(
	root *mcpNode,
	tableByID map[string]mcpTable,
	boundTableIDs map[string]bool,
	pageActions []mcpActionItem,
	allFKs []mcpForeignKey,
) (gin.H, gin.H) {
	componentEmptyTexts := make([]gin.H, 0)
	fieldConstraints := make([]gin.H, 0)
	actionStateGuards := make([]gin.H, 0)

	addFieldConstraint := func(pfID, formPfID string, formTableID any, props map[string]any) {
		fieldName, _ := props["name"].(string)
		if fieldName == "" {
			return
		}
		req, _ := props["required"].(bool)
		minField, _ := props["minField"].(string)
		maxField, _ := props["maxField"].(string)
		minVal, hasMinVal := props["minValue"].(float64)
		maxVal, hasMaxVal := props["maxValue"].(float64)
		fmtRule, _ := props["formatRule"].(string)
		valMsg, _ := props["validationMessage"].(string)
		if !req && minField == "" && maxField == "" && !hasMinVal && !hasMaxVal && fmtRule == "" {
			return
		}
		var tblIDPtr any = nil
		var tblNamePtr any = nil
		if tid, ok := formTableID.(string); ok && tid != "" {
			tblIDPtr = tid
			if tbl, exists := tableByID[tid]; exists {
				tblNamePtr = tbl.TableName
			} else {
				tblNamePtr = tid
			}
		}
		label := fieldName
		if lbl, ok := props["label"].(string); ok && lbl != "" {
			label = lbl
		}
		item := gin.H{
			"pfId":      pfID,
			"formPfId":  formPfID,
			"tableId":   tblIDPtr,
			"tableName": tblNamePtr,
			"fieldName": fieldName,
			"label":     label,
			"required":  req,
		}
		if minField != "" {
			item["minField"] = minField
		}
		if maxField != "" {
			item["maxField"] = maxField
		}
		if hasMinVal {
			item["minValue"] = minVal
		}
		if hasMaxVal {
			item["maxValue"] = maxVal
		}
		if fmtRule != "" {
			item["formatRule"] = fmtRule
		}
		if valMsg != "" {
			item["validationMessage"] = valMsg
		}
		fieldConstraints = append(fieldConstraints, item)
	}

	var pageEmptyTitle any = nil
	pageErrorFallback := "component"
	var pageErrorTitle any = nil
	var pageErrorDescription any = nil

	if root != nil {
		if et, ok := root.Props["emptyTitle"].(string); ok && et != "" {
			pageEmptyTitle = et
		}
		if ef, ok := root.Props["errorFallback"].(string); ok && ef != "" {
			pageErrorFallback = ef
		}
		if ert, ok := root.Props["errorTitle"].(string); ok && ert != "" {
			pageErrorTitle = ert
		}
		if erd, ok := root.Props["errorDescription"].(string); ok && erd != "" {
			pageErrorDescription = erd
		}

		var visit func(n mcpNode, formOwner *mcpNode)
		visit = func(n mcpNode, formOwner *mcpNode) {
			if n.Kind != "node" {
				return
			}
			emptyCopy := ""
			if et, ok := n.Props["emptyText"].(string); ok && strings.TrimSpace(et) != "" {
				emptyCopy = strings.TrimSpace(et)
			} else if n.Type == "Empty" {
				if desc, ok := n.Props["description"].(string); ok && strings.TrimSpace(desc) != "" {
					emptyCopy = strings.TrimSpace(desc)
				}
			}
			if emptyCopy != "" {
				componentEmptyTexts = append(componentEmptyTexts, gin.H{
					"pfId":          n.PfID,
					"componentType": n.Type,
					"emptyText":     emptyCopy,
				})
			}

			activeForm := formOwner
			if n.Type == "Form" || n.Type == "MForm" {
				nCopy := n
				activeForm = &nCopy
			}

			if activeForm != nil && mcpFieldComponentTypes[n.Type] {
				addFieldConstraint(n.PfID, activeForm.PfID, activeForm.Props["table"], n.Props)
			}

			if n.Type == "Form" {
				if rawFields, ok := n.Props["fields"].([]any); ok {
					for _, rf := range rawFields {
						if fm, ok := rf.(map[string]any); ok {
							addFieldConstraint(n.PfID, n.PfID, n.Props["table"], fm)
						}
					}
				}
			}

			if n.Type == "Button" || n.Type == "MButton" {
				dwf, _ := n.Props["disabledWhenField"].(string)
				hwf, _ := n.Props["hiddenWhenField"].(string)
				if dwf != "" || hwf != "" {
					lbl := n.Type
					for _, ch := range n.Children {
						if ch.Kind == "text" && strings.TrimSpace(ch.Value) != "" {
							lbl = strings.TrimSpace(ch.Value)
							break
						}
					}
					if propLbl, ok := n.Props["label"].(string); lbl == n.Type && ok && propLbl != "" {
						lbl = propLbl
					}
					guard := gin.H{"pfId": n.PfID, "componentType": n.Type, "label": lbl}
					if dwf != "" {
						guard["disabledWhenField"] = dwf
					}
					if dwv, ok := n.Props["disabledWhenValue"].(string); ok && dwv != "" {
						guard["disabledWhenValue"] = dwv
					}
					if dr, ok := n.Props["disabledReason"].(string); ok && dr != "" {
						guard["disabledReason"] = dr
					}
					if hwf != "" {
						guard["hiddenWhenField"] = hwf
					}
					if hwv, ok := n.Props["hiddenWhenValue"].(string); ok && hwv != "" {
						guard["hiddenWhenValue"] = hwv
					}
					actionStateGuards = append(actionStateGuards, guard)
				}
			}

			if rawActs, ok := n.Props["rowActions"].([]any); ok {
				for _, ra := range rawActs {
					am, ok := ra.(map[string]any)
					if !ok {
						continue
					}
					dwf, _ := am["disabledWhenField"].(string)
					hwf, _ := am["hiddenWhenField"].(string)
					if dwf != "" || hwf != "" {
						lbl, _ := am["label"].(string)
						if lbl == "" {
							lbl = "rowAction"
						}
						guard := gin.H{"pfId": n.PfID, "componentType": n.Type + ".rowAction", "label": lbl}
						if dwf != "" {
							guard["disabledWhenField"] = dwf
						}
						if dwv, ok := am["disabledWhenValue"].(string); ok && dwv != "" {
							guard["disabledWhenValue"] = dwv
						}
						if dr, ok := am["disabledReason"].(string); ok && dr != "" {
							guard["disabledReason"] = dr
						}
						if hwf != "" {
							guard["hiddenWhenField"] = hwf
						}
						if hwv, ok := am["hiddenWhenValue"].(string); ok && hwv != "" {
							guard["hiddenWhenValue"] = hwv
						}
						actionStateGuards = append(actionStateGuards, guard)
					}
				}
			}

			nextForm := activeForm
			if n.Type == "QueryForm" {
				nextForm = nil
			}
			for _, c := range n.Children {
				visit(c, nextForm)
			}
		}
		visit(*root, nil)
	}

	highRiskConfirmations := make([]gin.H, 0)
	for _, a := range pageActions {
		if a.ActionName == "confirm" && len(a.Args) > 1 {
			if mt, ok := a.Args[1].(string); ok && strings.TrimSpace(mt) != "" {
				msgStr, _ := a.Args[0].(string)
				highRiskConfirmations = append(highRiskConfirmations, gin.H{
					"pfId":      a.PfID,
					"event":     a.Event,
					"kind":      "match_text_confirm",
					"message":   msgStr,
					"matchText": mt,
				})
			}
		} else if a.ActionName == "deleteRow" && len(a.Args) > 0 && a.Args[0] == "undo" {
			highRiskConfirmations = append(highRiskConfirmations, gin.H{
				"pfId":         a.PfID,
				"event":        a.Event,
				"kind":         "undoable_delete",
				"undoWindowMs": 5000,
			})
		}
	}

	foreignKeyDeletePolicies := make([]gin.H, 0)
	for _, fk := range allFKs {
		if boundTableIDs[fk.ReferencesID] || boundTableIDs[fk.FromTableID] {
			onDel := fk.OnDelete
			if onDel == "" {
				onDel = "RESTRICT"
			}
			foreignKeyDeletePolicies = append(foreignKeyDeletePolicies, gin.H{
				"parentTable": fk.ReferencesTable,
				"childTable":  fk.FromTable,
				"childColumn": fk.FromColumn,
				"onDelete":    onDel,
			})
		}
	}

	uiStackSpec := gin.H{
		"supportedStates":      []string{"normal", "empty", "loading", "edge", "error"},
		"pageEmptyTitle":       pageEmptyTitle,
		"pageErrorFallback":    pageErrorFallback,
		"pageErrorTitle":       pageErrorTitle,
		"pageErrorDescription": pageErrorDescription,
		"componentEmptyTexts":  componentEmptyTexts,
	}
	pokaYokeRules := gin.H{
		"fieldConstraints":         fieldConstraints,
		"actionStateGuards":        actionStateGuards,
		"highRiskConfirmations":    highRiskConfirmations,
		"foreignKeyDeletePolicies": foreignKeyDeletePolicies,
	}
	return uiStackSpec, pokaYokeRules
}
