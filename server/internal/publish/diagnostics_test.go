package publish

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http/httptest"
	"os"
	"protoflow/server/migrations"
	"reflect"
	"strings"
	"testing"
	"time"
)

type diagnosticMemory struct {
	*memoryStore
	installations map[string]string
	reports       map[string]StoredDiagnostic
}

func (s *diagnosticMemory) RegisterDiagnosticInstallation(_ context.Context, id, hash string) error {
	if old, ok := s.installations[id]; ok && old != hash {
		return ErrConflict
	}
	s.installations[id] = hash
	return nil
}
func (s *diagnosticMemory) SaveDiagnostic(_ context.Context, id, hash string, d RuntimeDiagnostic) error {
	if s.installations[id] != hash {
		return ErrNotFound
	}
	if old, ok := s.reports[d.ID]; ok {
		if old.InstallationID != id || !reflect.DeepEqual(old.RuntimeDiagnostic, d) {
			return ErrConflict
		}
		return nil
	}
	s.reports[d.ID] = StoredDiagnostic{d, id, time.Now()}
	return nil
}
func (s *diagnosticMemory) ListDiagnostics(_ context.Context, q DiagnosticQuery) ([]StoredDiagnostic, error) {
	out := []StoredDiagnostic{}
	for _, d := range s.reports {
		if (q.ID == "" || d.ID == q.ID) && (q.Category == "" || d.Category == q.Category) && (q.Version == "" || d.AppVersion == q.Version) && (q.Account == "" || d.Account != nil && (d.Account.UserID == q.Account || d.Account.Username == q.Account)) && (q.Device == "" || d.InstallationID == q.Device || d.Device != nil && d.Device.Hostname == q.Device) && (q.RunID == "" || d.Context.RunID == q.RunID) {
			out = append(out, d)
		}
	}
	if q.Offset >= len(out) {
		return []StoredDiagnostic{}, nil
	}
	return out[q.Offset:], nil
}

const diagnosticInstallationA = "11111111-1111-4111-8111-111111111111"
const diagnosticInstallationB = "22222222-2222-4222-8222-222222222222"

func diagnosticFixture() RuntimeDiagnostic {
	return RuntimeDiagnostic{ID: "33333333-3333-4333-8333-333333333333", OccurredAt: time.Now().UTC().Truncate(time.Millisecond), AppVersion: "0.0.5", Platform: "darwin", Arch: "arm64", Source: "renderer", Category: "ai", Code: "AI_GENERATION_REJECTED", Stage: "validation", Message: "生成验收失败", Context: DiagnosticContext{ProjectID: "project-A", RunID: "run-A", TargetPageID: "oa-m-approvals", Checks: []map[string]string{{"kind": "foreignKey", "tableId": "expense-items", "status": "待绑定引用表"}}, BoundTableIDs: []string{"expenses"}}}
}

