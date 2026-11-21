package publish

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

type Options struct {
	PublicOrigin          string
	AllowedOrigins        []string
	ReleaseStorageDir     string
	ReleaseSigningKey     ed25519.PrivateKey
	TrustedProxies        []string
	AdminHTTPAllowedCIDRs []netip.Prefix
}
type accessInput struct {
	PasswordAction string     `json:"passwordAction"`
	Password       string     `json:"password"`
	ExpiresAt      *time.Time `json:"expiresAt"`
}
type publishInput struct {
	Snapshot        json.RawMessage `json:"snapshot"`
	Access          accessInput     `json:"access"`
	ExpectedVersion int             `json:"expectedVersion"`
}
type rateEntry struct {
	Since time.Time
	Count int
}

func Handler(store Store, options Options) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	_ = r.SetTrustedProxies(nil)
	allowed := map[string]bool{}
	for _, o := range options.AllowedOrigins {
		allowed[o] = true
	}
	r.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "no-referrer")
		origin := c.GetHeader("Origin")
		if origin != "" && origin != options.PublicOrigin && !isSameLoopbackOrigin(origin, c.Request.Host) {
			if !allowed[origin] {
				fail(c, 403, msg(c, "不允许的请求来源", "Origin not allowed"))
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept-Language, X-Protoflow-Password, X-Protoflow-Password-Base64, MCP-Protocol-Version, Mcp-Session-Id")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		maxBody := int64(20 << 20)
		if c.Request.Method == "POST" && strings.HasPrefix(c.Request.URL.Path, "/api/v1/releases/") && strings.HasSuffix(c.Request.URL.Path, "/assets") {
			maxBody = 512 << 20
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)
		c.Next()
	})
	r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })
	api := r.Group("/api/v1")
	management := api.Group("")
	management.Use(func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") || len(header) > 256 {
			fail(c, 401, msg(c, "请先登录账号后再发布", "Please sign in before publishing"))
			return
		}
		token := strings.TrimPrefix(header, "Bearer ")
		var id, name string
		var e error
		if strings.HasPrefix(token, "pfu_") {
			var user ClientUser
			user, e = store.ClientUserByToken(c.Request.Context(), TokenHash(token))
			if e == nil {
				id, name, e = store.EnsureClientPublisher(c.Request.Context(), user.ID)
			}
		} else {
			// Older installed clients keep their existing publisher identity and links.
			id, name, e = store.Publisher(c.Request.Context(), TokenHash(token))
		}
		if errors.Is(e, ErrNotFound) || errors.Is(e, ErrInvalidAuth) || (e == nil && id == "") {
			fail(c, 401, msg(c, "发布登录已失效，请重新登录账号", "Publishing session expired. Please sign in again"))
			return
		}
		if e != nil {
			fail(c, 503, msg(c, "发布授权服务暂时不可用，请稍后重试", "Publishing authorization service is temporarily unavailable. Please try again later"))
			return
		}
		c.Set("publisher", id)
		c.Set("publisherName", name)
		c.Next()
	})
	decorate := func(p Publication) Publication { p.ShareURL = options.PublicOrigin + "/p/" + p.ID; return p }
	management.GET("/publisher", func(c *gin.Context) {
		c.JSON(200, gin.H{"name": c.GetString("publisherName"), "publisherId": c.GetString("publisher")})
	})
	management.GET("/publications", func(c *gin.Context) {
		project := c.Query("projectId")
		if strings.TrimSpace(project) == "" {
			fail(c, 400, msg(c, "缺少项目 ID", "Missing project ID"))
			return
		}
		items, e := store.List(c.Request.Context(), c.GetString("publisher"), project)
		if e != nil {
			fail(c, 500, msg(c, "读取发布记录失败", "Failed to load publications"))
			return
		}
		for i := range items {
			items[i] = decorate(items[i])
		}
		c.JSON(200, gin.H{"items": items})
	})
	save := func(c *gin.Context) {
		var input publishInput
		if !decode(c, &input) {
			return
		}
		snapshot, e := ValidateSnapshot(input.Snapshot)
		if e != nil {
			fail(c, 400, e.Error())
			return
		}
		p := Publication{ID: NewID(), PublisherID: c.GetString("publisher"), ProjectID: snapshot.ProjectID, Title: snapshot.Title}
		updating := c.Param("id") != ""
		if updating {
			p, e = store.Get(c.Request.Context(), c.Param("id"), p.PublisherID)
			if e != nil {
				storeError(c, e)
				return
			}
			if p.ProjectID != snapshot.ProjectID {
				fail(c, 400, msg(c, "发布记录不属于当前项目", "Publication does not belong to the current project"))
				return
			}
			if input.ExpectedVersion != p.Version || p.RevokedAt != nil {
				fail(c, 409, msg(c, "发布记录已变化，请刷新后重试", "Publication has changed. Please refresh and try again"))
				return
			}
		}
		if input.Access.ExpiresAt != nil && !input.Access.ExpiresAt.After(time.Now()) {
			fail(c, 400, msg(c, "过期时间必须晚于当前时间", "Expiration time must be in the future"))
			return
		}
		switch input.Access.PasswordAction {
		case "keep":
			if input.Access.Password != "" {
				fail(c, 400, msg(c, "保留密码时不能提交新密码", "Cannot submit a new password when keeping the existing password"))
				return
			}
		case "remove":
			if input.Access.Password != "" {
				fail(c, 400, msg(c, "取消密码时不能提交新密码", "Cannot submit a new password when removing password protection"))
				return
			}
			p.PasswordHash = ""
		case "set":
			if len(input.Access.Password) < 6 || len(input.Access.Password) > 128 {
				fail(c, 400, msg(c, "访问密码需为 6–128 个字节", "Access password must be 6–128 bytes"))
				return
			}
			p.PasswordHash, e = HashPassword(input.Access.Password)
			if e != nil {
				fail(c, 500, msg(c, "设置密码失败", "Failed to set access password"))
				return
			}
		default:
			fail(c, 400, msg(c, "访问密码设置无效", "Invalid access password action"))
			return
		}
		p.Title = snapshot.Title
		p.Snapshot = input.Snapshot
		p.ExpiresAt = input.Access.ExpiresAt
		if updating {
			p, e = store.Update(c.Request.Context(), p, input.ExpectedVersion)
		} else {
			p, e = store.Create(c.Request.Context(), p)
		}
		if e != nil {
			storeError(c, e)
			return
		}
		c.JSON(200, decorate(p))
	}
	management.POST("/publications", save)
	management.PUT("/publications/:id", save)
	management.POST("/publications/:id/revoke", func(c *gin.Context) {
		var input struct {
			ExpectedVersion int `json:"expectedVersion"`
		}
		if !decode(c, &input) {
			return
		}
		if input.ExpectedVersion < 1 {
			fail(c, 400, msg(c, "缺少有效的发布版本", "Missing valid expected publication version"))
			return
		}
		_, e := store.Get(c.Request.Context(), c.Param("id"), c.GetString("publisher"))
		if e != nil {
			storeError(c, e)
			return
		}
		p, e := store.Revoke(c.Request.Context(), c.Param("id"), c.GetString("publisher"), input.ExpectedVersion)
		if e != nil {
			storeError(c, e)
			return
		}
		c.JSON(200, decorate(p))
	})
	// Bounded per-connection-IP limiter. Nginx also limits the original remote IP
	// before proxying; untrusted forwarded headers never bypass this limiter.
	var mu sync.Mutex
	visits := map[string]rateEntry{}
	rateLimit := func(c *gin.Context) {
		mu.Lock()
		now := time.Now()
		key := c.ClientIP()
		v := visits[key]
		if now.Sub(v.Since) >= time.Minute {
			v = rateEntry{Since: now}
		}
		v.Count++
		visits[key] = v
		if len(visits) > 10000 {
			for k, x := range visits {
				if now.Sub(x.Since) >= time.Minute {
					delete(visits, k)
				}
			}
		}
		limited := v.Count > 120 || len(visits) > 20000
		mu.Unlock()
		if limited {
			c.Header("Retry-After", "60")
			fail(c, 429, msg(c, "访问过于频繁，请稍后再试", "Too many requests. Please try again later"))
			return
		}
		c.Next()
	}
	public := api.Group("/view")
	public.Use(rateLimit)
	registerReleaseAndAuthRoutes(api, rateLimit, store, options)
	registerDiagnosticRoutes(api, rateLimit, store, options)
	registerMcpRoutes(api, rateLimit, store, options)
	load := func(c *gin.Context) (Publication, bool) {
		p, e := store.Get(c.Request.Context(), c.Param("id"), "")
		if e != nil {
			storeError(c, e)
			return p, false
		}
		if p.RevokedAt != nil || p.ExpiresAt != nil && !p.ExpiresAt.After(time.Now()) {
			fail(c, 410, msg(c, "此分享已撤回或过期，请联系发布者", "This share link has been revoked or has expired. Please contact the publisher"))
			return p, false
		}
		return decorate(p), true
	}
	public.GET("/:id", func(c *gin.Context) {
		p, ok := load(c)
		if ok {
			c.JSON(200, p)
		}
	})
	public.POST("/:id/open", func(c *gin.Context) {
		var input struct {
			Password string `json:"password"`
		}
		if !decode(c, &input) {
			return
		}
		if len(input.Password) > 128 {
			fail(c, 400, msg(c, "密码长度无效", "Invalid password length"))
			return
		}
		p, ok := load(c)
		if !ok {
			return
		}
		if p.PasswordHash != "" && !CheckPassword(input.Password, p.PasswordHash) {
			fail(c, 401, msg(c, "访问密码不正确", "Incorrect access password"))
			return
		}
		c.JSON(200, gin.H{"publication": p, "snapshot": p.Snapshot})
	})
	return r
}
func fail(c *gin.Context, status int, message string) {
	if isEnRequest(c) {
		message = translateZhMessage(message)
	}
	c.AbortWithStatusJSON(status, gin.H{"error": message})
}
func storeError(c *gin.Context, e error) {
	if errors.Is(e, ErrNotFound) {
		fail(c, 404, msg(c, "分享不存在或无权访问", "Share not found or access denied"))
	} else if errors.Is(e, ErrConflict) {
		fail(c, 409, msg(c, "发布记录已变化，请刷新后重试", "Publication has changed. Please refresh and try again"))
	} else {
		fail(c, 500, msg(c, "发布服务暂时不可用", "Publishing service is temporarily unavailable"))
	}
}
func decode(c *gin.Context, out any) bool {
	if c.ContentType() != "application/json" {
		fail(c, 415, msg(c, "请使用 JSON 请求", "Content-Type must be application/json"))
		return false
	}
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		var limit *http.MaxBytesError
		if errors.As(e, &limit) {
			fail(c, 413, msg(c, "发布内容超过 20 MB 限制", "Request payload exceeds the 20 MB limit"))
		} else {
			fail(c, 400, msg(c, "请求格式错误", "Malformed JSON request"))
		}
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		fail(c, 400, msg(c, "请求只能包含一个 JSON 对象", "Request body must contain a single JSON object"))
		return false
	}
	return true
}
