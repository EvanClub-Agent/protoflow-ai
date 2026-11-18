package publish

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"os"
	"protoflow/server/migrations"
	"strings"
	"sync"
	"testing"
	"time"
)

func accountRequest(t *testing.T, h http.Handler, method, path, token string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("%s %s: status %d, want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	return w
}
func registerAccount(t *testing.T, h http.Handler, name string) (ClientUser, string) {
	t.Helper()
	w := accountRequest(t, h, "POST", "/api/v1/auth/register", "", map[string]string{"username": name, "password": "test-password-123"}, 200)
	var result struct {
		User  ClientUser `json:"user"`
		Token string     `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.User, result.Token
}
func TestAccountPublishingOwnership(t *testing.T) {
	s := &memoryStore{items: map[string]Publication{}}
	h := Handler(s, Options{PublicOrigin: "http://localhost:8088"})
	a, ta := registerAccount(t, h, "account_a")
	b, tb := registerAccount(t, h, "account_b")
	if a.PublisherID != "" || b.PublisherID != "" {
		t.Fatal("read/register must leave explicit legacy choice available")
	}
	exercise(t, s, ta, tb, fixture)
	if s.users[a.ID].PublisherID == "" || s.users[a.ID].PublisherID == a.ID || s.users[a.ID].PublisherID == s.users[b.ID].PublisherID {
		t.Fatal("publisher identity not independent")
	}
	accountRequest(t, h, "POST", "/api/v1/auth/publisher", ta, map[string]string{"legacyToken": "owner-A"}, 409)
	past := time.Now().Add(-time.Minute)
	u := s.users[a.ID]
	u.TokenExpiresAt = &past
	s.users[a.ID] = u
	accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", ta, nil, 401)
	accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", "pfa_admin-is-not-a-publisher", nil, 401)
	accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", "", nil, 401)
}
func TestExplicitLegacyPublishingLink(t *testing.T) {
	s := &memoryStore{items: map[string]Publication{}}
	exercise(t, s, "owner-A", "owner-B", fixture)
	before, _ := json.Marshal(s.items)
	h := Handler(s, Options{PublicOrigin: "http://localhost:8088"})
	a, ta := registerAccount(t, h, "legacy_account")
	_, tb := registerAccount(t, h, "other_account")
	accountRequest(t, h, "POST", "/api/v1/auth/publisher", ta, map[string]string{"legacyToken": "invalid"}, 400)
	accountRequest(t, h, "POST", "/api/v1/auth/publisher", ta, map[string]string{"legacyToken": "owner-A"}, 200)
	accountRequest(t, h, "POST", "/api/v1/auth/publisher", ta, map[string]string{"legacyToken": "owner-A"}, 200)
	accountRequest(t, h, "POST", "/api/v1/auth/publisher", tb, map[string]string{"legacyToken": "owner-A"}, 409)
	accountRequest(t, h, "POST", "/api/v1/auth/publisher", ta, map[string]string{"legacyToken": "owner-B"}, 409)
	if s.users[a.ID].PublisherID != "owner-A" {
		t.Fatal("wrong legacy owner")
	}
	after, _ := json.Marshal(s.items)
	if !bytes.Equal(before, after) {
		t.Fatal("linking changed publications")
	}
	old := accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", "owner-A", nil, 200)
	linked := accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", ta, nil, 200)
	if !bytes.Equal(old.Body.Bytes(), linked.Body.Bytes()) {
		t.Fatal("existing links inaccessible after linking")
	}
	accountRequest(t, h, "POST", "/api/v1/auth/logout", ta, nil, 200)
	accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", ta, nil, 401)
	accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", "owner-A", nil, 200)
}

type unavailableAccountStore struct{ *memoryStore }

func (s unavailableAccountStore) EnsureClientPublisher(context.Context, string) (string, string, error) {
	return "", "", errors.New("database unavailable")
}
func TestAccountPublisherFailureIsNotCredentialFailure(t *testing.T) {
	s := unavailableAccountStore{&memoryStore{items: map[string]Publication{}}}
	h := Handler(s, Options{PublicOrigin: "http://localhost:8088"})
	_, token := registerAccount(t, h, "service_failure")
	accountRequest(t, h, "GET", "/api/v1/publications?projectId=project-A", token, nil, 503)
}

func TestAccountPostgresOwnershipAndConcurrency(t *testing.T) {
	dsn := os.Getenv("PUBLISH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PUBLISH_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
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
	ids := []string{}
	publishers := []string{}
	defer func() {
		pool.Exec(context.Background(), `DELETE FROM publications WHERE publisher_id=ANY($1)`, publishers)
		pool.Exec(context.Background(), `DELETE FROM client_users WHERE id=ANY($1)`, ids)
		pool.Exec(context.Background(), `DELETE FROM publishers WHERE id=ANY($1)`, publishers)
	}()
	passwordHash, _ := HashPassword("multi-session-test-password")
	create := func() ClientUser {
		id := NewID()
		exp := time.Now().Add(time.Hour)
		u, e := s.CreateClientUser(ctx, ClientUser{ID: id, Username: "test_" + strings.ToLower(id), DisplayName: "Test", PasswordHash: passwordHash, TokenHash: TokenHash(id), TokenExpiresAt: &exp})
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
		return u
	}
	a := create()
	var wg sync.WaitGroup
	results := make(chan string, 12)
	errs := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); id, _, e := s.EnsureClientPublisher(ctx, a.ID); results <- id; errs <- e }()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	owner := ""
	for id := range results {
		if owner == "" {
			owner = id
		}
		if id != owner || id == a.ID {
			t.Fatal("unstable publisher mapping")
		}
	}
	publishers = append(publishers, owner)
	legacyID, raw := NewID(), NewID()
	publishers = append(publishers, legacyID)
	if _, err = pool.Exec(ctx, `INSERT INTO publishers(id,name,token_hash) VALUES($1,'legacy',$2)`, legacyID, TokenHash(raw)); err != nil {
		t.Fatal(err)
	}
	b, c := create(), create()
	type linked struct {
		id  string
		err error
	}
	claims := make(chan linked, 2)
	for _, u := range []ClientUser{b, c} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			p, _, e := s.LinkClientPublisher(ctx, id, TokenHash(raw))
			claims <- linked{p, e}
		}(u.ID)
	}
	wg.Wait()
	close(claims)
	successes, conflicts := 0, 0
	for result := range claims {
		if result.err == nil && result.id == legacyID {
			successes++
		} else if errors.Is(result.err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(result.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("legacy identity claimed twice")
	}
	if _, _, err = s.LinkClientPublisher(ctx, a.ID, TokenHash(raw)); !errors.Is(err, ErrConflict) {
		t.Fatal("existing account was rebound")
	}
	// Website sign-in and the desktop must remain independently usable.
	if _, err = s.AuthenticateClientUser(ctx, a.Username, "multi-session-test-password", TokenHash("new-session"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ClientUserByToken(ctx, TokenHash(a.ID)); err != nil {
		t.Fatal("second login invalidated desktop", err)
	}
	if err = s.LogoutClientUser(ctx, a.ID, TokenHash(a.ID)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ClientUserByToken(ctx, TokenHash(a.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatal("logged-out session remains usable")
	}
	if _, err = s.ClientUserByToken(ctx, TokenHash("new-session")); err != nil {
		t.Fatal("old logout invalidated new session", err)
	}
}

func TestAccountSessionMigrationPreservesLegacyLogin(t *testing.T) {
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
	schema := "account_migration_" + strings.ToLower(NewID())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = pool.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	isolated, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer isolated.Close()
	prior := strings.TrimSuffix(migrations.All, "\n"+migrations.ClientSessions)
	if _, err = isolated.Exec(ctx, prior); err != nil {
		t.Fatal(err)
	}
	id := NewID()
	exp := time.Now().Add(time.Hour).Truncate(time.Microsecond)
	if _, err = isolated.Exec(ctx, `INSERT INTO client_users(id,username,display_name,password_hash,token_hash,token_expires_at) VALUES($1,'legacy','Legacy','hash',$2,$3)`, id, TokenHash("legacy-client-session"), exp); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err = isolated.Exec(ctx, migrations.All); err != nil {
			t.Fatal(err)
		}
	}
	s := Postgres{Pool: isolated}
	user, err := s.ClientUserByToken(ctx, TokenHash("legacy-client-session"))
	if err != nil || user.ID != id || !user.TokenExpiresAt.Equal(exp) {
		t.Fatal("legacy account or expiry changed", err)
	}
	if err = s.LogoutClientUser(ctx, id, TokenHash("legacy-client-session")); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ClientUserByToken(ctx, TokenHash("legacy-client-session")); !errors.Is(err, ErrNotFound) {
		t.Fatal("revoked session restored through legacy columns")
	}
}
