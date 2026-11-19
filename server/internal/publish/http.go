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
				fail(c, 403, "不允许的请求来源")
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Protoflow-Password, X-Protoflow-Password-Base64, MCP-Protocol-Version, Mcp-Session-Id")
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
			fail(c, 401, "请先登录账号后再发布")
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
			fail(c, 401, "发布登录已失效，请重新登录账号")
			return
		}
		if e != nil {
			fail(c, 503, "发布授权服务暂时不可用，请稍后重试")
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
			fail(c, 400, "缺少项目 ID")
			return
		}
		items, e := store.List(c.Request.Context(), c.GetString("publisher"), project)
		if e != nil {
			fail(c, 500, "读取发布记录失败")
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
				fail(c, 400, "发布记录不属于当前项目")
				return
			}
			if input.ExpectedVersion != p.Version || p.RevokedAt != nil {
				fail(c, 409, "发布记录已变化，请刷新后重试")
				return
			}
		}
		if input.Access.ExpiresAt != nil && !input.Access.ExpiresAt.After(time.Now()) {
			fail(c, 400, "过期时间必须晚于当前时间")
			return
		}
		switch input.Access.PasswordAction {
		case "keep":
			if input.Access.Password != "" {
				fail(c, 400, "保留密码时不能提交新密码")
				return
			}
		case "remove":
			if input.Access.Password != "" {
				fail(c, 400, "取消密码时不能提交新密码")
				return
			}
			p.PasswordHash = ""
		case "set":
			if len(input.Access.Password) < 6 || len(input.Access.Password) > 128 {
				fail(c, 400, "访问密码需为 6–128 个字节")
				return
			}
			p.PasswordHash, e = HashPassword(input.Access.Password)
			if e != nil {
				fail(c, 500, "设置密码失败")
				return
			}
		default:
			fail(c, 400, "访问密码设置无效")
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
			fail(c, 400, "缺少有效的发布版本")
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
			fail(c, 429, "访问过于频繁，请稍后再试")
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
			fail(c, 410, "此分享已撤回或过期，请联系发布者")
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
			fail(c, 400, "密码长度无效")
			return
		}
		p, ok := load(c)
		if !ok {
			return
		}
		if p.PasswordHash != "" && !CheckPassword(input.Password, p.PasswordHash) {
			fail(c, 401, "访问密码不正确")
			return
		}
		c.JSON(200, gin.H{"publication": p, "snapshot": p.Snapshot})
	})
	return r
}
func fail(c *gin.Context, status int, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": message})
}
func storeError(c *gin.Context, e error) {
	if errors.Is(e, ErrNotFound) {
		fail(c, 404, "分享不存在或无权访问")
	} else if errors.Is(e, ErrConflict) {
		fail(c, 409, "发布记录已变化，请刷新后重试")
	} else {
		fail(c, 500, "发布服务暂时不可用")
	}
}
func decode(c *gin.Context, out any) bool {
	if c.ContentType() != "application/json" {
		fail(c, 415, "请使用 JSON 请求")
		return false
	}
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		var limit *http.MaxBytesError
		if errors.As(e, &limit) {
			fail(c, 413, "发布内容超过 20 MB 限制")
		} else {
			fail(c, 400, "请求格式错误")
		}
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		fail(c, 400, "请求只能包含一个 JSON 对象")
		return false
	}
	return true
}
