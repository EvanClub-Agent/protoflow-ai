package publish

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"protoflow/server/migrations"
	"reflect"
	"strings"
	"testing"
	"time"
)

const fixture = `{"formatVersion":1,"projectId":"project-A","title":"设计联调","entryPageId":"page-A","pages":[{"pageId":"page-A","title":"首页","folderId":"folder-A","doc":{"header":[],"root":{"kind":"node","pfId":"root","type":"Page","props":{},"children":[]}}}],"tables":[],"tableRows":{}}`

var notesFixture = strings.Replace(fixture, `"formatVersion":1`, `"formatVersion":2,"stickyNotes":[{"id":"note-A","pageId":"page-A","targetWidgetId":"root","targetWidgetName":"页面整体","index":1,"text":"便签必须随发布保存","active":true}]`, 1)

var sitemapFixture = strings.Replace(notesFixture, `"formatVersion":2`, `"formatVersion":3,"sitemap":[{"id":"document-node","title":"设计变更记录","type":"doc","deprecated":false,"pageId":"doc-changelog"},{"id":"system-folder","title":"系统配置","type":"folder","deprecated":false,"children":[{"id":"folder-A","title":"业务管理","type":"folder","deprecated":false,"children":[{"id":"page-node","title":"首页","type":"page","deprecated":false,"pageId":"page-A"}]}]}]`, 1)

type memoryStore struct {
	items       map[string]Publication
	releases    map[string]DesktopRelease
	assets      map[string]DesktopReleaseAsset
	admins      map[string]PlatformAdmin
	adminPass   map[string]string
	adminTokens map[string]string
	users       map[string]ClientUser
	userPass    map[string]string
	userTokens  map[string]string
}

func (s *memoryStore) Publisher(_ context.Context, hash string) (string, string, error) {
	for _, token := range []string{"owner-A", "owner-B"} {
		if hash == TokenHash(token) {
			return token, token, nil
		}
	}
	return "", "", ErrNotFound
}
func (s *memoryStore) EnsureClientPublisher(_ context.Context, userID string) (string, string, error) {
	u, ok := s.users[userID]
	if !ok {
		return "", "", ErrNotFound
	}
	if u.PublisherID == "" {
		u.PublisherID = NewID()
		s.users[userID] = u
	}
	return u.PublisherID, u.DisplayName, nil
}
func (s *memoryStore) LinkClientPublisher(ctx context.Context, userID, hash string) (string, string, error) {
	id, name, err := s.Publisher(ctx, hash)
	if err != nil {
		return "", "", ErrInvalidAuth
	}
	u, ok := s.users[userID]
	if !ok {
		return "", "", ErrNotFound
	}
	if u.PublisherID != "" && u.PublisherID != id {
		return "", "", ErrConflict
	}
	for _, other := range s.users {
		if other.ID != userID && other.PublisherID == id {
			return "", "", ErrConflict
		}
	}
	u.PublisherID = id
	s.users[userID] = u
	return id, name, nil
}
func (s *memoryStore) List(_ context.Context, owner, project string) ([]Publication, error) {
	out := []Publication{}
	for _, p := range s.items {
		if p.PublisherID == owner && p.ProjectID == project {
			out = append(out, p)
		}
	}
	return out, nil
}
func (s *memoryStore) Get(_ context.Context, id, owner string) (Publication, error) {
	p, ok := s.items[id]
	if !ok || (owner != "" && owner != p.PublisherID) {
		return p, ErrNotFound
	}
	return p, nil
}
func (s *memoryStore) Create(_ context.Context, p Publication) (Publication, error) {
	p.Version = 1
	p.CreatedAt = time.Now()
	p.UpdatedAt = p.CreatedAt
	p.PasswordProtected = p.PasswordHash != ""
	s.items[p.ID] = p
	return p, nil
}
func (s *memoryStore) Update(_ context.Context, p Publication, v int) (Publication, error) {
	old := s.items[p.ID]
	if old.Version != v || old.RevokedAt != nil {
		return p, ErrConflict
	}
	p.Version++
	p.PasswordProtected = p.PasswordHash != ""
	s.items[p.ID] = p
	return p, nil
}
func (s *memoryStore) Revoke(_ context.Context, id, owner string, v int) (Publication, error) {
	p := s.items[id]
	if p.PublisherID != owner || p.Version != v || p.RevokedAt != nil {
		return p, ErrConflict
	}
	now := time.Now()
	p.RevokedAt = &now
	p.Version++
	s.items[id] = p
	return p, nil
}
func (s *memoryStore) ensureMaps() {
	if s.releases == nil {
		s.releases = map[string]DesktopRelease{}
	}
	if s.assets == nil {
		s.assets = map[string]DesktopReleaseAsset{}
	}
	if s.admins == nil {
		s.admins = map[string]PlatformAdmin{}
		s.adminPass = map[string]string{}
		s.adminTokens = map[string]string{}
	}
	if s.users == nil {
		s.users = map[string]ClientUser{}
		s.userPass = map[string]string{}
		s.userTokens = map[string]string{}
	}
}
func (s *memoryStore) HasPlatformAdmin(_ context.Context) (bool, error) {
	s.ensureMaps()
	return len(s.admins) > 0, nil
}
func (s *memoryStore) CreatePlatformAdmin(_ context.Context, admin PlatformAdmin) (PlatformAdmin, error) {
	s.ensureMaps()
	for _, a := range s.admins {
		if a.Username == admin.Username {
			return PlatformAdmin{}, ErrDuplicateUsername
		}
	}
	now := time.Now()
	admin.CreatedAt = now
	admin.UpdatedAt = now
	s.admins[admin.ID] = admin
	s.adminPass[admin.ID] = admin.PasswordHash
	if admin.TokenHash != "" {
		s.adminTokens[admin.TokenHash] = admin.ID
	}
	return admin, nil
}
func (s *memoryStore) UpsertPlatformAdmin(_ context.Context, admin PlatformAdmin) (PlatformAdmin, bool, error) {
	s.ensureMaps()
	u := strings.ToLower(strings.TrimSpace(admin.Username))
	for id, existing := range s.admins {
		if existing.Username == u {
			for k, v := range s.adminTokens {
				if v == id {
					delete(s.adminTokens, k)
				}
			}
			existing.DisplayName = admin.DisplayName
			existing.PasswordHash = admin.PasswordHash
			existing.TokenHash = admin.TokenHash
			existing.TokenExpiresAt = admin.TokenExpiresAt
			existing.UpdatedAt = time.Now()
			s.admins[id] = existing
			s.adminPass[id] = admin.PasswordHash
			if admin.TokenHash != "" {
				s.adminTokens[admin.TokenHash] = id
			}
			return existing, false, nil
		}
	}
	created, err := s.CreatePlatformAdmin(context.Background(), admin)
	return created, true, err
}
func (s *memoryStore) AuthenticatePlatformAdmin(_ context.Context, username, password, newTokenHash string, expiresAt time.Time) (PlatformAdmin, error) {
	s.ensureMaps()
	u := strings.ToLower(strings.TrimSpace(username))
	for id, a := range s.admins {
		if a.Username == u {
			if !CheckPassword(password, s.adminPass[id]) {
				return PlatformAdmin{}, ErrInvalidAuth
			}
			for k, v := range s.adminTokens {
				if v == id {
					delete(s.adminTokens, k)
				}
			}
			a.TokenHash = newTokenHash
			a.TokenExpiresAt = &expiresAt
			s.admins[id] = a
			s.adminTokens[newTokenHash] = id
			return a, nil
		}
	}
	return PlatformAdmin{}, ErrInvalidAuth
}
func (s *memoryStore) PlatformAdminByToken(_ context.Context, tokenHash string) (PlatformAdmin, error) {
	s.ensureMaps()
	id, ok := s.adminTokens[tokenHash]
	if !ok {
		return PlatformAdmin{}, ErrNotFound
	}
	a, ok := s.admins[id]
	if !ok {
		return PlatformAdmin{}, ErrNotFound
	}
	return a, nil
}
func (s *memoryStore) LogoutPlatformAdmin(_ context.Context, adminID string) error {
	s.ensureMaps()
	for k, v := range s.adminTokens {
		if v == adminID {
			delete(s.adminTokens, k)
		}
	}
	return nil
}
func (s *memoryStore) CreateClientUser(_ context.Context, user ClientUser) (ClientUser, error) {
	s.ensureMaps()
	for _, u := range s.users {
		if u.Username == user.Username {
			return ClientUser{}, ErrDuplicateUsername
		}
	}
	now := time.Now()
	user.CreatedAt = now
	user.UpdatedAt = now
	s.users[user.ID] = user
	s.userPass[user.ID] = user.PasswordHash
	if user.TokenHash != "" {
		s.userTokens[user.TokenHash] = user.ID
	}
	return user, nil
}
func (s *memoryStore) AuthenticateClientUser(_ context.Context, username, password, newTokenHash string, expiresAt time.Time) (ClientUser, error) {
	s.ensureMaps()
	uName := strings.ToLower(strings.TrimSpace(username))
	for id, u := range s.users {
		if u.Username == uName {
			if !CheckPassword(password, s.userPass[id]) {
				return ClientUser{}, ErrInvalidAuth
			}
			u.TokenHash = newTokenHash
			u.TokenExpiresAt = &expiresAt
			s.users[id] = u
			s.userTokens[newTokenHash] = id
			return u, nil
		}
	}
	return ClientUser{}, ErrInvalidAuth
}
func (s *memoryStore) ClientUserByToken(_ context.Context, tokenHash string) (ClientUser, error) {
	s.ensureMaps()
	id, ok := s.userTokens[tokenHash]
	if !ok {
		return ClientUser{}, ErrNotFound
	}
	u, ok := s.users[id]
	if !ok || (u.TokenExpiresAt != nil && !u.TokenExpiresAt.After(time.Now())) {
		return ClientUser{}, ErrNotFound
	}
	return u, nil
}
func (s *memoryStore) LogoutClientUser(_ context.Context, userID, tokenHash string) error {
	s.ensureMaps()
	for k, v := range s.userTokens {
		if v == userID && k == tokenHash {
			delete(s.userTokens, k)
		}
	}
	return nil
}
func (s *memoryStore) ListReleases(_ context.Context, publishedOnly bool) ([]DesktopRelease, error) {
	s.ensureMaps()
	out := []DesktopRelease{}
	for _, r := range s.releases {
		if publishedOnly && !r.Published {
			continue
		}
		r.Assets = []DesktopReleaseAsset{}
		for _, a := range s.assets {
			if a.ReleaseID == r.ID {
				a.Approved = IsAssetApproved(a)
				r.Assets = append(r.Assets, a)
			}
		}
		out = append(out, r)
	}
	SortReleases(out)
	return out, nil
}
func (s *memoryStore) ListUpdateCandidates(ctx context.Context, channel, targetOS string) ([]DesktopRelease, error) {
	items, err := s.ListReleases(ctx, true)
	var candidates []DesktopRelease
	for _, item := range items {
		if channel != "beta" && item.Channel != channel {
			continue
		}
		for _, asset := range item.Assets {
			if (targetOS == "" || asset.OS == targetOS) && IsAssetApproved(asset) {
				candidates = append(candidates, item)
				break
			}
		}
	}
	return candidates, err
}
func (s *memoryStore) GetRelease(_ context.Context, id string) (DesktopRelease, error) {
	s.ensureMaps()
	r, ok := s.releases[id]
	if !ok {
		return r, ErrNotFound
	}
	r.Assets = []DesktopReleaseAsset{}
	for _, a := range s.assets {
		if a.ReleaseID == r.ID {
			a.Approved = IsAssetApproved(a)
			r.Assets = append(r.Assets, a)
		}
	}
	return r, nil
}
func (s *memoryStore) CreateRelease(_ context.Context, r DesktopRelease) (DesktopRelease, error) {
	s.ensureMaps()
	for _, existing := range s.releases {
		if existing.Version == r.Version {
			return r, ErrDuplicateVersion
		}
	}
	now := time.Now()
	r.PublishedAt = now
	r.CreatedAt = now
	r.UpdatedAt = now
	r.Assets = []DesktopReleaseAsset{}
	s.releases[r.ID] = r
	return r, nil
}
func (s *memoryStore) UpdateRelease(_ context.Context, r DesktopRelease) (DesktopRelease, error) {
	s.ensureMaps()
	old, ok := s.releases[r.ID]
	if !ok {
		return r, ErrNotFound
	}
	for _, existing := range s.releases {
		if existing.ID != r.ID && existing.Version == r.Version {
			return r, ErrDuplicateVersion
		}
	}
	r.AdminID = old.AdminID
	r.CreatedAt = old.CreatedAt
	r.PublishedAt = old.PublishedAt
	r.UpdatedAt = time.Now()
	s.releases[r.ID] = r
	return s.GetRelease(context.Background(), r.ID)
}
func (s *memoryStore) DeleteRelease(_ context.Context, id string) (DesktopRelease, error) {
	rel, err := s.GetRelease(context.Background(), id)
	if err != nil {
		return rel, err
	}
	delete(s.releases, id)
	for aid, a := range s.assets {
		if a.ReleaseID == id {
			delete(s.assets, aid)
		}
	}
	return rel, nil
}
func (s *memoryStore) UpsertReleaseAsset(_ context.Context, a DesktopReleaseAsset) (DesktopReleaseAsset, string, error) {
	s.ensureMaps()
	var oldStorage string
	for aid, existing := range s.assets {
		if existing.ReleaseID == a.ReleaseID && existing.OS == a.OS && existing.Arch == a.Arch && existing.PackageType == a.PackageType {
			oldStorage = existing.StoragePath
			delete(s.assets, aid)
		}
	}
	now := time.Now()
	a.CreatedAt = now
	a.UpdatedAt = now
	a.Hosted = a.StoragePath != ""
	if a.ApprovedByAdminID != "" && a.ApprovedSHA256 != "" && a.ApprovedAt == nil {
		a.ApprovedAt = &now
	}
	a.Approved = IsAssetApproved(a)
	s.assets[a.ID] = a
	return a, oldStorage, nil
}
func (s *memoryStore) ApproveReleaseAsset(_ context.Context, releaseID, assetID, adminID, expectedSHA256 string) (DesktopReleaseAsset, error) {
	s.ensureMaps()
	a, ok := s.assets[assetID]
	if !ok || a.ReleaseID != releaseID {
		return DesktopReleaseAsset{}, ErrNotFound
	}
	if !sha256Pattern.MatchString(strings.TrimSpace(a.SHA256)) || a.SizeBytes <= 0 {
		return DesktopReleaseAsset{}, ErrConflict
	}
	if !sha256Pattern.MatchString(expectedSHA256) || !strings.EqualFold(expectedSHA256, a.SHA256) {
		return DesktopReleaseAsset{}, ErrConflict
	}
	now := time.Now()
	a.ApprovedByAdminID = adminID
	a.ApprovedSHA256 = strings.ToLower(a.SHA256)
	a.ApprovedAt = &now
	a.UpdatedAt = now
	a.Approved = IsAssetApproved(a)
	s.assets[assetID] = a
	return a, nil
}
func (s *memoryStore) GetReleaseAsset(_ context.Context, assetID string) (DesktopReleaseAsset, DesktopRelease, error) {
	s.ensureMaps()
	a, ok := s.assets[assetID]
	if !ok {
		return a, DesktopRelease{}, ErrNotFound
	}
	a.Approved = IsAssetApproved(a)
	rel, err := s.GetRelease(context.Background(), a.ReleaseID)
	return a, rel, err
}
func (s *memoryStore) DeleteReleaseAsset(_ context.Context, releaseID, assetID string) (DesktopReleaseAsset, error) {
	s.ensureMaps()
	a, ok := s.assets[assetID]
	if !ok || a.ReleaseID != releaseID {
		return a, ErrNotFound
	}
	delete(s.assets, assetID)
	return a, nil
}