func TestDiagnosticsHTTPIsolationAndValidation(t *testing.T) {
	s := &diagnosticMemory{memoryStore: &memoryStore{}, installations: map[string]string{}, reports: map[string]StoredDiagnostic{}}
	s.ensureMaps()
	expires := time.Now().Add(time.Hour)
	s.admins["admin-A"] = PlatformAdmin{ID: "admin-A", Username: "owner", TokenExpiresAt: &expires}
	s.adminTokens[TokenHash("admin-secret")] = "admin-A"
	h := Handler(s, Options{PublicOrigin: "http://localhost", ReleaseStorageDir: t.TempDir()})
	call := func(method, route, token, installation string, body any, remote string) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, route, strings.NewReader(string(b)))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.Header.Set("X-Diagnostic-Installation", installation)
		r.RemoteAddr = remote
		r.Host = "localhost"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	local := "127.0.0.1:1234"
	secretA := strings.Repeat("a", 64)
	secretB := strings.Repeat("b", 64)
	for _, id := range []string{diagnosticInstallationA, diagnosticInstallationB} {
		w := call("POST", "/api/v1/diagnostics/installations", "", "", map[string]string{"id": id, "token": secretA}, local)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := call("POST", "/api/v1/diagnostics/installations", "", "", map[string]string{"id": diagnosticInstallationA, "token": secretB}, local); w.Code != 409 {
		t.Fatal("installation takeover", w.Code)
	}
	d := diagnosticFixture()
	d.Account = &DiagnosticAccount{Status: "signed-in", Source: "client-session", UserID: "account-A", Username: "alice", DisplayName: "Alice"}
	d.Device = &DiagnosticDevice{Hostname: "workstation-A", OSRelease: "7.0.0", OSVersion: "Linux"}
	d.Context.Checks = append(d.Context.Checks, map[string]string{"kind": "task-suspend", "status": "not-observed"})
	requested, wait := float64(440588), 3.976
	d.Context.Failure = &DiagnosticFailure{Reason: "rate-limit", Evidence: "native-session-log", LogStatus: "matched", RateLimitKind: "tokens", TokensRequested: &requested, RetryAfterSeconds: &wait}
	d.Context.Metrics = map[string]float64{"acpTurnMs": 59855.89, "toolCallCount": 1}
	d.Message = "Authorization: Bearer abcdef password=hidden https://host/path?token=secret /Users/alice/project"
	for i := 0; i < 2; i++ {
		if w := call("POST", "/api/v1/diagnostics/reports", secretA, diagnosticInstallationA, d, local); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if len(s.reports) != 1 {
		t.Fatal("retry inserted duplicate")
	}
	saved := s.reports[d.ID]
	if saved.Account.UserID != "account-A" || saved.Device.Hostname != "workstation-A" || saved.Context.Checks[1]["kind"] != "task-suspend" || *saved.Context.Failure.TokensRequested != requested {
		t.Fatal("evidence was lost", saved)
	}
	for _, secret := range []string{"abcdef", "hidden", "alice", "host/path"} {
		if strings.Contains(saved.Message, secret) {
			t.Fatal("secret persisted")
		}
	}
	if w := call("POST", "/api/v1/diagnostics/reports", secretA, diagnosticInstallationB, d, local); w.Code != 409 {
		t.Fatal("cross-installation overwrite", w.Code)
	}
	for _, token := range []string{secretA, "owner-A", "client-user"} {
		if w := call("GET", "/api/v1/admin/diagnostics", token, "", nil, local); w.Code != 403 {
			t.Fatal("non-admin read", w.Code)
		}
	}
	if w := call("GET", "/api/v1/admin/diagnostics", "admin-secret", "", nil, "203.0.113.10:1234"); w.Code != 403 {
		t.Fatal("untrusted transport", w.Code)
	}
	w := call("GET", "/api/v1/admin/diagnostics?id="+d.ID+"&version=0.0.5&category=ai", "admin-secret", "", nil, local)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "expense-items") {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, query := range []string{"account=alice", "account=account-A", "device=workstation-A", "device=" + diagnosticInstallationA, "runId=run-A"} {
		w := call("GET", "/api/v1/admin/diagnostics?"+query, "admin-secret", "", nil, local)
		if w.Code != 200 || !strings.Contains(w.Body.String(), d.ID) {
			t.Fatal("exact filter", query, w.Code, w.Body.String())
		}
	}
	for _, query := range []string{"account=other", "device=other", "runId=other"} {
		w := call("GET", "/api/v1/admin/diagnostics?"+query, "admin-secret", "", nil, local)
		if w.Code != 200 || strings.Contains(w.Body.String(), d.ID) {
			t.Fatal("incorrect attribution", query, w.Code)
		}
	}
	if w := call("GET", "/api/v1/admin/diagnostics?offset=-1", "admin-secret", "", nil, local); w.Code != 400 {
		t.Fatal(w.Code)
	}
	bad := diagnosticFixture()
	bad.Context.Checks = []map[string]string{{"prompt": "private"}}
	if w := call("POST", "/api/v1/diagnostics/reports", secretA, diagnosticInstallationA, bad, local); w.Code != 400 {
		t.Fatal("unapproved context", w.Code)
	}
	body := map[string]any{"report": d, "prompt": strings.Repeat("x", 70000)}
	if w := call("POST", "/api/v1/diagnostics/reports", secretA, diagnosticInstallationA, body, local); w.Code != 413 {
		t.Fatal("oversize", w.Code)
	}
}

func TestDiagnosticEvidenceValidationAndLegacyCompatibility(t *testing.T) {
	d := diagnosticFixture()
	if err := validateDiagnostic(&d); err != nil {
		t.Fatal("legacy report rejected", err)
	}
	if got := cleanDiagnosticText("task-suspend sk-secret Bearer secret", 1000); got != "task-suspend [redacted] [redacted]" {
		t.Fatal(got)
	}
	cases := []func(*RuntimeDiagnostic){
		func(d *RuntimeDiagnostic) {
			d.Account = &DiagnosticAccount{Status: "signed-out", UserID: "wrong-account"}
		},
		func(d *RuntimeDiagnostic) {
			d.Account = &DiagnosticAccount{Status: "signed-in", Source: "client-session", UserID: "missing-name"}
		},
		func(d *RuntimeDiagnostic) { d.Device = &DiagnosticDevice{Hostname: "password=private"} },
		func(d *RuntimeDiagnostic) {
			d.Context.Failure = &DiagnosticFailure{Reason: "tokens", RateLimitKind: "tokens"}
		},
		func(d *RuntimeDiagnostic) { d.Context.Failure = &DiagnosticFailure{ObservedAt: "not a date"} },
		func(d *RuntimeDiagnostic) {
			n := float64(-1)
			d.Context.Failure = &DiagnosticFailure{TokensRequested: &n}
		},
		func(d *RuntimeDiagnostic) { d.Context.Metrics = map[string]float64{"prompt": 1} },
	}
	for i, change := range cases {
		bad := diagnosticFixture()
		change(&bad)
		if err := validateDiagnostic(&bad); err == nil {
			t.Fatalf("invalid evidence %d accepted", i)
		}
	}
}

func TestDiagnosticPostgresIdempotencyAndRetention(t *testing.T) {
	dsn := os.Getenv("PUBLISH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PUBLISH_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("invalid test database")
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, migrations.All); err != nil {
		t.Fatal(err)
	}
	s := Postgres{Pool: pool}
	d := diagnosticFixture()
	d.Account = &DiagnosticAccount{Status: "signed-in", Source: "client-session", UserID: "account-pg", Username: "alice-pg", DisplayName: "Alice"}
	d.Device = &DiagnosticDevice{Hostname: "test-device"}
	// These IDs are confined to this opt-in test database, with explicit cleanup.
	defer pool.Exec(context.Background(), `DELETE FROM runtime_diagnostics WHERE id=$1`, d.ID)
	defer func() {
		pool.Exec(context.Background(), `DELETE FROM runtime_diagnostics WHERE installation_id=$1`, diagnosticInstallationA)
		pool.Exec(context.Background(), `DELETE FROM diagnostic_installations WHERE id=$1`, diagnosticInstallationA)
	}()
	if err = s.RegisterDiagnosticInstallation(ctx, diagnosticInstallationA, "hash-A"); err != nil {
		t.Fatal(err)
	}
	if err = s.RegisterDiagnosticInstallation(ctx, diagnosticInstallationA, "hash-B"); err != ErrConflict {
		t.Fatal("credential replacement", err)
	}
	for i := 0; i < 2; i++ {
		if err = s.SaveDiagnostic(ctx, diagnosticInstallationA, "hash-A", d); err != nil {
			t.Fatal(err)
		}
	}
	d.Message = "different"
	if err = s.SaveDiagnostic(ctx, diagnosticInstallationA, "hash-A", d); err != ErrConflict {
		t.Fatal("immutable event", err)
	}
	items, err := s.ListDiagnostics(ctx, DiagnosticQuery{ID: d.ID, Category: "ai", Version: "0.0.5"})
	if err != nil || len(items) != 1 {
		t.Fatal(items, err)
	}
	for _, q := range []DiagnosticQuery{{Account: "account-pg"}, {Account: "alice-pg"}, {Device: "test-device"}, {Device: diagnosticInstallationA}, {RunID: d.Context.RunID}} {
		q.ID = d.ID
		items, err := s.ListDiagnostics(ctx, q)
		if err != nil || len(items) != 1 {
			t.Fatal("json filter", q, items, err)
		}
	}
	for _, q := range []DiagnosticQuery{{Account: "other-account"}, {Device: "other-device"}, {RunID: "other-run"}} {
		q.ID = d.ID
		items, err := s.ListDiagnostics(ctx, q)
		if err != nil || len(items) != 0 {
			t.Fatal("incorrect json filter", q, items, err)
		}
	}
	if _, err = pool.Exec(ctx, `UPDATE runtime_diagnostics SET received_at=now()-interval '91 days' WHERE id=$1`, d.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.PruneDiagnostics(ctx); err != nil {
		t.Fatal(err)
	}
	items, err = s.ListDiagnostics(ctx, DiagnosticQuery{ID: d.ID})
	if err != nil || len(items) != 0 {
		t.Fatal("retention", err)
	}
}
