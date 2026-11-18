package publish

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseAdminHTTPAllowedCIDRs(t *testing.T) {
	for _, raw := range []string{"", "192.168.1.0/24", "10.20.0.0/16, 172.16.2.0/24", "fd12:3456::/64"} {
		if _, err := ParseAdminHTTPAllowedCIDRs(raw); err != nil {
			t.Errorf("valid private network %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"0.0.0.0/0", "::/0", "192.168.1.1/24", "192.168.0.0/15", "8.8.8.0/24", "localhost", "192.168.1.0/24,", "192.168.1.0/24,invalid"} {
		if _, err := ParseAdminHTTPAllowedCIDRs(raw); err == nil {
			t.Errorf("invalid or public network %q accepted", raw)
		}
	}
}

func TestLANAdminTransport(t *testing.T) {
	networks, err := ParseAdminHTTPAllowedCIDRs("192.168.1.0/24")
	if err != nil {
		t.Fatal(err)
	}
	options := Options{PublicOrigin: "http://192.168.1.104:8088", TrustedProxies: []string{"127.0.0.1"}, AdminHTTPAllowedCIDRs: networks}
	for _, tc := range []struct {
		name, peer, client, proto, host, origin, referer string
		allowed                                          bool
	}{
		{name: "direct LAN", peer: "192.168.1.55:1000", allowed: true},
		{name: "proxied LAN", peer: "127.0.0.1:1000", client: "192.168.1.55", proto: "http", origin: options.PublicOrigin, referer: options.PublicOrigin + "/releases/admin", allowed: true},
		{name: "mapped IPv4", peer: "127.0.0.1:1000", client: "::ffff:192.168.1.55", proto: "http", allowed: true},
		{name: "other private network", peer: "192.168.2.55:1000"},
		{name: "public client", peer: "8.8.8.8:1000"},
		{name: "forged direct headers", peer: "8.8.8.8:1000", client: "192.168.1.55", proto: "https"},
		{name: "proxy public client", peer: "127.0.0.1:1000", client: "8.8.8.8", proto: "http"},
		{name: "missing authoritative IP", peer: "127.0.0.1:1000", proto: "http"},
		{name: "multiple client IPs", peer: "127.0.0.1:1000", client: "192.168.1.55,8.8.8.8", proto: "http"},
		{name: "malformed client IP", peer: "127.0.0.1:1000", client: "not-an-ip", proto: "http"},
		{name: "missing forwarded scheme", peer: "127.0.0.1:1000", client: "192.168.1.55"},
		{name: "wrong host", peer: "192.168.1.55:1000", host: "attacker.example"},
		{name: "other HTTP origin", peer: "192.168.1.55:1000", origin: "http://192.168.1.99:8088"},
		{name: "other HTTP referer", peer: "192.168.1.55:1000", referer: "http://192.168.1.99:8088/releases/admin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", options.PublicOrigin+"/api/v1/admin/status", nil)
			r.RemoteAddr = tc.peer
			if tc.host != "" {
				r.Host = tc.host
			}
			r.Header.Set("X-Protoflow-Client-IP", tc.client)
			r.Header.Set("X-Forwarded-Proto", tc.proto)
			r.Header.Set("X-Forwarded-For", "192.168.1.55") // must not substitute for the authoritative IP
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Referer", tc.referer)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = r
			if got := isAllowedAdminRequest(c, options); got != tc.allowed {
				t.Fatalf("allowed = %v; want %v", got, tc.allowed)
			}
		})
	}
}

func TestLANAdminStillRequiresPlatformAdmin(t *testing.T) {
	networks, err := ParseAdminHTTPAllowedCIDRs("192.168.1.0/24")
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{items: map[string]Publication{}}
	passwordHash, err := HashPassword("test-lan-admin-password")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = store.UpsertPlatformAdmin(context.Background(), PlatformAdmin{ID: NewID(), Username: "lan-admin", DisplayName: "LAN admin", PasswordHash: passwordHash})
	if err != nil {
		t.Fatal(err)
	}
	h := Handler(store, Options{PublicOrigin: "http://192.168.1.104:8088", TrustedProxies: []string{"127.0.0.1"}, AdminHTTPAllowedCIDRs: networks, ReleaseStorageDir: t.TempDir()})
	request := func(method, path, token, body string, expected int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://192.168.1.104:8088"+path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:12345"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://192.168.1.104:8088")
		r.Header.Set("X-Forwarded-Proto", "http")
		r.Header.Set("X-Protoflow-Client-IP", "192.168.1.55")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != expected {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, expected, w.Body.String())
		}
		return w
	}
	request("GET", "/api/v1/admin/status", "", "", 200)
	request("GET", "/api/v1/releases", "", "", 401)
	request("GET", "/api/v1/releases", "owner-A", "", 403)
	request("POST", "/api/v1/admin/login", "", `{"username":"lan-admin","password":"incorrect"}`, 401)
	w := request("POST", "/api/v1/admin/login", "", `{"username":"lan-admin","password":"test-lan-admin-password"}`, 200)
	var auth struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &auth); err != nil || auth.Token == "" {
		t.Fatal("LAN login did not return an admin session")
	}
	request("GET", "/api/v1/admin/me", auth.Token, "", 200)
	request("POST", "/api/v1/releases", auth.Token, `{"version":"0.0.5","title":"LAN test","notes":"","channel":"stable","mandatory":false,"published":false}`, 200)
	request("GET", "/api/v1/releases", auth.Token, "", 200)
	request("POST", "/api/v1/admin/logout", auth.Token, "", 200)
	request("GET", "/api/v1/releases", auth.Token, "", 403)
}