func exercise(t *testing.T, store Store, owner, other, snapshotFixture string) {
	t.Helper()
	h := Handler(store, Options{PublicOrigin: "http://localhost:8088", AllowedOrigins: []string{"http://localhost:5173"}})
	request := func(method, path, token string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			if e := json.NewEncoder(&buf).Encode(body); e != nil {
				t.Fatal(e)
			}
		}
		r := httptest.NewRequest(method, path, &buf)
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	input := publishInput{Snapshot: json.RawMessage(snapshotFixture), Access: accessInput{PasswordAction: "set", Password: "test password"}}
	request("POST", "/api/v1/publications", "", input, 401)
	w := request("POST", "/api/v1/publications", owner, input, 200)
	var p Publication
	if e := json.Unmarshal(w.Body.Bytes(), &p); e != nil {
		t.Fatal(e)
	}
	if p.Version != 1 || !p.PasswordProtected || p.ProjectID != "project-A" || p.ShareURL != "http://localhost:8088/p/"+p.ID {
		t.Fatal("publication identity mismatch")
	}
	if strings.Contains(w.Body.String(), "test password") || strings.Contains(w.Body.String(), "snapshot") || strings.Contains(w.Body.String(), "publisherId") {
		t.Fatal("management metadata leaks private content")
	}
	input.ExpectedVersion = 1
	request("PUT", "/api/v1/publications/"+p.ID, other, input, 404)
	list := request("GET", "/api/v1/publications?projectId=project-A", other, nil, 200)
	if strings.Contains(list.Body.String(), p.ID) {
		t.Fatal("cross-owner listing")
	}
	metadata := request("GET", "/api/v1/view/"+p.ID, "", nil, 200)
	if strings.Contains(metadata.Body.String(), "root") {
		t.Fatal("protected snapshot leaked in metadata")
	}
	request("POST", "/api/v1/view/"+p.ID+"/open", "", map[string]string{"password": "wrong"}, 401)
	opened := request("POST", "/api/v1/view/"+p.ID+"/open", "", map[string]string{"password": "test password"}, 200)
	var original any
	var roundTrip struct {
		Snapshot any `json:"snapshot"`
	}
	if err := json.Unmarshal([]byte(snapshotFixture), &original); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(opened.Body.Bytes(), &roundTrip); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, roundTrip.Snapshot) {
		t.Fatal("published snapshot changed during storage round trip")
	}
	if strings.Contains(snapshotFixture, "stickyNotes") && !strings.Contains(opened.Body.String(), "便签必须随发布保存") {
		t.Fatal("published notes missing after storage round trip")
	}
	if strings.Contains(snapshotFixture, "sitemap") && (!strings.Contains(opened.Body.String(), "设计变更记录") || !strings.Contains(opened.Body.String(), "系统配置")) {
		t.Fatal("published menu tree missing after storage round trip")
	}
	if !strings.Contains(opened.Body.String(), "page-A") {
		t.Fatal("snapshot missing")
	}
	input.Access = accessInput{PasswordAction: "keep"}
	input.Snapshot = json.RawMessage(strings.Replace(snapshotFixture, "设计联调", "更新内容", 1))
	updated := request("PUT", "/api/v1/publications/"+p.ID, owner, input, 200)
	if !strings.Contains(updated.Body.String(), `"version":2`) {
		t.Fatal("version not incremented")
	}
	request("PUT", "/api/v1/publications/"+p.ID, owner, input, 409)
	request("POST", "/api/v1/view/"+p.ID+"/open", "", map[string]string{"password": ""}, 401)
	input.ExpectedVersion = 2
	input.Snapshot = json.RawMessage(strings.Replace(snapshotFixture, "project-A", "project-B", 1))
	request("PUT", "/api/v1/publications/"+p.ID, owner, input, 400)
	input.Snapshot = json.RawMessage(snapshotFixture)
	input.Access = accessInput{PasswordAction: "remove"}
	request("PUT", "/api/v1/publications/"+p.ID, owner, input, 200)
	request("POST", "/api/v1/view/"+p.ID+"/open", "", map[string]string{"password": ""}, 200)
	request("POST", "/api/v1/publications/"+p.ID+"/revoke", other, map[string]int{"expectedVersion": 3}, 404)
	request("POST", "/api/v1/publications/"+p.ID+"/revoke", owner, map[string]int{"expectedVersion": 2}, 409)
	request("POST", "/api/v1/publications/"+p.ID+"/revoke", owner, map[string]int{"expectedVersion": 3}, 200)
	request("POST", "/api/v1/view/"+p.ID+"/open", "", map[string]string{"password": ""}, 410)
	request("GET", "/api/v1/view/"+p.ID, "", nil, 410)
	request("GET", "/api/v1/view/does-not-exist", "", nil, 404)
	input.ExpectedVersion = 0
	past := time.Now().Add(-time.Hour)
	input.Access.ExpiresAt = &past
	request("POST", "/api/v1/publications", owner, input, 400)
	bad := json.RawMessage(strings.Replace(snapshotFixture, `"projectId":"project-A"`, `"storageDir":"/private","projectId":"project-A"`, 1))
	input.Snapshot = bad
	input.Access.ExpiresAt = nil
	request("POST", "/api/v1/publications", owner, input, 400)
	r := httptest.NewRequest("GET", "/api/v1/publisher", nil)
	r.Header.Set("Origin", "https://untrusted.example")
	r.Header.Set("Authorization", "Bearer "+owner)
	result := httptest.NewRecorder()
	h.ServeHTTP(result, r)
	if result.Code != 403 {
		t.Fatal("untrusted origin accepted")
	}
}

