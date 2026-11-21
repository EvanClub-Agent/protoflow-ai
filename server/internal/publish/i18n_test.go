package publish

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAcceptLanguageErrorLocalization(t *testing.T) {
	h := Handler(&memoryStore{}, Options{
		PublicOrigin:   "https://protoflow.example.com",
		AllowedOrigins: []string{"http://localhost:5173"},
	})

	// 1. Default (no Accept-Language) -> Chinese error message
	reqZh := httptest.NewRequest(http.MethodGet, "/api/v1/publications", nil)
	wZh := httptest.NewRecorder()
	h.ServeHTTP(wZh, reqZh)
	if wZh.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", wZh.Code)
	}
	if !strings.Contains(wZh.Body.String(), "请先登录账号后再发布") {
		t.Fatalf("expected Chinese auth error by default, got: %s", wZh.Body.String())
	}

	// 2. Accept-Language: en-US -> English error message
	reqEn := httptest.NewRequest(http.MethodGet, "/api/v1/publications", nil)
	reqEn.Header.Set("Accept-Language", "en-US,en;q=0.9")
	wEn := httptest.NewRecorder()
	h.ServeHTTP(wEn, reqEn)
	if wEn.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", wEn.Code)
	}
	if !strings.Contains(wEn.Body.String(), "Please sign in") {
		t.Fatalf("expected English auth error when Accept-Language is en-US, got: %s", wEn.Body.String())
	}

	// 3. Disallowed Origin with Accept-Language: en-US -> English CORS error
	reqCors := httptest.NewRequest(http.MethodGet, "/api/v1/view/nonexistent", nil)
	reqCors.Header.Set("Origin", "https://evil.example.com")
	reqCors.Header.Set("Accept-Language", "en")
	wCors := httptest.NewRecorder()
	h.ServeHTTP(wCors, reqCors)
	if wCors.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", wCors.Code)
	}
	if !strings.Contains(wCors.Body.String(), "Origin not allowed") && !strings.Contains(wCors.Body.String(), "not allowed") {
		t.Fatalf("expected English CORS error, got: %s", wCors.Body.String())
	}
}
