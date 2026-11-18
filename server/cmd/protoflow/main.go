package main

import (
	"bufio"
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"protoflow/server/internal/publish"
	"protoflow/server/migrations"
	"strings"
	"syscall"
	"time"
)

func loadEnvFile(filePath string) error {
	cleanPath := strings.TrimSpace(filePath)
	if cleanPath == "" {
		return nil
	}
	f, err := os.Open(cleanPath)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		idx := strings.IndexByte(line, '=')
		if idx <= 0 {
			return fmt.Errorf("invalid env line %d in %s", lineNo, cleanPath)
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, val); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}

func setStdinEcho(enabled bool) {
	flag := "-echo"
	if enabled {
		flag = "echo"
	}
	cmd := exec.Command("stty", flag)
	cmd.Stdin = os.Stdin
	_ = cmd.Run()
}

func readAdminPasswordFromInput() (string, error) {
	if envPass := strings.TrimRight(os.Getenv("PROTOFLOW_ADMIN_PASSWORD"), "\r\n"); envPass != "" {
		return envPass, nil
	}
	isTTY := false
	if st, err := os.Stdin.Stat(); err == nil && (st.Mode()&os.ModeCharDevice) != 0 {
		isTTY = true
		_, _ = fmt.Fprint(os.Stderr, "Enter platform admin password (8-128 chars): ")
		setStdinEcho(false)
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
		defer func() {
			signal.Stop(sigCh)
			setStdinEcho(true)
			_, _ = fmt.Fprintln(os.Stderr)
		}()
		go func() {
			if _, ok := <-sigCh; ok {
				setStdinEcho(true)
				_, _ = fmt.Fprintln(os.Stderr)
				os.Exit(130)
			}
		}()
	}
	_ = isTTY
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func splitCSV(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if envFile := strings.TrimSpace(os.Getenv("PROTOFLOW_ENV_FILE")); envFile != "" {
		if e := loadEnvFile(envFile); e != nil {
			log.Fatalf("cannot load PROTOFLOW_ENV_FILE %s: %v", envFile, e)
		}
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	pool, e := pgxpool.New(ctx, dsn)
	if e != nil {
		log.Fatal("invalid database configuration")
	}
	defer pool.Close()
	ping, cancel := context.WithTimeout(ctx, 10*time.Second)
	e = pool.Ping(ping)
	cancel()
	if e != nil {
		log.Fatal("cannot connect to PostgreSQL; check database configuration")
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		log.Fatal("cannot begin migration")
	}
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(80241031)`); e == nil {
		_, e = tx.Exec(ctx, migrations.All)
	}
	if e != nil {
		_ = tx.Rollback(ctx)
		log.Fatal("database migration failed")
	}
	if e = tx.Commit(ctx); e != nil {
		log.Fatal("migration commit failed")
	}
	if len(os.Args) > 1 && os.Args[1] == "create-publisher" {
		if len(os.Args) != 4 {
			log.Fatal("usage: protoflow create-publisher NAME TOKEN_FILE")
		}
		token := "pfp_" + publish.NewID() + publish.NewID()
		file, e := os.OpenFile(os.Args[3], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			log.Fatal("token output file already exists or cannot be written")
		}
		if _, e = file.WriteString(token + "\n"); e != nil {
			file.Close()
			os.Remove(os.Args[3])
			log.Fatal("cannot write token")
		}
		file.Close()
		if _, e = pool.Exec(ctx, `INSERT INTO publishers(id,name,token_hash) VALUES($1,$2,$3)`, publish.NewID(), os.Args[2], publish.TokenHash(token)); e != nil {
			os.Remove(os.Args[3])
			log.Fatal("cannot create publisher")
		}
		fmt.Println("Publisher created; token saved to", os.Args[3])
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "create-admin" {
		if len(os.Args) < 3 || len(os.Args) > 4 {
			log.Fatal("usage: protoflow create-admin USERNAME [TOKEN_FILE] (password read from stdin or PROTOFLOW_ADMIN_PASSWORD)")
		}
		rawUsername := os.Args[2]
		tokenFile := ""
		if len(os.Args) == 4 {
			tokenFile = os.Args[3]
		}
		password, e := readAdminPasswordFromInput()
		if e != nil {
			log.Fatalf("cannot read admin password from stdin: %v", e)
		}
		admin, created, _, e := publish.ExecuteCreateAdminCommand(ctx, publish.Postgres{Pool: pool}, rawUsername, password, tokenFile)
		if e != nil {
			log.Fatalf("cannot initialize or update platform admin: %v", e)
		}
		action := "updated (password rotated and previous tokens revoked)"
		if created {
			action = "created"
		}
		if tokenFile != "" {
			fmt.Printf("Platform admin %s %s; session token saved to %s\n", admin.Username, action, tokenFile)
		} else {
			fmt.Printf("Platform admin %s %s.\n", admin.Username, action)
		}
		return
	}
	origin := strings.TrimRight(os.Getenv("PUBLIC_ORIGIN"), "/")
	u, e := url.Parse(origin)
	if e != nil || u.Host == "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || net.ParseIP(u.Hostname()).IsLoopback() || net.ParseIP(u.Hostname()).IsPrivate()))) || u.Path != "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		log.Fatal("PUBLIC_ORIGIN must be an HTTPS origin (HTTP allowed only for localhost/private IPs)")
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	releaseDir := strings.TrimSpace(os.Getenv("RELEASE_STORAGE_DIR"))
	if releaseDir == "" {
		if st, err := os.Stat("/data/protoflow-ai/shared"); err == nil && st.IsDir() {
			releaseDir = "/data/protoflow-ai/shared/releases"
		} else if st, err := os.Stat("/var/lib/protoflow"); err == nil && st.IsDir() {
			releaseDir = "/var/lib/protoflow/releases"
		} else {
			releaseDir = "./data/releases"
		}
	}
	if e = os.MkdirAll(releaseDir, 0750); e != nil {
		log.Fatalf("cannot create release storage directory %s: %v", releaseDir, e)
	}
	pgStore := publish.Postgres{Pool: pool}
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			cleanupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			if err := pgStore.PruneDiagnostics(cleanupCtx); err != nil && ctx.Err() == nil {
				log.Printf("diagnostic retention failed: %v", err)
			}
			cancel()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	legacyRules, e := publish.ParseLegacyAdminMapping(os.Getenv("RELEASE_LEGACY_ADMIN_MAP"))
	if e != nil {
		log.Fatalf("invalid RELEASE_LEGACY_ADMIN_MAP: %v", e)
	}
	if e = pgStore.ReconcileLegacyReleases(ctx, releaseDir, legacyRules); e != nil {
		log.Fatalf("cannot reconcile legacy desktop releases: %v", e)
	}
	signingKey, _, e := publish.LoadOrCreateSigningKey(releaseDir, nil)
	if e != nil {
		log.Fatalf("cannot initialize release signing key in %s: %v", releaseDir, e)
	}
	trustedProxiesRaw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if trustedProxiesRaw == "" {
		trustedProxiesRaw = "127.0.0.1,::1"
	}
	adminHTTPAllowedCIDRs, e := publish.ParseAdminHTTPAllowedCIDRs(os.Getenv("ADMIN_HTTP_ALLOWED_CIDRS"))
	if e != nil {
		log.Fatalf("invalid ADMIN_HTTP_ALLOWED_CIDRS: %v", e)
	}
	server := &http.Server{
		Addr: addr,
		Handler: publish.Handler(pgStore, publish.Options{
			PublicOrigin:          origin,
			AllowedOrigins:        splitCSV(os.Getenv("ALLOWED_ORIGINS")),
			ReleaseStorageDir:     releaseDir,
			ReleaseSigningKey:     signingKey,
			TrustedProxies:        splitCSV(trustedProxiesRaw),
			AdminHTTPAllowedCIDRs: adminHTTPAllowedCIDRs,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       300 * time.Second,
		WriteTimeout:      300 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		<-ctx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Printf("ProtoFlow publishing service listening on %s", addr)
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
