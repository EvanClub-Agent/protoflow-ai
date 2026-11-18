package publish

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Separate interface keeps diagnostics independent of publication credentials.
// Installation credentials may only register/upload, never read reports.
type DiagnosticStore interface {
	RegisterDiagnosticInstallation(context.Context, string, string) error
	SaveDiagnostic(context.Context, string, string, RuntimeDiagnostic) error
	ListDiagnostics(context.Context, DiagnosticQuery) ([]StoredDiagnostic, error)
}
type DiagnosticQuery struct {
	ID, Category, Version, Account, Device, RunID string
	Offset                                        int
}

// Attribution is an occurrence-time snapshot reported by the desktop. It is
// never an authorization claim and must not be inferred from the uploader.
type DiagnosticAccount struct {
	Status      string `json:"status"`
	Source      string `json:"source,omitempty"`
	UserID      string `json:"userId,omitempty"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
}
type DiagnosticDevice struct {
	Hostname  string `json:"hostname,omitempty"`
	OSRelease string `json:"osRelease,omitempty"`
	OSVersion string `json:"osVersion,omitempty"`
}
type DiagnosticFailure struct {
	Reason            string   `json:"reason,omitempty"`
	Evidence          string   `json:"evidence,omitempty"`
	LogStatus         string   `json:"logStatus,omitempty"`
	ObservedAt        string   `json:"observedAt,omitempty"`
	RateLimitKind     string   `json:"rateLimitKind,omitempty"`
	RetryAfterSeconds *float64 `json:"retryAfterSeconds,omitempty"`
	TokenLimit        *float64 `json:"tokenLimit,omitempty"`
	TokensUsed        *float64 `json:"tokensUsed,omitempty"`
	TokensRequested   *float64 `json:"tokensRequested,omitempty"`
	Attempts          *float64 `json:"attempts,omitempty"`
	MessageCount      *float64 `json:"messageCount,omitempty"`
	EstimatedTokens   *float64 `json:"estimatedTokens,omitempty"`
	RetriesExhausted  *bool    `json:"retriesExhausted,omitempty"`
}

type DiagnosticContext struct {
	PFID                string              `json:"pfId,omitempty"`
	ProjectID           string              `json:"projectId,omitempty"`
	ThreadID            string              `json:"threadId,omitempty"`
	PageID              string              `json:"pageId,omitempty"`
	MindmapID           string              `json:"mindmapId,omitempty"`
	TargetPageID        string              `json:"targetPageId,omitempty"`
	SessionID           string              `json:"sessionId,omitempty"`
	RunID               string              `json:"runId,omitempty"`
	ModelID             string              `json:"modelId,omitempty"`
	WorkflowPhase       string              `json:"workflowPhase,omitempty"`
	Operation           string              `json:"operation,omitempty"`
	Attempt             int                 `json:"attempt,omitempty"`
	DurationMS          float64             `json:"durationMs,omitempty"`
	ToolCallCount       int                 `json:"toolCallCount,omitempty"`
	FailedToolCallCount int                 `json:"failedToolCallCount,omitempty"`
	Checks              []map[string]string `json:"checks,omitempty"`
	BoundTableIDs       []string            `json:"boundTableIds,omitempty"`
	Failure             *DiagnosticFailure  `json:"failure,omitempty"`
	Metrics             map[string]float64  `json:"metrics,omitempty"`
}
type RuntimeDiagnostic struct {
	ID         string             `json:"id"`
	OccurredAt time.Time          `json:"occurredAt"`
	AppVersion string             `json:"appVersion"`
	Platform   string             `json:"platform"`
	Arch       string             `json:"arch"`
	Source     string             `json:"source"`
	Category   string             `json:"category"`
	Code       string             `json:"code"`
	Stage      string             `json:"stage"`
	Message    string             `json:"message"`
	Stack      string             `json:"stack,omitempty"`
	Context    DiagnosticContext  `json:"context"`
	Account    *DiagnosticAccount `json:"account,omitempty"`
	Device     *DiagnosticDevice  `json:"device,omitempty"`
}
type StoredDiagnostic struct {
	RuntimeDiagnostic
	InstallationID string    `json:"installationId"`
	ReceivedAt     time.Time `json:"receivedAt"`
}

func diagnosticBearer(c *gin.Context) (string, bool) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") || len(header) > 256 {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	return token, token != ""
}

// Service-owned retention, based on received_at rather than the client clock.
func (s Postgres) PruneDiagnostics(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM runtime_diagnostics WHERE received_at < now() - interval '90 days'`)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `DELETE FROM diagnostic_installations i WHERE created_at < now() - interval '90 days' AND NOT EXISTS (SELECT 1 FROM runtime_diagnostics d WHERE d.installation_id=i.id)`)
	return err
}

var diagnosticUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var diagnosticToken = regexp.MustCompile(`^[0-9a-f]{64}$`)
var diagnosticCode = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,79}$`)
var diagnosticLabel = regexp.MustCompile(`^[a-zA-Z0-9_.:/ -]{1,120}$`)
var diagnosticBearerSecret = regexp.MustCompile(`(?i)\bbearer\s+\S+|\bsk-[a-zA-Z0-9_-]+`)
var diagnosticSecrets = regexp.MustCompile(`(?i)(?:api[_-]?key|[a-z_]*token|password|secret|authorization|cookie)["' ]*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)`)
var diagnosticURL = regexp.MustCompile(`(?i)(?:https?|file)://[^\s)]+`)
var diagnosticHome = regexp.MustCompile(`(?i)(?:/Users/|/home/|[a-z]:\\Users\\)[^\s/\\]+`)

func cleanDiagnosticText(s string, max int) string {
	s = diagnosticBearerSecret.ReplaceAllString(s, "[redacted]")
	s = diagnosticSecrets.ReplaceAllString(s, "[redacted]")
	s = diagnosticURL.ReplaceAllString(s, "[url]")
	s = diagnosticHome.ReplaceAllString(s, "[home]")
	r := []rune(s)
	if len(r) > max {
		s = string(r[:max])
	}
	return s
}
func validateDiagnostic(d *RuntimeDiagnostic) error {
	if !diagnosticUUID.MatchString(d.ID) || d.OccurredAt.IsZero() || d.OccurredAt.Before(time.Now().AddDate(0, 0, -31)) || d.OccurredAt.After(time.Now().Add(24*time.Hour)) {
		return errors.New("诊断编号或时间无效")
	}
	if !slices.Contains([]string{"ai", "tool", "renderer", "storage", "network", "main"}, d.Category) || (d.Source != "main" && d.Source != "renderer") {
		return errors.New("诊断来源无效")
	}
	for _, s := range []string{d.AppVersion, d.Platform, d.Arch, d.Stage} {
		if !diagnosticLabel.MatchString(s) {
			return errors.New("诊断版本或阶段无效")
		}
	}
	if !diagnosticCode.MatchString(d.Code) || len(d.Message) > 12000 || len(d.Stack) > 24000 {
		return errors.New("诊断错误信息无效")
	}
	d.Message = cleanDiagnosticText(d.Message, 1000)
	d.Stack = cleanDiagnosticText(d.Stack, 4000)
	if err := validateDiagnosticEvidence(d); err != nil {
		return err
	}
	c := &d.Context
	for _, s := range []string{c.ProjectID, c.ThreadID, c.PageID, c.MindmapID, c.TargetPageID, c.PFID, c.SessionID, c.RunID, c.ModelID, c.WorkflowPhase, c.Operation} {
		if len(s) > 256 || strings.ContainsAny(s, "\r\n\x00") || cleanDiagnosticText(s, 256) != s {
			return errors.New("诊断上下文标识无效")
		}
	}
	if c.Attempt < 0 || c.Attempt > 100 || c.DurationMS < 0 || c.DurationMS > 7*24*3600000 || c.ToolCallCount < 0 || c.FailedToolCallCount < 0 || len(c.Checks) > 100 || len(c.BoundTableIDs) > 100 {
		return errors.New("诊断上下文超出限制")
	}
	for _, s := range c.BoundTableIDs {
		if len(s) > 256 || cleanDiagnosticText(s, 256) != s {
			return errors.New("诊断表标识无效")
		}
	}
	allowed := []string{"kind", "status", "pageId", "sourcePageId", "sourceTableId", "sourceColumnId", "tableId", "foreignKeyColumnId", "actionPfId", "actionEvent", "actionKind", "targetId", "index"}
	for _, check := range c.Checks {
		for k, v := range check {
			if !slices.Contains(allowed, k) || len(v) > 512 || cleanDiagnosticText(v, 512) != v {
				return errors.New("诊断检查项无效")
			}
		}
	}
	return nil
}

func diagnosticIdentityText(s string) bool {
	return s != "" && len(s) <= 256 && !strings.ContainsAny(s, "\r\n\x00") && cleanDiagnosticText(s, 256) == s
}
func diagnosticNumber(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1e12
}
func validateDiagnosticEvidence(d *RuntimeDiagnostic) error {
	if a := d.Account; a != nil {
		if a.Status == "signed-in" {
			if a.Source != "client-session" || !diagnosticIdentityText(a.UserID) || !diagnosticIdentityText(a.Username) || !diagnosticIdentityText(a.DisplayName) {
				return errors.New("诊断账号信息无效")
			}
		} else if !slices.Contains([]string{"signed-out", "unknown"}, a.Status) || a.Source != "" || a.UserID != "" || a.Username != "" || a.DisplayName != "" {
			return errors.New("诊断账号状态无效")
		}
	}
	if v := d.Device; v != nil {
		for _, s := range []string{v.Hostname, v.OSRelease, v.OSVersion} {
			if s != "" && !diagnosticIdentityText(s) {
				return errors.New("诊断设备信息无效")
			}
		}
	}
	if f := d.Context.Failure; f != nil {
		for _, field := range []struct {
			value   string
			allowed []string
		}{
			{f.Reason, []string{"", "rate-limit", "quota", "timeout", "network", "authentication", "context-limit", "stale-state", "context", "validation", "storage", "unclassified"}},
			{f.Evidence, []string{"", "native-session-log", "runtime-error"}},
			{f.LogStatus, []string{"", "matched", "no-match", "unavailable"}},
			{f.RateLimitKind, []string{"", "tokens", "requests"}},
		} {
			if !slices.Contains(field.allowed, field.value) {
				return errors.New("诊断失败类型无效")
			}
		}
		if f.ObservedAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, f.ObservedAt); err != nil {
				return errors.New("诊断证据时间无效")
			}
		}
		for _, n := range []*float64{f.RetryAfterSeconds, f.TokenLimit, f.TokensUsed, f.TokensRequested, f.Attempts, f.MessageCount, f.EstimatedTokens} {
			if n != nil && !diagnosticNumber(*n) {
				return errors.New("诊断失败指标无效")
			}
		}
	}
	metricKeys := []string{"providerRetryCount", "providerWaitMs", "totalExecuteMs", "sessionSetupMs", "contextBridgeSetupMs", "firstOutputMs", "firstTextMs", "acpTurnMs", "unattributedAcpMs", "userWaitMs", "promptVerifyMs", "toolExecMs", "toolCallCount", "failedToolCallCount", "nativeToolExecMs", "nativeToolCallCount", "failedNativeToolCallCount", "contextQueryMs", "contextQueryCount", "contextColdStarts", "promptBytes", "imageBytes", "snapshotBytes", "contextJsonBytes", "skillBytes"}
	for k, v := range d.Context.Metrics {
		if !slices.Contains(metricKeys, k) || !diagnosticNumber(v) {
			return errors.New("诊断性能指标无效")
		}
	}
	return nil
}