func TestPublishingLifecycle(t *testing.T) {
	for _, input := range []string{fixture, notesFixture, sitemapFixture, projectNotesFixture} {
		exercise(t, &memoryStore{items: map[string]Publication{}}, "owner-A", "owner-B", input)
	}
}
func TestPasswordHash(t *testing.T) {
	a, e := HashPassword("test password")
	if e != nil {
		t.Fatal(e)
	}
	b, _ := HashPassword("test password")
	if a == b || !CheckPassword("test password", a) || CheckPassword("wrong", a) || CheckPassword("test password", "malformed") {
		t.Fatal("password hashing failure")
	}
}
func TestExpiredPublication(t *testing.T) {
	past := time.Now().Add(-time.Minute)
	s := &memoryStore{items: map[string]Publication{"expired": {ID: "expired", ExpiresAt: &past}}}
	h := Handler(s, Options{PublicOrigin: "http://localhost:8088"})
	for _, path := range []string{"/api/v1/view/expired", "/api/v1/view/expired/open"} {
		method := "GET"
		if strings.HasSuffix(path, "open") {
			method = "POST"
		}
		r := httptest.NewRequest(method, path, strings.NewReader(`{"password":""}`))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 410 {
			t.Fatal(w.Code)
		}
	}
}
func TestPostgresLifecycle(t *testing.T) {
	dsn := os.Getenv("PUBLISH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PUBLISH_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal("test DB configuration invalid")
	}
	defer pool.Close()
	legacyMigrations := strings.Join([]string{migrations.Initial, migrations.PublishedNotes, migrations.PublishedSitemap, migrations.DesktopReleases, migrations.ReleaseAdminGovernance, migrations.ReleaseAssetApproval}, "\n")
	if _, e = pool.Exec(ctx, legacyMigrations); e != nil {
		t.Fatal(e)
	}
	owner, other := NewID(), NewID()
	ownerID, otherID := NewID(), NewID()
	for id, token := range map[string]string{ownerID: owner, otherID: other} {
		if _, e = pool.Exec(ctx, `INSERT INTO publishers(id,name,token_hash) VALUES($1,'integration-test',$2)`, id, TokenHash(token)); e != nil {
			t.Fatal(e)
		}
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM publications WHERE publisher_id=ANY($1)`, []string{ownerID, otherID})
		_, _ = pool.Exec(context.Background(), `DELETE FROM publishers WHERE id=ANY($1)`, []string{ownerID, otherID})
	}()
	for _, input := range []string{fixture, notesFixture, sitemapFixture} {
		exercise(t, Postgres{Pool: pool}, owner, other, input)
	}
	// Upgrade an existing V1-V3 database, then repeat startup migrations. Existing
	// records (including ownership, access settings and snapshots) must not change.
	const digestQuery = `SELECT md5(string_agg(row_to_json(p)::text, '' ORDER BY id)) FROM publications p WHERE publisher_id=ANY($1)`
	var before, after string
	if err := pool.QueryRow(ctx, digestQuery, []string{ownerID, otherID}).Scan(&before); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, migrations.All); err != nil {
			t.Fatal(err)
		}
	}
	if err := pool.QueryRow(ctx, digestQuery, []string{ownerID, otherID}).Scan(&after); err != nil || before != after {
		t.Fatalf("migration changed existing publications: %v", err)
	}
	for _, input := range []string{fixture, notesFixture, sitemapFixture, projectNotesFixture} {
		exercise(t, Postgres{Pool: pool}, owner, other, input)
	}

	// Verify PostgreSQL release governance, legacy V4 publisher_id release reconciliation, hosted digest backfill, and explicit admin approval gate
	pgStore := Postgres{Pool: pool}
	adminUserA := "pg_admin_a_" + strings.ToLower(NewID())
	adminUserB := "pg_admin_b_" + strings.ToLower(NewID())
	pwHash, err := HashPassword("pg-admin-pass-123")
	if err != nil {
		t.Fatal(err)
	}
	exp := time.Now().Add(time.Hour)
	adminA, created, err := pgStore.UpsertPlatformAdmin(ctx, PlatformAdmin{
		ID:             NewID(),
		Username:       adminUserA,
		DisplayName:    "PG Admin A",
		PasswordHash:   pwHash,
		TokenHash:      TokenHash("pfa_" + NewID()),
		TokenExpiresAt: &exp,
	})
	if err != nil || !created {
		t.Fatalf("UpsertPlatformAdmin A failed: err=%v created=%v", err, created)
	}
	adminB, created, err := pgStore.UpsertPlatformAdmin(ctx, PlatformAdmin{
		ID:             NewID(),
		Username:       adminUserB,
		DisplayName:    "PG Admin B",
		PasswordHash:   pwHash,
		TokenHash:      TokenHash("pfa_" + NewID()),
		TokenExpiresAt: &exp,
	})
	if err != nil || !created {
		t.Fatalf("UpsertPlatformAdmin B failed: err=%v created=%v", err, created)
	}
	legacyRelA := NewID()
	legacyRelB := NewID()
	legacyAssetID := NewID()
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM desktop_releases WHERE id=ANY($1)`, []string{legacyRelA, legacyRelB})
		_, _ = pool.Exec(context.Background(), `DELETE FROM platform_admins WHERE id=ANY($1)`, []string{adminA.ID, adminB.ID})
	}()
	// Insert two legacy V4 release rows: ownerID (pubA) and otherID (pubB), both with admin_id NULL
	if _, err := pool.Exec(ctx,
		`INSERT INTO desktop_releases(id, publisher_id, version, title, notes, channel, mandatory, published) VALUES($1,$2,'99.88.77','Legacy V4 Release A','','stable',false,true)`,
		legacyRelA, ownerID,
	); err != nil {
		t.Fatalf("failed inserting legacy release A: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO desktop_releases(id, publisher_id, version, title, notes, channel, mandatory, published) VALUES($1,$2,'99.88.78','Legacy V4 Release B','','stable',false,true)`,
		legacyRelB, otherID,
	); err != nil {
		t.Fatalf("failed inserting legacy release B: %v", err)
	}
	tmpStorage := t.TempDir()
	hostedFile := legacyAssetID + "-ProtoFlow-Legacy.dmg"
	hostedBytes := []byte("legacy-hosted-dmg-binary-contents")
	if err := os.WriteFile(tmpStorage+"/"+hostedFile, hostedBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO desktop_release_assets(id, release_id, os, arch, package_type, file_name, size_bytes, sha256, storage_path, external_url) VALUES($1,$2,'macos','arm64','dmg','ProtoFlow-Legacy.dmg',10,'0000000000000000000000000000000000000000000000000000000000000000',$3,'')`,
		legacyAssetID, legacyRelB, hostedFile,
	); err != nil {
		t.Fatalf("failed inserting legacy asset row: %v", err)
	}
	// Verify *=adminA,pubB=adminB deterministic ordering: specific publisher rule must win over wildcard * regardless of order or repeated runs
	rules1, err := ParseLegacyAdminMapping("*=" + adminA.Username + "," + otherID + "=" + adminB.Username)
	if err != nil {
		t.Fatalf("ParseLegacyAdminMapping failed: %v", err)
	}
	if err := pgStore.ReconcileLegacyReleases(ctx, tmpStorage, rules1); err != nil {
		t.Fatalf("ReconcileLegacyReleases run 1 failed: %v", err)
	}
	// Run a second time with reversed raw order
	rules2, err := ParseLegacyAdminMapping(otherID + "=" + adminB.Username + ",*=" + adminA.Username)
	if err != nil {
		t.Fatalf("ParseLegacyAdminMapping 2 failed: %v", err)
	}
	if err := pgStore.ReconcileLegacyReleases(ctx, tmpStorage, rules2); err != nil {
		t.Fatalf("ReconcileLegacyReleases run 2 failed: %v", err)
	}
	reconciledA, err := pgStore.GetRelease(ctx, legacyRelA)
	if err != nil || reconciledA.AdminID != adminA.ID || reconciledA.PublisherID != ownerID {
		t.Fatalf("expected legacyRelA to have AdminID=%s and PublisherID=%s, got %+v (err=%v)", adminA.ID, ownerID, reconciledA, err)
	}
	reconciledB, err := pgStore.GetRelease(ctx, legacyRelB)
	if err != nil || reconciledB.AdminID != adminB.ID || reconciledB.PublisherID != otherID {
		t.Fatalf("expected legacyRelB (pubB) to have AdminID=%s and PublisherID=%s, got %+v (err=%v)", adminB.ID, otherID, reconciledB, err)
	}
	// Even though admin_id is populated and digest is backfilled, the legacy asset MUST remain unapproved until explicitly approved by an admin
	if len(reconciledB.Assets) != 1 || reconciledB.Assets[0].Approved || reconciledB.Assets[0].ApprovedByAdminID != "" {
		t.Fatalf("expected reconciled legacy asset to remain unapproved before explicit admin confirmation, got %+v", reconciledB.Assets)
	}
	// A publisher-owned release may be approved before an ownership mapping is supplied.
	if _, err := pool.Exec(ctx, `UPDATE desktop_releases SET admin_id=NULL WHERE id=$1`, legacyRelB); err != nil {
		t.Fatal(err)
	}
	approvedAsset, err := pgStore.ApproveReleaseAsset(ctx, legacyRelB, legacyAssetID, adminB.ID, reconciledB.Assets[0].SHA256)
	if err != nil || !approvedAsset.Approved || approvedAsset.ApprovedByAdminID != adminB.ID {
		t.Fatalf("expected ApproveReleaseAsset to succeed, got %+v (err=%v)", approvedAsset, err)
	}
	ownerAfterApproval, err := pgStore.GetRelease(ctx, legacyRelB)
	if err != nil || ownerAfterApproval.AdminID != "" || ownerAfterApproval.PublisherID != otherID {
		t.Fatalf("approval changed legacy release ownership: %+v (%v)", ownerAfterApproval, err)
	}
	// Modifying sha256 in the database must immediately invalidate approval
	if _, err := pool.Exec(ctx, `UPDATE desktop_release_assets SET sha256=$1 WHERE id=$2`, strings.Repeat("f", 64), legacyAssetID); err != nil {
		t.Fatalf("failed updating sha256: %v", err)
	}
	afterTamper, _, err := pgStore.GetReleaseAsset(ctx, legacyAssetID)
	if err != nil || afterTamper.Approved {
		t.Fatalf("expected modified sha256 to invalidate asset approval, got %+v (err=%v)", afterTamper, err)
	}
}

func TestPublishedNotesContract(t *testing.T) {
	var base map[string]any
	if err := json.Unmarshal([]byte(fixture), &base); err != nil {
		t.Fatal(err)
	}
	base["formatVersion"] = 2
	note := map[string]any{"id": "note-A", "pageId": "page-A", "targetWidgetId": "root", "targetWidgetName": "页面整体", "index": 1, "text": "检查页面交互", "active": false}
	base["stickyNotes"] = []any{note}
	check := func(wantError bool) {
		t.Helper()
		raw, err := json.Marshal(base)
		if err != nil {
			t.Fatal(err)
		}
		_, err = ValidateSnapshot(raw)
		if (err != nil) != wantError {
			t.Fatalf("validation error=%v, wantError=%v", err, wantError)
		}
	}
	check(false)
	for _, field := range []string{"id", "pageId", "targetWidgetId", "targetWidgetName", "index", "text", "active"} {
		old := note[field]
		delete(note, field)
		check(true)
		note[field] = old
	}
	note["pageId"] = "unpublished"
	check(true)
	note["pageId"] = "page-A"
	note["compiledRule"] = "internal-only"
	check(true)
	delete(note, "compiledRule")
	base["stickyNotes"] = []any{note, note}
	check(true)
	base["stickyNotes"] = nil
	check(true)
	delete(base, "stickyNotes")
	check(true)
	base["stickyNotes"] = []any{}
	check(false)
	base["formatVersion"] = 1
	check(true)
	delete(base, "stickyNotes")
	check(false)
}

func TestPublishedSitemapContract(t *testing.T) {
	var base map[string]any
	if err := json.Unmarshal([]byte(sitemapFixture), &base); err != nil {
		t.Fatal(err)
	}
	check := func(wantError bool) {
		t.Helper()
		raw, err := json.Marshal(base)
		if err != nil {
			t.Fatal(err)
		}
		_, err = ValidateSnapshot(raw)
		if (err != nil) != wantError {
			t.Fatalf("validation error=%v, wantError=%v", err, wantError)
		}
	}
	check(false)
	tree := base["sitemap"].([]any)
	for _, invalid := range []any{nil, []any{}, append(append([]any{}, tree...), tree[0])} {
		base["sitemap"] = invalid
		check(true)
	}
	base["sitemap"] = tree
	doc := tree[0].(map[string]any)
	for _, key := range []string{"id", "title", "type", "pageId", "deprecated"} {
		old := doc[key]
		delete(doc, key)
		check(true)
		doc[key] = old
	}
	folder := tree[1].(map[string]any)["children"].([]any)[0].(map[string]any)
	folder["id"] = "wrong-parent"
	check(true)
	folder["id"] = "folder-A"
	doc["pageId"] = "page-A"
	check(true)
	doc["pageId"] = "doc-changelog"
	doc["children"] = []any{}
	check(true)
	delete(doc, "children")
	base["formatVersion"] = 2
	check(true)
	delete(base, "sitemap")
	check(false)
}

func TestDesktopReleasesLifecycle(t *testing.T) {
	if CompareSemver("0.2.0", "0.1.0") <= 0 || CompareSemver("0.2.0", "0.2.0-beta.1") <= 0 || CompareSemver("0.1.0", "0.1.0") != 0 {
		t.Fatal("semver comparison failed")
	}
	tmpDir := t.TempDir()
	store := &memoryStore{items: map[string]Publication{}}
	h := Handler(store, Options{
		PublicOrigin:      "http://localhost:8088",
		AllowedOrigins:    []string{"http://localhost:5173"},
		ReleaseStorageDir: tmpDir,
		TrustedProxies:    []string{"10.0.0.2"},
	})
	jsonReq := func(method, path, token string, body any, want int) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			if e := json.NewEncoder(&buf).Encode(body); e != nil {
				t.Fatal(e)
			}
		}
		r := httptest.NewRequest(method, path, &buf)
		r.RemoteAddr = "127.0.0.1:54321"
		r.Host = "127.0.0.1:8088"
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}

	// 1. Check initial admin status & verify anonymous /api/v1/admin/bootstrap is removed (404)
	statusRes := jsonReq("GET", "/api/v1/admin/status", "", nil, 200)
	if !strings.Contains(statusRes.Body.String(), `"initialized":false`) || !strings.Contains(statusRes.Body.String(), `"bootstrapAllowed":false`) {
		t.Fatalf("expected initialized=false and bootstrapAllowed=false, got %s", statusRes.Body.String())
	}
	jsonReq("POST", "/api/v1/admin/bootstrap", "", map[string]any{
		"username":    " hijack_admin ",
		"displayName": "Hijacker",
		"password":    "hijack-pass-123",
	}, 404)

	// 2. Register and login a client user (client_users table)
	userRegRes := jsonReq("POST", "/api/v1/auth/register", "", map[string]any{
		"username":    "alice_user",
		"displayName": "Alice",
		"password":    "user-pass-12345",
	}, 200)
	var userAuth struct {
		Token string     `json:"token"`
		User  ClientUser `json:"user"`
	}
	if err := json.Unmarshal(userRegRes.Body.Bytes(), &userAuth); err != nil || userAuth.Token == "" || userAuth.User.Username != "alice_user" {
		t.Fatalf("unexpected user register response: %s", userRegRes.Body.String())
	}
	jsonReq("GET", "/api/v1/auth/me", userAuth.Token, nil, 200)

	// 3. Provision platform admin via server CLI store method (UpsertPlatformAdmin) and verify password rotation + token revocation
	initialHash, err := HashPassword("initial-pass-111")
	if err != nil {
		t.Fatal(err)
	}
	initialCliToken := "pfa_initial_cli_token"
	exp := time.Now().Add(24 * time.Hour)
	_, createdFlag, err := store.UpsertPlatformAdmin(context.Background(), PlatformAdmin{
		ID:             NewID(),
		Username:       "release_admin",
		DisplayName:    "版本管理员",
		PasswordHash:   initialHash,
		TokenHash:      TokenHash(initialCliToken),
		TokenExpiresAt: &exp,
	})
	if err != nil || !createdFlag {
		t.Fatalf("expected UpsertPlatformAdmin to create initial admin, err=%v created=%v", err, createdFlag)
	}
	jsonReq("GET", "/api/v1/admin/me", initialCliToken, nil, 200)

	// Rotate admin password via UpsertPlatformAdmin -> old token and old password must be invalidated
	rotatedHash, err := HashPassword("admin-secret-999")
	if err != nil {
		t.Fatal(err)
	}
	rotatedCliToken := "pfa_rotated_cli_token"
	_, createdFlag, err = store.UpsertPlatformAdmin(context.Background(), PlatformAdmin{
		ID:             NewID(),
		Username:       "release_admin",
		DisplayName:    "版本管理员",
		PasswordHash:   rotatedHash,
		TokenHash:      TokenHash(rotatedCliToken),
		TokenExpiresAt: &exp,
	})
	if err != nil || createdFlag {
		t.Fatalf("expected UpsertPlatformAdmin to rotate existing admin, err=%v created=%v", err, createdFlag)
	}
	jsonReq("GET", "/api/v1/admin/me", initialCliToken, nil, 403)
	jsonReq("POST", "/api/v1/admin/login", "", map[string]any{
		"username": "release_admin",
		"password": "initial-pass-111",
	}, 401)

	// Login as platform admin with rotated password
	var adminAuth struct {
		Token string        `json:"token"`
		Admin PlatformAdmin `json:"admin"`
	}
	adminLoginRes := jsonReq("POST", "/api/v1/admin/login", "", map[string]any{
		"username": "release_admin",
		"password": "admin-secret-999",
	}, 200)
	if err := json.Unmarshal(adminLoginRes.Body.Bytes(), &adminAuth); err != nil || adminAuth.Token == "" {
		t.Fatalf("admin login failed: %s", adminLoginRes.Body.String())
	}
	adminToken := adminAuth.Token

	// 3b. [P1] Verify plain LAN HTTP requests to /api/v1/admin/* and /api/v1/releases* are rejected with 403,
	// even if an untrusted peer spoofs X-Forwarded-Proto: https or X-Protoflow-Admin-Channel: loopback!
	lanLoginReq := httptest.NewRequest("POST", "http://192.168.1.104:8088/api/v1/admin/login", strings.NewReader(`{"username":"release_admin","password":"admin-secret-999"}`))
	lanLoginReq.RemoteAddr = "192.168.1.55:54321"
	lanLoginReq.Host = "192.168.1.104:8088"
	lanLoginReq.Header.Set("Content-Type", "application/json")
	lanLoginRec := httptest.NewRecorder()
	h.ServeHTTP(lanLoginRec, lanLoginReq)
	if lanLoginRec.Code != 403 {
		t.Fatalf("expected LAN HTTP admin login to be rejected with 403, got %d: %s", lanLoginRec.Code, lanLoginRec.Body.String())
	}

	// Direct LAN connection spoofing X-Forwarded-Proto: https MUST be rejected with 403 because 192.168.1.55 is not in TrustedProxies
	spoofedHttpsReq := httptest.NewRequest("POST", "http://192.168.1.104:8088/api/v1/admin/login", strings.NewReader(`{"username":"release_admin","password":"admin-secret-999"}`))
	spoofedHttpsReq.RemoteAddr = "192.168.1.55:54321"
	spoofedHttpsReq.Host = "192.168.1.104:8088"
	spoofedHttpsReq.Header.Set("Content-Type", "application/json")
	spoofedHttpsReq.Header.Set("X-Forwarded-Proto", "https")
	spoofedHttpsReq.Header.Set("X-Protoflow-Admin-Channel", "loopback")
	spoofedHttpsRec := httptest.NewRecorder()
	h.ServeHTTP(spoofedHttpsRec, spoofedHttpsReq)
	if spoofedHttpsRec.Code != 403 {
		t.Fatalf("expected direct LAN request with spoofed X-Forwarded-Proto: https to be rejected with 403, got %d: %s", spoofedHttpsRec.Code, spoofedHttpsRec.Body.String())
	}

	// Trusted proxy (10.0.0.2) forwarding plain LAN HTTP -> 403
	lanProxyReq := httptest.NewRequest("GET", "/api/v1/releases", nil)
	lanProxyReq.RemoteAddr = "10.0.0.2:40000"
	lanProxyReq.Host = "192.168.1.104:8088"
	lanProxyReq.Header.Set("Authorization", "Bearer "+adminToken)
	lanProxyReq.Header.Set("X-Forwarded-Proto", "http")
	lanProxyReq.Header.Set("X-Protoflow-Client-IP", "192.168.1.55")
	lanProxyRec := httptest.NewRecorder()
	h.ServeHTTP(lanProxyRec, lanProxyReq)
	if lanProxyRec.Code != 403 {
		t.Fatalf("expected proxied LAN HTTP /api/v1/releases to be rejected with 403, got %d", lanProxyRec.Code)
	}

	// Trusted proxy (10.0.0.2) forwarding HTTPS -> 200
	httpsProxyReq := httptest.NewRequest("GET", "/api/v1/releases", nil)
	httpsProxyReq.RemoteAddr = "10.0.0.2:40001"
	httpsProxyReq.Host = "releases.example.com"
	httpsProxyReq.Header.Set("Authorization", "Bearer "+adminToken)
	httpsProxyReq.Header.Set("X-Forwarded-Proto", "https")
	httpsProxyReq.Header.Set("X-Protoflow-Client-IP", "192.168.1.55")
	httpsProxyRec := httptest.NewRecorder()
	h.ServeHTTP(httpsProxyRec, httpsProxyReq)
	if httpsProxyRec.Code != 200 {
		t.Fatalf("expected HTTPS proxied /api/v1/releases to return 200, got %d: %s", httpsProxyRec.Code, httpsProxyRec.Body.String())
	}

	// Trusted proxy (10.0.0.2) forwarding Compose dedicated loopback listener (X-Protoflow-Admin-Channel: loopback, X-Protoflow-Client-IP: 127.0.0.1) -> 200
	composeLoopbackReq := httptest.NewRequest("GET", "/api/v1/releases", nil)
	composeLoopbackReq.RemoteAddr = "10.0.0.2:40002"
	composeLoopbackReq.Host = "127.0.0.1:8088"
	composeLoopbackReq.Header.Set("Authorization", "Bearer "+adminToken)
	composeLoopbackReq.Header.Set("X-Forwarded-Proto", "http")
	composeLoopbackReq.Header.Set("X-Protoflow-Admin-Channel", "loopback")
	composeLoopbackReq.Header.Set("X-Protoflow-Client-IP", "127.0.0.1")
	composeLoopbackRec := httptest.NewRecorder()
	h.ServeHTTP(composeLoopbackRec, composeLoopbackReq)
	if composeLoopbackRec.Code != 200 {
		t.Fatalf("expected Compose loopback admin channel /api/v1/releases to return 200, got %d: %s", composeLoopbackRec.Code, composeLoopbackRec.Body.String())
	}

	loopbackReq := httptest.NewRequest("GET", "http://127.0.0.1:8088/api/v1/releases", nil)
	loopbackReq.Host = "127.0.0.1:8088"
	loopbackReq.RemoteAddr = "127.0.0.1:54321"
	loopbackReq.Header.Set("Authorization", "Bearer "+adminToken)
	loopbackRec := httptest.NewRecorder()
	h.ServeHTTP(loopbackRec, loopbackReq)
	if loopbackRec.Code != 200 {
		t.Fatalf("expected loopback HTTP /api/v1/releases to return 200, got %d: %s", loopbackRec.Code, loopbackRec.Body.String())
	}

	// 4. [P1] Verify ordinary publishers (owner-A, owner-B) and client users (userAuth.Token) are forbidden (403) from release management
	createBody := map[string]any{
		"version":   "v0.2.0",
		"title":     "ProtoFlow AI 0.2.0 跨端更新版",
		"notes":     "1. 新增三端自动更新\n2. 新增 Web 版本中心",
		"channel":   "stable",
		"mandatory": true,
		"published": true,
	}
	jsonReq("POST", "/api/v1/releases", "", createBody, 401)
	jsonReq("POST", "/api/v1/releases", "owner-A", createBody, 403)
	jsonReq("POST", "/api/v1/releases", "owner-B", createBody, 403)
	jsonReq("POST", "/api/v1/releases", userAuth.Token, createBody, 403)
	jsonReq("GET", "/api/v1/releases", "owner-A", nil, 403)
	jsonReq("GET", "/api/v1/releases", userAuth.Token, nil, 403)

	// 5. Create release v0.2.0 as platform admin
	w := jsonReq("POST", "/api/v1/releases", adminToken, createBody, 200)
	var rel DesktopRelease
	if err := json.Unmarshal(w.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	if rel.Version != "0.2.0" || !rel.Mandatory || !rel.Published {
		t.Fatalf("unexpected release: %+v", rel)
	}
	// Duplicate version should conflict
	jsonReq("POST", "/api/v1/releases", adminToken, createBody, 409)

	// Ordinary publisher B and client user cannot delete or edit admin's release
	jsonReq("DELETE", "/api/v1/releases/"+rel.ID, "owner-B", nil, 403)
	jsonReq("DELETE", "/api/v1/releases/"+rel.ID, userAuth.Token, nil, 403)
	jsonReq("PUT", "/api/v1/releases/"+rel.ID, "owner-B", createBody, 403)

	// Upload macOS arm64 dmg via multipart/form-data
	var mpBuf bytes.Buffer
	mw := multipart.NewWriter(&mpBuf)
	_ = mw.WriteField("os", "macos")
	_ = mw.WriteField("arch", "arm64")
	_ = mw.WriteField("packageType", "dmg")
	part, err := mw.CreateFormFile("file", "ProtoFlow-AI-0.2.0-mac-arm64.dmg")
	if err != nil {
		t.Fatal(err)
	}
	dmgPayload := []byte("fake-macos-dmg-binary-payload-0.2.0")
	_, _ = part.Write(dmgPayload)
	_ = mw.Close()

	// Publisher cannot upload installer
	forbidReq := httptest.NewRequest("POST", "/api/v1/releases/"+rel.ID+"/assets", bytes.NewReader(mpBuf.Bytes()))
	forbidReq.RemoteAddr = "127.0.0.1:54321"
	forbidReq.Host = "127.0.0.1:8088"
	forbidReq.Header.Set("Content-Type", mw.FormDataContentType())
	forbidReq.Header.Set("Authorization", "Bearer owner-B")
	forbidRec := httptest.NewRecorder()
	h.ServeHTTP(forbidRec, forbidReq)
	if forbidRec.Code != 403 {
		t.Fatalf("expected publisher upload to return 403, got %d", forbidRec.Code)
	}

	upReq := httptest.NewRequest("POST", "/api/v1/releases/"+rel.ID+"/assets", &mpBuf)
	upReq.RemoteAddr = "127.0.0.1:54321"
	upReq.Host = "127.0.0.1:8088"
	upReq.Header.Set("Content-Type", mw.FormDataContentType())
	upReq.Header.Set("Authorization", "Bearer "+adminToken)
	upRec := httptest.NewRecorder()
	h.ServeHTTP(upRec, upReq)
	if upRec.Code != 200 {
		t.Fatalf("multipart upload failed: %d %s", upRec.Code, upRec.Body.String())
	}
	var macAsset DesktopReleaseAsset
	if err := json.Unmarshal(upRec.Body.Bytes(), &macAsset); err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256(dmgPayload)
	if macAsset.SHA256 != hex.EncodeToString(wantHash[:]) || macAsset.SizeBytes != int64(len(dmgPayload)) || !macAsset.Hosted || !macAsset.Approved || macAsset.Signature == "" || macAsset.SigningPublicKey == "" {
		t.Fatalf("asset metadata mismatch: %+v", macAsset)
	}
	// Verify Ed25519 signature of asset manifest (protoflow-release-v2 includes channel and mandatory)
	pubBytes, err := base64.StdEncoding.DecodeString(macAsset.SigningPublicKey)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		t.Fatalf("invalid signingPublicKey: %v", err)
	}
	sigBytes, err := base64.StdEncoding.DecodeString(macAsset.Signature)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(pubBytes), []byte(AssetCanonicalManifest(rel.Version, rel.Channel, rel.Mandatory, macAsset)), sigBytes) {
		t.Fatal("Ed25519 asset signature verification failed")
	}

	// Upload Windows x64 exe via raw stream
	winPayload := []byte("fake-windows-nsis-installer-0.2.0")
	winReq := httptest.NewRequest("POST", "/api/v1/releases/"+rel.ID+"/assets?os=windows&arch=x64&packageType=exe&fileName=ProtoFlow-AI-0.2.0-win-x64.exe", bytes.NewReader(winPayload))
	winReq.RemoteAddr = "127.0.0.1:54321"
	winReq.Host = "127.0.0.1:8088"
	winReq.Header.Set("Authorization", "Bearer "+adminToken)
	winRec := httptest.NewRecorder()
	h.ServeHTTP(winRec, winReq)
	if winRec.Code != 200 {
		t.Fatalf("raw upload failed: %d %s", winRec.Code, winRec.Body.String())
	}

	// [P1] External link without valid sha256 or sizeBytes <= 0 must be rejected with 400
	jsonReq("POST", "/api/v1/releases/"+rel.ID+"/assets/link", adminToken, map[string]any{
		"os":          "linux",
		"arch":        "x64",
		"packageType": "deb",
		"fileName":    "ProtoFlow-AI-0.2.0-linux-amd64.deb",
		"externalUrl": "https://downloads.example.com/ProtoFlow-AI-0.2.0-linux-amd64.deb",
		"sizeBytes":   100,
		"sha256":      "",
	}, 400)
	jsonReq("POST", "/api/v1/releases/"+rel.ID+"/assets/link", adminToken, map[string]any{
		"os":          "linux",
		"arch":        "x64",
		"packageType": "deb",
		"fileName":    "ProtoFlow-AI-0.2.0-linux-amd64.deb",
		"externalUrl": "https://downloads.example.com/ProtoFlow-AI-0.2.0-linux-amd64.deb",
		"sizeBytes":   0,
		"sha256":      strings.Repeat("a", 64),
	}, 400)

	// Register Linux deb and AppImage via link endpoint
	jsonReq("POST", "/api/v1/releases/"+rel.ID+"/assets/link", adminToken, map[string]any{
		"os":          "linux",
		"arch":        "x64",
		"packageType": "deb",
		"fileName":    "ProtoFlow-AI-0.2.0-linux-amd64.deb",
		"externalUrl": "https://downloads.example.com/ProtoFlow-AI-0.2.0-linux-amd64.deb",
		"sizeBytes":   103000116,
		"sha256":      strings.Repeat("a", 64),
	}, 200)
	jsonReq("POST", "/api/v1/releases/"+rel.ID+"/assets/link", adminToken, map[string]any{
		"os":          "linux",
		"arch":        "x64",
		"packageType": "AppImage",
		"fileName":    "ProtoFlow-AI-0.2.0-linux-x86_64.AppImage",
		"externalUrl": "https://downloads.example.com/ProtoFlow-AI-0.2.0-linux-x86_64.AppImage",
		"sizeBytes":   128092659,
		"sha256":      strings.Repeat("b", 64),
	}, 200)

	// Check update for macOS arm64 from v0.1.0
	checkMac := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=darwin&arch=arm64", "", nil, 200)
	var checkResult struct {
		HasUpdate        bool                  `json:"hasUpdate"`
		LatestRelease    *DesktopRelease       `json:"latestRelease"`
		RecommendedAsset *DesktopReleaseAsset  `json:"recommendedAsset"`
		PlatformAssets   []DesktopReleaseAsset `json:"platformAssets"`
		SigningPublicKey string                `json:"signingPublicKey"`
	}
	if err := json.Unmarshal(checkMac.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if !checkResult.HasUpdate || checkResult.LatestRelease == nil || checkResult.LatestRelease.Version != "0.2.0" || checkResult.RecommendedAsset == nil || checkResult.RecommendedAsset.PackageType != "dmg" || checkResult.SigningPublicKey == "" {
		t.Fatalf("unexpected mac update check: %+v", checkResult)
	}

	// [P1] Check update for Linux arm64 when only Linux x64 assets exist: both recommendedAsset and platformAssets must be empty!
	checkIncompatibleArch := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=linux&arch=arm64&preferPackage=AppImage", "", nil, 200)
	if err := json.Unmarshal(checkIncompatibleArch.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if checkResult.HasUpdate || checkResult.LatestRelease != nil || checkResult.RecommendedAsset != nil || len(checkResult.PlatformAssets) != 0 {
		t.Fatalf("expected empty platformAssets for incompatible arch, got recommended=%+v platformAssets=%+v", checkResult.RecommendedAsset, checkResult.PlatformAssets)
	}

	// Check update for Linux x64 preferring AppImage
	checkLinux := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=linux&arch=x64&preferPackage=AppImage", "", nil, 200)
	if err := json.Unmarshal(checkLinux.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if !checkResult.HasUpdate || checkResult.RecommendedAsset == nil || checkResult.RecommendedAsset.PackageType != "AppImage" || len(checkResult.PlatformAssets) != 2 {
		t.Fatalf("unexpected linux AppImage check: %+v", checkResult)
	}

	// Check when already on v0.2.0
	checkSame := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.2.0&os=win32&arch=x64", "", nil, 200)
	if err := json.Unmarshal(checkSame.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if checkResult.HasUpdate || checkResult.RecommendedAsset == nil || checkResult.RecommendedAsset.PackageType != "exe" {
		t.Fatalf("unexpected same-version check: %+v", checkResult)
	}

	// Pending, incompatible and physically missing packages must not mask an installable release.
	versions := map[string]string{"pending": "4.0.0", "other-platform": "3.0.0", "missing-file": "2.0.0"}
	for id, version := range versions {
		newer := rel
		newer.ID = id
		newer.Version = version
		store.releases[id] = newer
		asset := macAsset
		asset.ID, asset.ReleaseID = id, id
		switch id {
		case "pending":
			asset.ApprovedByAdminID = ""
		case "other-platform":
			asset.OS, asset.Arch, asset.PackageType = "windows", "x64", "exe"
		case "missing-file":
			asset.StoragePath = "missing.dmg"
		}
		store.assets[id] = asset
	}
	fallback := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=macos&arch=arm64", "", nil, 200)
	if err := json.Unmarshal(fallback.Body.Bytes(), &checkResult); err != nil || !checkResult.HasUpdate || checkResult.LatestRelease == nil || checkResult.LatestRelease.ID != rel.ID || checkResult.RecommendedAsset == nil || checkResult.RecommendedAsset.ID != macAsset.ID {
		t.Fatalf("check did not select the installable release: %+v (%v)", checkResult, err)
	}
	for id := range versions {
		delete(store.releases, id)
		delete(store.assets, id)
	}

	// Download hosted macOS asset
	dlReq := httptest.NewRequest("GET", "/api/v1/updates/assets/"+macAsset.ID+"/download", nil)
	dlRec := httptest.NewRecorder()
	h.ServeHTTP(dlRec, dlReq)
	if dlRec.Code != 200 || !bytes.Equal(dlRec.Body.Bytes(), dmgPayload) || dlRec.Header().Get("X-Checksum-Sha256") != macAsset.SHA256 {
		t.Fatalf("download failed: status=%d hash=%s", dlRec.Code, dlRec.Header().Get("X-Checksum-Sha256"))
	}

	// [P1] Legacy external asset without valid sha256 or sizeBytes <= 0 is paused from public updates & downloads until updated by admin
	store.assets["legacy-untrusted"] = DesktopReleaseAsset{
		ID:          "legacy-untrusted",
		ReleaseID:   rel.ID,
		OS:          "macos",
		Arch:        "x64",
		PackageType: "zip",
		FileName:    "ProtoFlow-Legacy.zip",
		SizeBytes:   0,
		SHA256:      "",
		ExternalURL: "https://downloads.example.com/ProtoFlow-Legacy.zip",
	}
	checkLegacy := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=darwin&arch=x64", "", nil, 200)
	if err := json.Unmarshal(checkLegacy.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if checkResult.HasUpdate || checkResult.LatestRelease != nil || checkResult.RecommendedAsset != nil || len(checkResult.PlatformAssets) != 0 {
		t.Fatalf("expected untrusted legacy external asset to be excluded from public check, got %+v", checkResult)
	}
	jsonReq("GET", "/api/v1/updates/assets/legacy-untrusted/download", "", nil, 409)

	// [P1] Legacy hosted asset with valid SHA-256 and admin_id on the release, but NOT yet approved by an admin:
	// - visible in /api/v1/releases (admin endpoint) with approved=false and signature=""
	// - excluded from public /api/v1/updates and /api/v1/updates/check
	// - direct download returns 403
	// - once approved via POST /api/v1/releases/:id/assets/:assetId/approve, it gets signed and becomes publicly downloadable
	// - if the file on disk is replaced or tampered with, approval is immediately invalidated (403 on download, excluded from check)
	legacyZipBytes := []byte("legacy-v4-publisher-zip-content")
	legacyZipSum := sha256.Sum256(legacyZipBytes)
	legacyZipSha := hex.EncodeToString(legacyZipSum[:])
	legacyZipFile := "legacy-v4-publisher-x64.zip"
	if err := os.WriteFile(tmpDir+"/"+legacyZipFile, legacyZipBytes, 0600); err != nil {
		t.Fatal(err)
	}
	store.assets["legacy-unapproved"] = DesktopReleaseAsset{
		ID:          "legacy-unapproved",
		ReleaseID:   rel.ID,
		OS:          "macos",
		Arch:        "x64",
		PackageType: "zip",
		FileName:    "ProtoFlow-0.2.0-mac-x64.zip",
		SizeBytes:   int64(len(legacyZipBytes)),
		SHA256:      legacyZipSha,
		StoragePath: legacyZipFile,
		Hosted:      true,
	}

	// Admin list shows legacy-unapproved with approved=false and signature=""
	adminListRes := jsonReq("GET", "/api/v1/releases", adminToken, nil, 200)
	if !strings.Contains(adminListRes.Body.String(), `"id":"legacy-unapproved"`) {
		t.Fatalf("expected legacy-unapproved to be visible in admin releases list, got %s", adminListRes.Body.String())
	}
	// Public check & download must block legacy-unapproved before admin approval
	checkUnapproved := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=darwin&arch=x64", "", nil, 200)
	if err := json.Unmarshal(checkUnapproved.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if checkResult.HasUpdate || checkResult.LatestRelease != nil || checkResult.RecommendedAsset != nil || len(checkResult.PlatformAssets) != 0 {
		t.Fatalf("expected unapproved legacy asset to be excluded from public check, got %+v", checkResult)
	}
	jsonReq("GET", "/api/v1/updates/assets/legacy-unapproved/download", "", nil, 403)

	approvePath := "/api/v1/releases/" + rel.ID + "/assets/legacy-unapproved/approve"
	for _, invalid := range []any{nil, map[string]string{}, map[string]string{"sha256": ""}, map[string]string{"sha256": "invalid"}} {
		jsonReq("POST", approvePath, adminToken, invalid, 400)
	}
	if IsAssetApproved(store.assets["legacy-unapproved"]) {
		t.Fatal("invalid approval requests must leave the asset pending")
	}

	// Approve with mismatched sha256 must fail with 409
	jsonReq("POST", "/api/v1/releases/"+rel.ID+"/assets/legacy-unapproved/approve", adminToken, map[string]any{
		"sha256": strings.Repeat("0", 64),
	}, 409)

	// Approve with matching sha256 succeeds and returns signed asset
	approveRes := jsonReq("POST", "/api/v1/releases/"+rel.ID+"/assets/legacy-unapproved/approve", adminToken, map[string]any{
		"sha256": legacyZipSha,
	}, 200)
	var approvedZip DesktopReleaseAsset
	if err := json.Unmarshal(approveRes.Body.Bytes(), &approvedZip); err != nil {
		t.Fatal(err)
	}
	if !approvedZip.Approved || approvedZip.Signature == "" || approvedZip.ApprovedByAdminID == "" {
		t.Fatalf("expected approved asset to have signature and Approved=true, got %+v", approvedZip)
	}

	// Now public check and download succeed
	checkAfterApprove := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=darwin&arch=x64", "", nil, 200)
	if err := json.Unmarshal(checkAfterApprove.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if checkResult.RecommendedAsset == nil || checkResult.RecommendedAsset.ID != "legacy-unapproved" || checkResult.RecommendedAsset.Signature == "" {
		t.Fatalf("expected approved legacy asset to be recommended and signed, got %+v", checkResult)
	}
	jsonReq("GET", "/api/v1/updates/assets/legacy-unapproved/download", "", nil, 200)

	// Replacing the file on disk with different content invalidates the approval without needing a DB change
	if err := os.WriteFile(tmpDir+"/"+legacyZipFile, []byte("tampered-on-disk-zip-bytes!"), 0600); err != nil {
		t.Fatal(err)
	}
	jsonReq("GET", "/api/v1/updates/assets/legacy-unapproved/download", "", nil, 403)
	checkAfterDiskTamper := jsonReq("GET", "/api/v1/updates/check?currentVersion=0.1.0&os=darwin&arch=x64", "", nil, 200)
	if err := json.Unmarshal(checkAfterDiskTamper.Body.Bytes(), &checkResult); err != nil {
		t.Fatal(err)
	}
	if checkResult.HasUpdate || checkResult.LatestRelease != nil || checkResult.RecommendedAsset != nil || len(checkResult.PlatformAssets) != 0 {
		t.Fatalf("expected on-disk file replacement to invalidate approval and hide asset from public check, got %+v", checkResult)
	}
}

func TestSigningKeyPersistenceAndFailure(t *testing.T) {
	// 1. Valid directory persists key and returns identical public key across restarts
	dir := t.TempDir()
	priv1, pub1, err := LoadOrCreateSigningKey(dir, nil)
	if err != nil || len(priv1) != ed25519.PrivateKeySize || pub1 == "" {
		t.Fatalf("expected signing key creation to succeed, err=%v", err)
	}
	priv2, pub2, err := LoadOrCreateSigningKey(dir, nil)
	if err != nil || pub1 != pub2 || !bytes.Equal(priv1, priv2) {
		t.Fatalf("expected signing key to persist across restarts, pub1=%s pub2=%s err=%v", pub1, pub2, err)
	}

	// 2. Corrupted existing key file must return error and refuse to regenerate a different key
	corruptDir := t.TempDir()
	keyPath := corruptDir + "/.release-signing-key.ed25519"
	if err := os.WriteFile(keyPath, []byte("not-a-valid-ed25519-seed\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadOrCreateSigningKey(corruptDir, nil); err == nil {
		t.Fatal("expected corrupted key file to fail LoadOrCreateSigningKey")
	}

	// 3. Read-only directory where temporary key file cannot be written must return error on both calls
	roDir := t.TempDir()
	if err := os.Chmod(roDir, 0500); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = os.Chmod(roDir, 0700)
	}()
	if _, _, err := LoadOrCreateSigningKey(roDir, nil); err == nil {
		t.Fatal("expected first LoadOrCreateSigningKey on read-only dir to fail")
	}
	if _, _, err := LoadOrCreateSigningKey(roDir, nil); err == nil {
		t.Fatal("expected second LoadOrCreateSigningKey on read-only dir to fail")
	}
}

type failingAdminStore struct {
	*memoryStore
	failUpsert bool
}

func (f *failingAdminStore) UpsertPlatformAdmin(ctx context.Context, admin PlatformAdmin) (PlatformAdmin, bool, error) {
	if f.failUpsert {
		return PlatformAdmin{}, false, ErrConflict
	}
	return f.memoryStore.UpsertPlatformAdmin(ctx, admin)
}

func TestCreateAdminRollbackAndLegacyMapping(t *testing.T) {
	// 1. ParseLegacyAdminMapping strict validation and deterministic ordering
	for _, invalidRaw := range []string{
		"malformed_without_equals",
		"=adminA",
		"pubB=",
		"pubB=bad!username",
		"pubB=adminB,pubB=adminA",
		"*=adminA,*=adminB",
		"*,pubB=adminB",
	} {
		if _, err := ParseLegacyAdminMapping(invalidRaw); err == nil {
			t.Fatalf("expected ParseLegacyAdminMapping(%q) to fail validation", invalidRaw)
		}
	}

	rulesOrderA, err := ParseLegacyAdminMapping("*=adminA,pubB=adminB,pubC=adminC")
	if err != nil {
		t.Fatalf("unexpected error parsing valid mapping: %v", err)
	}
	rulesOrderB, err := ParseLegacyAdminMapping("pubC=adminC,*=adminA,pubB=adminB")
	if err != nil {
		t.Fatalf("unexpected error parsing valid mapping B: %v", err)
	}
	if len(rulesOrderA) != 3 || len(rulesOrderB) != 3 {
		t.Fatalf("expected 3 rules, got %d and %d", len(rulesOrderA), len(rulesOrderB))
	}
	// Specific rules must be sorted deterministically first, and wildcard '*' must always be last
	for i := range rulesOrderA {
		if rulesOrderA[i] != rulesOrderB[i] {
			t.Fatalf("expected identical sorted rule order regardless of input order: %+v vs %+v", rulesOrderA, rulesOrderB)
		}
	}
	if rulesOrderA[2].PublisherID != "*" || rulesOrderA[2].AdminRef != "adminA" {
		t.Fatalf("expected wildcard '*' rule to be last, got %+v", rulesOrderA)
	}

	// 2. ExecuteCreateAdminCommand atomicity: preserve credentials when token file write or DB upsert fails
	ctx := context.Background()
	mem := &memoryStore{items: map[string]Publication{}}
	store := &failingAdminStore{memoryStore: mem}
	tmpDir := t.TempDir()

	initialTokenFile := tmpDir + "/admin.token"
	admin, created, rawToken1, err := ExecuteCreateAdminCommand(ctx, store, "ops_admin", "initial-pass-123", initialTokenFile)
	if err != nil || !created || admin.Username != "ops_admin" || rawToken1 == "" {
		t.Fatalf("initial ExecuteCreateAdminCommand failed: err=%v created=%v", err, created)
	}
	fileBytes, err := os.ReadFile(initialTokenFile)
	if err != nil || strings.TrimSpace(string(fileBytes)) != rawToken1 {
		t.Fatalf("expected token file to contain %q, got %q (err=%v)", rawToken1, string(fileBytes), err)
	}

	// Case A: token output file already exists -> must fail WITHOUT changing password or revoking rawToken1
	if _, _, _, err := ExecuteCreateAdminCommand(ctx, store, "ops_admin", "new-password-456", initialTokenFile); err == nil {
		t.Fatal("expected ExecuteCreateAdminCommand to fail when token output file already exists")
	}
	if _, err := store.PlatformAdminByToken(ctx, TokenHash(rawToken1)); err != nil {
		t.Fatalf("expected previous admin token to remain valid after existing-file failure, got %v", err)
	}
	if _, err := store.AuthenticatePlatformAdmin(ctx, "ops_admin", "initial-pass-123", TokenHash(rawToken1), time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("expected previous admin password to remain valid after existing-file failure, got %v", err)
	}

	// Case B: token output directory does not exist / is unwritable -> must fail WITHOUT changing password or revoking rawToken1
	unwritablePath := tmpDir + "/nonexistent-subdir/admin.token"
	if _, _, _, err := ExecuteCreateAdminCommand(ctx, store, "ops_admin", "new-password-789", unwritablePath); err == nil {
		t.Fatal("expected ExecuteCreateAdminCommand to fail when token output directory does not exist")
	}
	if _, err := store.PlatformAdminByToken(ctx, TokenHash(rawToken1)); err != nil {
		t.Fatalf("expected previous admin token to remain valid after unwritable-path failure, got %v", err)
	}

	// Case C: DB UpsertPlatformAdmin fails -> newly created token file must be cleaned up and previous credentials remain valid
	store.failUpsert = true
	failedDbTokenFile := tmpDir + "/failed-db.token"
	if _, _, _, err := ExecuteCreateAdminCommand(ctx, store, "ops_admin", "new-password-000", failedDbTokenFile); err == nil {
		t.Fatal("expected ExecuteCreateAdminCommand to fail when UpsertPlatformAdmin fails")
	}
	if _, statErr := os.Stat(failedDbTokenFile); !os.IsNotExist(statErr) {
		t.Fatalf("expected failedDbTokenFile to be removed when DB transaction fails, statErr=%v", statErr)
	}
	store.failUpsert = false
	if _, err := store.PlatformAdminByToken(ctx, TokenHash(rawToken1)); err != nil {
		t.Fatalf("expected previous admin token to remain valid after DB failure, got %v", err)
	}
}