func (s Postgres) RegisterDiagnosticInstallation(ctx context.Context, id, hash string) error {
	// Retrying registration is safe; an existing installation can never be taken over.
	tag, err := s.Pool.Exec(ctx, `INSERT INTO diagnostic_installations(id,token_hash) VALUES($1,$2)
        ON CONFLICT(id) DO UPDATE SET token_hash=diagnostic_installations.token_hash WHERE diagnostic_installations.token_hash=EXCLUDED.token_hash`, id, hash)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return err
}
func (s Postgres) SaveDiagnostic(ctx context.Context, installation, hash string, d RuntimeDiagnostic) error {
	var ok bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM diagnostic_installations WHERE id=$1 AND token_hash=$2)`, installation, hash).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	body, err := json.Marshal(d)
	if err != nil {
		return err
	}
	tag, err := s.Pool.Exec(ctx, `INSERT INTO runtime_diagnostics(id,installation_id,occurred_at,category,app_version,report) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET report=runtime_diagnostics.report
        WHERE runtime_diagnostics.installation_id=EXCLUDED.installation_id AND runtime_diagnostics.report=EXCLUDED.report`, d.ID, installation, d.OccurredAt, d.Category, d.AppVersion, body)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return err
}
func (s Postgres) ListDiagnostics(ctx context.Context, q DiagnosticQuery) ([]StoredDiagnostic, error) {
	rows, err := s.Pool.Query(ctx, `SELECT installation_id,received_at,report FROM runtime_diagnostics
        WHERE ($1='' OR id=NULLIF($1,'')::uuid) AND ($2='' OR category=$2) AND ($3='' OR app_version=$3)
        AND ($5='' OR report->'account'->>'userId'=$5 OR report->'account'->>'username'=$5)
        AND ($6='' OR installation_id::text=$6 OR report->'device'->>'hostname'=$6)
        AND ($7='' OR report->'context'->>'runId'=$7)
        ORDER BY received_at DESC,id LIMIT 50 OFFSET $4`, q.ID, q.Category, q.Version, q.Offset, q.Account, q.Device, q.RunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StoredDiagnostic{}
	for rows.Next() {
		var d StoredDiagnostic
		var body []byte
		if err = rows.Scan(&d.InstallationID, &d.ReceivedAt, &body); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(body, &d.RuntimeDiagnostic); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func registerDiagnosticRoutes(api *gin.RouterGroup, limited func(*gin.Context), store Store, options Options) {
	ds, ok := store.(DiagnosticStore)
	if !ok {
		return
	}
	ingest := api.Group("/diagnostics", limited, func(c *gin.Context) { c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10); c.Next() })
	ingest.POST("/installations", func(c *gin.Context) {
		var input struct {
			ID    string `json:"id"`
			Token string `json:"token"`
		}
		if !decode(c, &input) {
			return
		}
		if !diagnosticUUID.MatchString(input.ID) || !diagnosticToken.MatchString(input.Token) {
			fail(c, 400, "安装诊断凭证无效")
			return
		}
		if err := ds.RegisterDiagnosticInstallation(c.Request.Context(), input.ID, TokenHash(input.Token)); err != nil {
			if errors.Is(err, ErrConflict) {
				fail(c, 409, "安装诊断凭证冲突")
			} else {
				fail(c, 500, "登记诊断安装失败")
			}
			return
		}
		c.JSON(200, gin.H{"registered": true})
	})
	ingest.POST("/reports", func(c *gin.Context) {
		token, ok := diagnosticBearer(c)
		installation := c.GetHeader("X-Diagnostic-Installation")
		if !ok || !diagnosticToken.MatchString(token) || !diagnosticUUID.MatchString(installation) {
			fail(c, 401, "缺少安装诊断凭证")
			return
		}
		var d RuntimeDiagnostic
		if !decode(c, &d) {
			return
		}
		if err := validateDiagnostic(&d); err != nil {
			fail(c, 400, err.Error())
			return
		}
		if err := ds.SaveDiagnostic(c.Request.Context(), installation, TokenHash(token), d); err != nil {
			switch {
			case errors.Is(err, ErrNotFound):
				fail(c, 401, "安装诊断凭证无效")
			case errors.Is(err, ErrConflict):
				fail(c, 409, "诊断编号已被其他记录使用")
			default:
				fail(c, 500, "保存诊断失败")
			}
			return
		}
		c.JSON(200, gin.H{"id": d.ID, "stored": true})
	})
	api.GET("/admin/diagnostics", limited, func(c *gin.Context) {
		if !isAllowedAdminRequest(c, options) {
			fail(c, 403, "请使用获准的管理网络访问诊断记录")
			return
		}
		token, ok := diagnosticBearer(c)
		if !ok {
			fail(c, 401, "请先登录平台管理员账号")
			return
		}
		admin, err := store.PlatformAdminByToken(c.Request.Context(), TokenHash(token))
		if err != nil || admin.ID == "" {
			fail(c, 403, "仅平台管理员可查询诊断记录")
			return
		}
		offset := 0
		if v := c.Query("offset"); v != "" {
			offset, err = strconv.Atoi(v)
		}
		if err != nil || offset < 0 || offset > 100000 || (c.Query("id") != "" && !diagnosticUUID.MatchString(c.Query("id"))) || len(c.Query("category")) > 40 || len(c.Query("version")) > 120 || (c.Query("account") != "" && !diagnosticIdentityText(c.Query("account"))) || (c.Query("device") != "" && !diagnosticIdentityText(c.Query("device"))) || (c.Query("runId") != "" && !diagnosticIdentityText(c.Query("runId"))) {
			fail(c, 400, "诊断查询条件无效")
			return
		}
		items, err := ds.ListDiagnostics(c.Request.Context(), DiagnosticQuery{ID: c.Query("id"), Category: c.Query("category"), Version: c.Query("version"), Account: c.Query("account"), Device: c.Query("device"), RunID: c.Query("runId"), Offset: offset})
		if err != nil {
			fail(c, 500, "读取诊断失败")
			return
		}
		c.JSON(200, gin.H{"items": items})
	})
}
