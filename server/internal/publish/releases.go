package publish

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrDuplicateVersion  = errors.New("release version already exists")
	ErrDuplicateUsername = errors.New("username already exists")
	ErrInvalidAuth       = errors.New("invalid username or password")
	ErrAdminInitialized  = errors.New("platform admin already initialized")
)

type PlatformAdmin struct {
	ID             string     `json:"id"`
	Username       string     `json:"username"`
	DisplayName    string     `json:"displayName"`
	PasswordHash   string     `json:"-"`
	TokenHash      string     `json:"-"`
	TokenExpiresAt *time.Time `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type ClientUser struct {
	ID             string     `json:"id"`
	Username       string     `json:"username"`
	DisplayName    string     `json:"displayName"`
	PasswordHash   string     `json:"-"`
	TokenHash      string     `json:"-"`
	TokenExpiresAt *time.Time `json:"-"`
	PublisherID    string     `json:"publisherId,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type DesktopRelease struct {
	ID          string                `json:"id"`
	AdminID     string                `json:"adminId,omitempty"`
	PublisherID string                `json:"legacyPublisherId,omitempty"`
	Version     string                `json:"version"`
	Title       string                `json:"title"`
	Notes       string                `json:"notes"`
	Channel     string                `json:"channel"`
	Mandatory   bool                  `json:"mandatory"`
	Published   bool                  `json:"published"`
	PublishedAt time.Time             `json:"publishedAt"`
	CreatedAt   time.Time             `json:"createdAt"`
	UpdatedAt   time.Time             `json:"updatedAt"`
	Assets      []DesktopReleaseAsset `json:"assets"`
}

type DesktopReleaseAsset struct {
	ID                string     `json:"id"`
	ReleaseID         string     `json:"releaseId"`
	OS                string     `json:"os"`
	Arch              string     `json:"arch"`
	PackageType       string     `json:"packageType"`
	FileName          string     `json:"fileName"`
	SizeBytes         int64      `json:"sizeBytes"`
	SHA256            string     `json:"sha256"`
	StoragePath       string     `json:"-"`
	ExternalURL       string     `json:"externalUrl,omitempty"`
	Hosted            bool       `json:"hosted"`
	DownloadURL       string     `json:"downloadUrl"`
	Channel           string     `json:"channel,omitempty"`
	Mandatory         bool       `json:"mandatory"`
	Approved          bool       `json:"approved"`
	ApprovedByAdminID string     `json:"approvedByAdminId,omitempty"`
	ApprovedSHA256    string     `json:"-"`
	ApprovedAt        *time.Time `json:"approvedAt,omitempty"`
	Signature         string     `json:"signature"`
	SigningPublicKey  string     `json:"signingPublicKey"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type releaseInput struct {
	Version   string `json:"version"`
	Title     string `json:"title"`
	Notes     string `json:"notes"`
	Channel   string `json:"channel"`
	Mandatory bool   `json:"mandatory"`
	Published *bool  `json:"published"`
}

type assetLinkInput struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	PackageType string `json:"packageType"`
	FileName    string `json:"fileName"`
	ExternalURL string `json:"externalUrl"`
	SizeBytes   int64  `json:"sizeBytes"`
	SHA256      string `json:"sha256"`
}

type assetApproveInput struct {
	SHA256 string `json:"sha256"`
}

type authRegisterInput struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

type authLoginInput struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

var (
	semverPattern   = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)
	sha256Pattern   = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
	safeFilePattern = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,40}$`)
)

func ValidateCredentials(username, displayName, password string, requireDisplay bool) (string, string, error) {
	u := strings.ToLower(strings.TrimSpace(username))
	if !usernamePattern.MatchString(u) {
		return "", "", errors.New("账号名称需为 3–40 位字母、数字、下划线、点或连字符")
	}
	d := strings.TrimSpace(displayName)
	if d == "" {
		d = u
	}
	if requireDisplay && len(d) > 80 {
		return "", "", errors.New("显示名称不能超过 80 个字符")
	}
	if len(password) < 8 || len(password) > 128 {
		return "", "", errors.New("登录密码长度需为 8–128 个字节")
	}
	return u, d, nil
}

func AssetCanonicalManifest(version, channel string, mandatory bool, a DesktopReleaseAsset) []byte {
	ch := strings.ToLower(strings.TrimSpace(channel))
	if ch == "" {
		ch = strings.ToLower(strings.TrimSpace(a.Channel))
	}
	if ch == "" {
		ch = "stable"
	}
	return []byte(fmt.Sprintf("protoflow-release-v2\n%s\n%s\n%t\n%s\n%s\n%s\n%s\n%d\n%s",
		version, ch, mandatory, a.OS, a.Arch, a.PackageType, a.FileName, a.SizeBytes, strings.ToLower(strings.TrimSpace(a.SHA256))))
}

func decodeSigningKeyBytes(encoded string) (ed25519.PrivateKey, string, error) {
	trimmed := strings.TrimSpace(encoded)
	if trimmed == "" {
		return nil, "", errors.New("empty release signing key")
	}
	raw, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		raw, err = hex.DecodeString(trimmed)
	}
	if err != nil {
		return nil, "", fmt.Errorf("invalid release signing key encoding: %w", err)
	}
	switch len(raw) {
	case ed25519.SeedSize:
		priv := ed25519.NewKeyFromSeed(raw)
		pub := priv.Public().(ed25519.PublicKey)
		return priv, base64.StdEncoding.EncodeToString(pub), nil
	case ed25519.PrivateKeySize:
		priv := ed25519.PrivateKey(raw)
		pub := priv.Public().(ed25519.PublicKey)
		if !bytes.Equal(ed25519.NewKeyFromSeed(priv.Seed()), priv) {
			return nil, "", errors.New("corrupted ed25519 private key")
		}
		return priv, base64.StdEncoding.EncodeToString(pub), nil
	default:
		return nil, "", fmt.Errorf("unexpected release signing key length %d", len(raw))
	}
}

func LoadOrCreateSigningKey(storageDir string, explicitKey ed25519.PrivateKey) (ed25519.PrivateKey, string, error) {
	if len(explicitKey) > 0 {
		switch len(explicitKey) {
		case ed25519.SeedSize:
			priv := ed25519.NewKeyFromSeed(explicitKey)
			pub := priv.Public().(ed25519.PublicKey)
			return priv, base64.StdEncoding.EncodeToString(pub), nil
		case ed25519.PrivateKeySize:
			if !bytes.Equal(ed25519.NewKeyFromSeed(explicitKey.Seed()), explicitKey) {
				return nil, "", errors.New("invalid explicit ed25519 private key")
			}
			pub := explicitKey.Public().(ed25519.PublicKey)
			return explicitKey, base64.StdEncoding.EncodeToString(pub), nil
		default:
			return nil, "", fmt.Errorf("invalid explicit release signing key length %d", len(explicitKey))
		}
	}
	if envKey := strings.TrimSpace(os.Getenv("RELEASE_SIGNING_PRIVATE_KEY")); envKey != "" {
		return decodeSigningKeyBytes(envKey)
	}
	dir := strings.TrimSpace(storageDir)
	if dir == "" {
		return nil, "", errors.New("release storage directory is required to persist signing key")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, "", fmt.Errorf("cannot create release signing key directory %s: %w", dir, err)
	}
	keyFile := filepath.Join(dir, ".release-signing-key.ed25519")
	existing, readErr := os.ReadFile(keyFile)
	if readErr == nil {
		priv, pubB64, decErr := decodeSigningKeyBytes(string(existing))
		if decErr != nil {
			return nil, "", fmt.Errorf("existing release signing key %s is corrupted: %w", keyFile, decErr)
		}
		return priv, pubB64, nil
	}
	if !errors.Is(readErr, os.ErrNotExist) {
		return nil, "", fmt.Errorf("cannot read release signing key %s: %w", keyFile, readErr)
	}

	_, priv, genErr := ed25519.GenerateKey(rand.Reader)
	if genErr != nil {
		return nil, "", fmt.Errorf("cannot generate release signing key: %w", genErr)
	}
	encodedSeed := []byte(base64.StdEncoding.EncodeToString(priv.Seed()) + "\n")
	tmpFile, tmpErr := os.CreateTemp(dir, ".release-signing-key-*.tmp")
	if tmpErr != nil {
		return nil, "", fmt.Errorf("cannot create temporary signing key file in %s: %w", dir, tmpErr)
	}
	tmpPath := tmpFile.Name()
	cleanupTmp := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}
	if err := tmpFile.Chmod(0600); err != nil {
		cleanupTmp()
		return nil, "", fmt.Errorf("cannot chmod temporary signing key file: %w", err)
	}
	if n, err := tmpFile.Write(encodedSeed); err != nil || n != len(encodedSeed) {
		cleanupTmp()
		return nil, "", fmt.Errorf("cannot write temporary signing key file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		cleanupTmp()
		return nil, "", fmt.Errorf("cannot sync temporary signing key file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return nil, "", fmt.Errorf("cannot close temporary signing key file: %w", err)
	}

	if linkErr := os.Link(tmpPath, keyFile); linkErr != nil {
		_ = os.Remove(tmpPath)
		if errors.Is(linkErr, os.ErrExist) {
			persisted, err := os.ReadFile(keyFile)
			if err != nil {
				return nil, "", fmt.Errorf("cannot read concurrently created signing key %s: %w", keyFile, err)
			}
			return decodeSigningKeyBytes(string(persisted))
		}
		// Fallback for filesystems where hard links are not supported
		exclFile, exclErr := os.OpenFile(keyFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if exclErr != nil {
			if errors.Is(exclErr, os.ErrExist) {
				persisted, err := os.ReadFile(keyFile)
				if err != nil {
					return nil, "", fmt.Errorf("cannot read concurrently created signing key %s: %w", keyFile, err)
				}
				return decodeSigningKeyBytes(string(persisted))
			}
			return nil, "", fmt.Errorf("cannot persist release signing key %s: %w", keyFile, exclErr)
		}
		if _, err := exclFile.Write(encodedSeed); err != nil {
			_ = exclFile.Close()
			_ = os.Remove(keyFile)
			return nil, "", fmt.Errorf("cannot write release signing key %s: %w", keyFile, err)
		}
		if err := exclFile.Sync(); err != nil {
			_ = exclFile.Close()
			_ = os.Remove(keyFile)
			return nil, "", fmt.Errorf("cannot sync release signing key %s: %w", keyFile, err)
		}
		if err := exclFile.Close(); err != nil {
			_ = os.Remove(keyFile)
			return nil, "", fmt.Errorf("cannot close release signing key %s: %w", keyFile, err)
		}
	} else {
		_ = os.Remove(tmpPath)
	}

	persisted, verifyErr := os.ReadFile(keyFile)
	if verifyErr != nil {
		return nil, "", fmt.Errorf("cannot verify persisted signing key %s: %w", keyFile, verifyErr)
	}
	return decodeSigningKeyBytes(string(persisted))
}

func NormalizeSemver(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	v = strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
	if !semverPattern.MatchString(v) || len(v) > 64 {
		return "", errors.New("版本号格式无效，请使用标准语义化版本（如 0.2.0 或 1.0.0-beta.1）")
	}
	return v, nil
}

func CompareSemver(a, b string) int {
	na, errA := NormalizeSemver(a)
	nb, errB := NormalizeSemver(b)
	if errA != nil || errB != nil {
		return strings.Compare(a, b)
	}
	ma := semverPattern.FindStringSubmatch(na)
	mb := semverPattern.FindStringSubmatch(nb)
	for i := 1; i <= 3; i++ {
		va, _ := strconv.Atoi(ma[i])
		vb, _ := strconv.Atoi(mb[i])
		if va != vb {
			if va > vb {
				return 1
			}
			return -1
		}
	}
	preA, preB := ma[4], mb[4]
	if preA == preB {
		return 0
	}
	if preA == "" {
		return 1
	}
	if preB == "" {
		return -1
	}
	partsA := strings.Split(preA, ".")
	partsB := strings.Split(preB, ".")
	for i := 0; i < len(partsA) && i < len(partsB); i++ {
		if partsA[i] == partsB[i] {
			continue
		}
		ia, errIA := strconv.Atoi(partsA[i])
		ib, errIB := strconv.Atoi(partsB[i])
		if errIA == nil && errIB == nil {
			if ia > ib {
				return 1
			}
			return -1
		}
		if errIA == nil {
			return -1
		}
		if errIB == nil {
			return 1
		}
		if partsA[i] > partsB[i] {
			return 1
		}
		return -1
	}
	if len(partsA) > len(partsB) {
		return 1
	}
	return -1
}

func NormalizeOS(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "windows", "win32", "win":
		return "windows", nil
	case "macos", "darwin", "mac", "osx":
		return "macos", nil
	case "linux":
		return "linux", nil
	default:
		return "", errors.New("不支持的操作系统类型，仅支持 windows、macos、linux")
	}
}

func NormalizeArch(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "x64", "amd64", "x86_64":
		return "x64", nil
	case "arm64", "aarch64":
		return "arm64", nil
	case "universal", "all":
		return "universal", nil
	default:
		return "", errors.New("不支持的架构类型，仅支持 x64、arm64、universal")
	}
}

func NormalizePackageType(targetOS, raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	lower := strings.ToLower(trimmed)
	var pkg string
	switch lower {
	case "exe", "nsis":
		pkg = "exe"
	case "dmg":
		pkg = "dmg"
	case "zip":
		pkg = "zip"
	case "deb":
		pkg = "deb"
	case "appimage":
		pkg = "AppImage"
	case "tar.gz", "tgz":
		pkg = "tar.gz"
	default:
		return "", errors.New("不支持的安装包格式，仅支持 exe、dmg、zip、deb、AppImage、tar.gz")
	}
	switch targetOS {
	case "windows":
		if pkg != "exe" && pkg != "zip" {
			return "", errors.New("Windows 平台仅支持 exe 或 zip 安装包")
		}
	case "macos":
		if pkg != "dmg" && pkg != "zip" {
			return "", errors.New("macOS 平台仅支持 dmg 或 zip 安装包")
		}
	case "linux":
		if pkg != "deb" && pkg != "AppImage" && pkg != "tar.gz" {
			return "", errors.New("Linux 平台仅支持 deb、AppImage 或 tar.gz 安装包")
		}
	}
	return pkg, nil
}

func SanitizeFileName(raw string) (string, error) {
	base := filepath.Base(strings.TrimSpace(raw))
	clean := safeFilePattern.ReplaceAllString(base, "-")
	clean = strings.Trim(clean, ".-")
	if clean == "" || len(clean) > 180 {
		return "", errors.New("安装包文件名无效")
	}
	return clean, nil
}

func validateReleaseInput(in releaseInput) (DesktopRelease, error) {
	ver, err := NormalizeSemver(in.Version)
	if err != nil {
		return DesktopRelease{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" || len(title) > 200 {
		return DesktopRelease{}, errors.New("版本标题不能为空且不能超过 200 个字符")
	}
	notes := strings.TrimSpace(in.Notes)
	if len(notes) > 20000 {
		return DesktopRelease{}, errors.New("更新日志不能超过 20000 个字符")
	}
	channel := strings.TrimSpace(in.Channel)
	if channel == "" {
		channel = "stable"
	}
	if channel != "stable" && channel != "beta" {
		return DesktopRelease{}, errors.New("发布通道仅支持 stable 或 beta")
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	return DesktopRelease{
		Version:   ver,
		Title:     title,
		Notes:     notes,
		Channel:   channel,
		Mandatory: in.Mandatory,
		Published: published,
	}, nil
}

func SortReleases(items []DesktopRelease) {
	sort.SliceStable(items, func(i, j int) bool {
		cmp := CompareSemver(items[i].Version, items[j].Version)
		if cmp != 0 {
			return cmp > 0
		}
		return items[i].PublishedAt.After(items[j].PublishedAt)
	})
	for idx := range items {
		if items[idx].Assets == nil {
			items[idx].Assets = []DesktopReleaseAsset{}
		}
		sort.SliceStable(items[idx].Assets, func(a, b int) bool {
			if items[idx].Assets[a].OS != items[idx].Assets[b].OS {
				return items[idx].Assets[a].OS < items[idx].Assets[b].OS
			}
			if items[idx].Assets[a].Arch != items[idx].Assets[b].Arch {
				return items[idx].Assets[a].Arch < items[idx].Assets[b].Arch
			}
			return items[idx].Assets[a].PackageType < items[idx].Assets[b].PackageType
		})
	}
}

func SelectRecommendedAsset(assets []DesktopReleaseAsset, targetOS, targetArch, preferPackage string) (*DesktopReleaseAsset, []DesktopReleaseAsset) {
	var platformAssets []DesktopReleaseAsset
	for _, a := range assets {
		if a.OS == targetOS {
			platformAssets = append(platformAssets, a)
		}
	}
	if len(platformAssets) == 0 {
		return nil, []DesktopReleaseAsset{}
	}
	scoreAsset := func(a DesktopReleaseAsset) int {
		score := 0
		if a.Arch == targetArch {
			score += 100
		} else if a.Arch == "universal" && targetOS == "macos" {
			score += 80
		} else if targetArch == "arm64" && a.Arch == "x64" && (targetOS == "windows" || targetOS == "macos") {
			score += 40
		} else {
			return -1
		}
		if preferPackage != "" && strings.EqualFold(a.PackageType, preferPackage) {
			score += 50
		}
		switch targetOS {
		case "windows":
			if a.PackageType == "exe" {
				score += 20
			} else if a.PackageType == "zip" {
				score += 10
			}
		case "macos":
			if a.PackageType == "dmg" {
				score += 20
			} else if a.PackageType == "zip" {
				score += 10
			}
		case "linux":
			if a.PackageType == "deb" {
				score += 20
			} else if a.PackageType == "AppImage" {
				score += 18
			} else if a.PackageType == "tar.gz" {
				score += 10
			}
		}
		return score
	}
	var compatible []DesktopReleaseAsset
	for _, a := range platformAssets {
		if scoreAsset(a) >= 0 {
			compatible = append(compatible, a)
		}
	}
	sort.SliceStable(compatible, func(i, j int) bool {
		return scoreAsset(compatible[i]) > scoreAsset(compatible[j])
	})
	if len(compatible) == 0 {
		return nil, []DesktopReleaseAsset{}
	}
	best := compatible[0]
	return &best, compatible
}

const adminColumns = `id, username, display_name, password_hash, token_hash, token_expires_at, created_at, updated_at`
const clientUserColumns = `id, username, display_name, password_hash, token_hash, token_expires_at, COALESCE(publisher_id, ''), created_at, updated_at`
const releaseColumns = `id, COALESCE(admin_id, ''), COALESCE(publisher_id, ''), version, title, notes, channel, mandatory, published, published_at, created_at, updated_at`
const assetColumns = `id, release_id, os, arch, package_type, file_name, size_bytes, sha256, storage_path, external_url, COALESCE(approved_by_admin_id, ''), COALESCE(approved_sha256, ''), approved_at, created_at, updated_at`

func scanAdmin(row pgx.Row) (PlatformAdmin, error) {
	var a PlatformAdmin
	err := row.Scan(&a.ID, &a.Username, &a.DisplayName, &a.PasswordHash, &a.TokenHash, &a.TokenExpiresAt, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	return a, err
}

func scanClientUser(row pgx.Row) (ClientUser, error) {
	var u ClientUser
	err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.TokenHash, &u.TokenExpiresAt, &u.PublisherID, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func scanRelease(row pgx.Row) (DesktopRelease, error) {
	var r DesktopRelease
	err := row.Scan(&r.ID, &r.AdminID, &r.PublisherID, &r.Version, &r.Title, &r.Notes, &r.Channel, &r.Mandatory, &r.Published, &r.PublishedAt, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	r.Assets = []DesktopReleaseAsset{}
	return r, err
}

func scanAsset(row pgx.Row) (DesktopReleaseAsset, error) {
	var a DesktopReleaseAsset
	err := row.Scan(&a.ID, &a.ReleaseID, &a.OS, &a.Arch, &a.PackageType, &a.FileName, &a.SizeBytes, &a.SHA256, &a.StoragePath, &a.ExternalURL, &a.ApprovedByAdminID, &a.ApprovedSHA256, &a.ApprovedAt, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	a.Hosted = a.StoragePath != ""
	a.Approved = IsAssetApproved(a)
	return a, err
}

func (s Postgres) HasPlatformAdmin(ctx context.Context) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM platform_admins)`).Scan(&exists)
	return exists, err
}

func (s Postgres) CreatePlatformAdmin(ctx context.Context, admin PlatformAdmin) (PlatformAdmin, error) {
	created, err := scanAdmin(s.Pool.QueryRow(ctx,
		`INSERT INTO platform_admins(id, username, display_name, password_hash, token_hash, token_expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING `+adminColumns,
		admin.ID, admin.Username, admin.DisplayName, admin.PasswordHash, admin.TokenHash, admin.TokenExpiresAt,
	))
	if err != nil && strings.Contains(err.Error(), "duplicate key") {
		return created, ErrDuplicateUsername
	}
	return created, err
}

func (s Postgres) UpsertPlatformAdmin(ctx context.Context, admin PlatformAdmin) (PlatformAdmin, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return PlatformAdmin{}, false, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(80241032)`); err != nil {
		return PlatformAdmin{}, false, err
	}
	u := strings.ToLower(strings.TrimSpace(admin.Username))
	disp := strings.TrimSpace(admin.DisplayName)
	if disp == "" {
		disp = u
	}
	existing, err := scanAdmin(tx.QueryRow(ctx, `SELECT `+adminColumns+` FROM platform_admins WHERE username=$1`, u))
	if err == nil {
		updated, upErr := scanAdmin(tx.QueryRow(ctx,
			`UPDATE platform_admins SET display_name=$1, password_hash=$2, token_hash=$3, token_expires_at=$4, updated_at=now() WHERE id=$5 RETURNING `+adminColumns,
			disp, admin.PasswordHash, admin.TokenHash, admin.TokenExpiresAt, existing.ID,
		))
		if upErr != nil {
			return PlatformAdmin{}, false, upErr
		}
		if err := tx.Commit(ctx); err != nil {
			return PlatformAdmin{}, false, err
		}
		return updated, false, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return PlatformAdmin{}, false, err
	}
	created, crErr := scanAdmin(tx.QueryRow(ctx,
		`INSERT INTO platform_admins(id, username, display_name, password_hash, token_hash, token_expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING `+adminColumns,
		admin.ID, u, disp, admin.PasswordHash, admin.TokenHash, admin.TokenExpiresAt,
	))
	if crErr != nil {
		return PlatformAdmin{}, false, crErr
	}
	if err := tx.Commit(ctx); err != nil {
		return PlatformAdmin{}, false, err
	}
	return created, true, nil
}

func ExecuteCreateAdminCommand(ctx context.Context, store Store, rawUsername, password, tokenFile string) (PlatformAdmin, bool, string, error) {
	username, displayName, err := ValidateCredentials(rawUsername, rawUsername, password, true)
	if err != nil {
		return PlatformAdmin{}, false, "", err
	}
	pwHash, err := HashPassword(password)
	if err != nil {
		return PlatformAdmin{}, false, "", err
	}
	rawToken := "pfa_" + NewID() + NewID()
	exp := time.Now().Add(30 * 24 * time.Hour)

	cleanTokenPath := strings.TrimSpace(tokenFile)
	if cleanTokenPath != "" {
		f, openErr := os.OpenFile(cleanTokenPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if openErr != nil {
			return PlatformAdmin{}, false, "", fmt.Errorf("cannot create token output file %s: %w", cleanTokenPath, openErr)
		}
		payload := []byte(rawToken + "\n")
		n, writeErr := f.Write(payload)
		if writeErr == nil && n != len(payload) {
			writeErr = io.ErrShortWrite
		}
		syncErr := f.Sync()
		closeErr := f.Close()
		if writeErr != nil || syncErr != nil || closeErr != nil {
			_ = os.Remove(cleanTokenPath)
			if writeErr != nil {
				return PlatformAdmin{}, false, "", fmt.Errorf("cannot write token output file %s: %w", cleanTokenPath, writeErr)
			}
			if syncErr != nil {
				return PlatformAdmin{}, false, "", fmt.Errorf("cannot sync token output file %s: %w", cleanTokenPath, syncErr)
			}
			return PlatformAdmin{}, false, "", fmt.Errorf("cannot close token output file %s: %w", cleanTokenPath, closeErr)
		}
	}

	admin, created, err := store.UpsertPlatformAdmin(ctx, PlatformAdmin{
		ID:             NewID(),
		Username:       username,
		DisplayName:    displayName,
		PasswordHash:   pwHash,
		TokenHash:      TokenHash(rawToken),
		TokenExpiresAt: &exp,
	})
	if err != nil {
		if cleanTokenPath != "" {
			_ = os.Remove(cleanTokenPath)
		}
		return PlatformAdmin{}, false, "", err
	}
	return admin, created, rawToken, nil
}

type LegacyAdminMapRule struct {
	PublisherID string
	AdminRef    string
}

func ParseLegacyAdminMapping(raw string) ([]LegacyAdminMapRule, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	segments := strings.Split(trimmed, ",")
	seen := make(map[string]string, len(segments))
	var specific []LegacyAdminMapRule
	var wildcard *LegacyAdminMapRule

	for _, seg := range segments {
		entry := strings.TrimSpace(seg)
		if entry == "" {
			return nil, fmt.Errorf("invalid empty entry in RELEASE_LEGACY_ADMIN_MAP %q", raw)
		}
		if strings.Count(entry, "=") != 1 {
			return nil, fmt.Errorf("invalid entry %q in RELEASE_LEGACY_ADMIN_MAP: expected publisher_id=admin or *=admin", entry)
		}
		parts := strings.SplitN(entry, "=", 2)
		pubKey := strings.TrimSpace(parts[0])
		adminRef := strings.TrimSpace(parts[1])
		if pubKey == "" || adminRef == "" {
			return nil, fmt.Errorf("invalid entry %q in RELEASE_LEGACY_ADMIN_MAP: publisher key and admin target must be non-empty", entry)
		}
		if strings.ContainsAny(pubKey, " \t\r\n") || strings.ContainsAny(adminRef, " \t\r\n") || !usernamePattern.MatchString(adminRef) {
			return nil, fmt.Errorf("invalid entry %q in RELEASE_LEGACY_ADMIN_MAP: invalid characters in key or admin target", entry)
		}
		if prev, exists := seen[pubKey]; exists {
			if prev != adminRef {
				return nil, fmt.Errorf("conflicting duplicate publisher key %q in RELEASE_LEGACY_ADMIN_MAP (%q vs %q)", pubKey, prev, adminRef)
			}
			continue
		}
		seen[pubKey] = adminRef
		if pubKey == "*" {
			w := LegacyAdminMapRule{PublisherID: "*", AdminRef: adminRef}
			wildcard = &w
		} else {
			specific = append(specific, LegacyAdminMapRule{PublisherID: pubKey, AdminRef: adminRef})
		}
	}

	sort.SliceStable(specific, func(i, j int) bool {
		return specific[i].PublisherID < specific[j].PublisherID
	})
	if wildcard != nil {
		specific = append(specific, *wildcard)
	}
	return specific, nil
}

func normalizeLegacyAdminRules(rules []LegacyAdminMapRule) ([]LegacyAdminMapRule, error) {
	if len(rules) == 0 {
		return nil, nil
	}
	seen := make(map[string]string, len(rules))
	var specific []LegacyAdminMapRule
	var wildcard *LegacyAdminMapRule
	for _, r := range rules {
		pubKey := strings.TrimSpace(r.PublisherID)
		adminRef := strings.TrimSpace(r.AdminRef)
		if pubKey == "" || adminRef == "" || strings.ContainsAny(pubKey, " \t\r\n=,") || strings.ContainsAny(adminRef, " \t\r\n=,") {
			return nil, fmt.Errorf("invalid legacy admin mapping rule %q=%q", r.PublisherID, r.AdminRef)
		}
		if prev, exists := seen[pubKey]; exists {
			if prev != adminRef {
				return nil, fmt.Errorf("conflicting duplicate publisher key %q in legacy admin mapping", pubKey)
			}
			continue
		}
		seen[pubKey] = adminRef
		if pubKey == "*" {
			w := LegacyAdminMapRule{PublisherID: "*", AdminRef: adminRef}
			wildcard = &w
		} else {
			specific = append(specific, LegacyAdminMapRule{PublisherID: pubKey, AdminRef: adminRef})
		}
	}
	sort.SliceStable(specific, func(i, j int) bool {
		return specific[i].PublisherID < specific[j].PublisherID
	})
	if wildcard != nil {
		specific = append(specific, *wildcard)
	}
	return specific, nil
}

func (s Postgres) ReconcileLegacyReleases(ctx context.Context, storageDir string, rules []LegacyAdminMapRule) error {
	orderedRules, err := normalizeLegacyAdminRules(rules)
	if err != nil {
		return err
	}

	if len(orderedRules) > 0 {
		tx, txErr := s.Pool.Begin(ctx)
		if txErr != nil {
			return txErr
		}
		defer func() {
			_ = tx.Rollback(ctx)
		}()
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(80241033)`); err != nil {
			return err
		}

		type resolvedRule struct {
			publisherID string
			adminID     string
		}
		resolved := make([]resolvedRule, 0, len(orderedRules))
		specificPubs := make([]string, 0, len(orderedRules))

		for _, rule := range orderedRules {
			var adminID string
			err := tx.QueryRow(ctx, `SELECT id FROM platform_admins WHERE id=$1 OR username=$2 LIMIT 1`, rule.AdminRef, strings.ToLower(rule.AdminRef)).Scan(&adminID)
			if err != nil {
				return fmt.Errorf("legacy release admin mapping target %q not found: %w", rule.AdminRef, err)
			}
			resolved = append(resolved, resolvedRule{publisherID: rule.PublisherID, adminID: adminID})
			if rule.PublisherID != "*" {
				specificPubs = append(specificPubs, rule.PublisherID)
			}
		}

		// 1. Execute all specific publisher mappings first
		for _, item := range resolved {
			if item.publisherID == "*" {
				continue
			}
			if _, err := tx.Exec(ctx,
				`UPDATE desktop_releases SET admin_id=$1, updated_at=now() WHERE publisher_id=$2 AND (admin_id IS NULL OR admin_id='' OR admin_id <> $1)`,
				item.adminID, item.publisherID,
			); err != nil {
				return err
			}
		}

		// 2. Execute explicit wildcard '*' last, excluding any specifically mapped publisher_id
		for _, item := range resolved {
			if item.publisherID != "*" {
				continue
			}
			if _, err := tx.Exec(ctx,
				`UPDATE desktop_releases SET admin_id=$1, updated_at=now() WHERE (admin_id IS NULL OR admin_id='') AND COALESCE(publisher_id, '') <> ALL($2)`,
				item.adminID, specificPubs,
			); err != nil {
				return err
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}

	dir := strings.TrimSpace(storageDir)
	if dir == "" {
		return nil
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, storage_path, size_bytes, sha256 FROM desktop_release_assets WHERE storage_path <> ''`)
	if err != nil {
		return err
	}
	type legacyAssetRow struct {
		id          string
		storagePath string
		sizeBytes   int64
		sha256      string
	}
	var toCheck []legacyAssetRow
	for rows.Next() {
		var r legacyAssetRow
		if err := rows.Scan(&r.id, &r.storagePath, &r.sizeBytes, &r.sha256); err != nil {
			rows.Close()
			return err
		}
		toCheck = append(toCheck, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, item := range toCheck {
		fullPath := filepath.Join(dir, filepath.Base(item.storagePath))
		f, err := os.Open(fullPath)
		if err != nil {
			continue
		}
		h := sha256.New()
		n, copyErr := io.Copy(h, f)
		_ = f.Close()
		if copyErr != nil || n <= 0 {
			continue
		}
		digest := hex.EncodeToString(h.Sum(nil))
		if item.sizeBytes <= 0 || !sha256Pattern.MatchString(strings.TrimSpace(item.sha256)) {
			// Backfill digest only; never mark as approved automatically
			if _, err := s.Pool.Exec(ctx,
				`UPDATE desktop_release_assets SET size_bytes=$1, sha256=$2, approved_by_admin_id=NULL, approved_sha256='', approved_at=NULL, updated_at=now() WHERE id=$3`,
				n, digest, item.id,
			); err != nil {
				return err
			}
		} else if item.sizeBytes != n || !strings.EqualFold(strings.TrimSpace(item.sha256), digest) {
			// Hosted file changed on disk: update digest and invalidate prior approval
			if _, err := s.Pool.Exec(ctx,
				`UPDATE desktop_release_assets SET size_bytes=$1, sha256=$2, approved_by_admin_id=NULL, approved_sha256='', approved_at=NULL, updated_at=now() WHERE id=$3`,
				n, digest, item.id,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s Postgres) AuthenticatePlatformAdmin(ctx context.Context, username, password, newTokenHash string, expiresAt time.Time) (PlatformAdmin, error) {
	admin, err := scanAdmin(s.Pool.QueryRow(ctx, `SELECT `+adminColumns+` FROM platform_admins WHERE username=$1`, strings.ToLower(strings.TrimSpace(username))))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return admin, ErrInvalidAuth
		}
		return admin, err
	}
	if !CheckPassword(password, admin.PasswordHash) {
		return PlatformAdmin{}, ErrInvalidAuth
	}
	return scanAdmin(s.Pool.QueryRow(ctx,
		`UPDATE platform_admins SET token_hash=$1, token_expires_at=$2, updated_at=now() WHERE id=$3 RETURNING `+adminColumns,
		newTokenHash, expiresAt, admin.ID,
	))
}

func (s Postgres) PlatformAdminByToken(ctx context.Context, tokenHash string) (PlatformAdmin, error) {
	if tokenHash == "" {
		return PlatformAdmin{}, ErrNotFound
	}
	return scanAdmin(s.Pool.QueryRow(ctx,
		`SELECT `+adminColumns+` FROM platform_admins WHERE token_hash=$1 AND (token_expires_at IS NULL OR token_expires_at > now())`,
		tokenHash,
	))
}

func (s Postgres) LogoutPlatformAdmin(ctx context.Context, adminID string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE platform_admins SET token_hash='', token_expires_at=NULL, updated_at=now() WHERE id=$1`, adminID)
	return err
}

func (s Postgres) CreateClientUser(ctx context.Context, user ClientUser) (ClientUser, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ClientUser{}, err
	}
	defer tx.Rollback(ctx)
	created, err := scanClientUser(tx.QueryRow(ctx,
		`INSERT INTO client_users(id, username, display_name, password_hash, token_hash, token_expires_at, publisher_id) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,'')) RETURNING `+clientUserColumns,
		user.ID, user.Username, user.DisplayName, user.PasswordHash, user.TokenHash, user.TokenExpiresAt, user.PublisherID))
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return created, ErrDuplicateUsername
		}
		return created, err
	}
	if user.TokenHash != "" {
		if _, err = tx.Exec(ctx, `INSERT INTO client_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`, user.TokenHash, user.ID, user.TokenExpiresAt); err != nil {
			return created, err
		}
	}
	return created, tx.Commit(ctx)
}
func (s Postgres) AuthenticateClientUser(ctx context.Context, username, password, newTokenHash string, expiresAt time.Time) (ClientUser, error) {
	user, err := scanClientUser(s.Pool.QueryRow(ctx, `SELECT `+clientUserColumns+` FROM client_users WHERE username=$1`, strings.ToLower(strings.TrimSpace(username))))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return user, ErrInvalidAuth
		}
		return user, err
	}
	if !CheckPassword(password, user.PasswordHash) {
		return ClientUser{}, ErrInvalidAuth
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return user, err
	}
	defer tx.Rollback(ctx)
	// Keep the latest legacy columns for a binary rollback, but authenticate only
	// through the session table. Logging into the website must not kick out Alex.
	if _, err = tx.Exec(ctx, `UPDATE client_users SET token_hash=$1,token_expires_at=$2,updated_at=now() WHERE id=$3`, newTokenHash, expiresAt, user.ID); err != nil {
		return user, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM client_sessions WHERE user_id=$1 AND expires_at<=now()`, user.ID); err != nil {
		return user, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO client_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`, newTokenHash, user.ID, expiresAt); err != nil {
		return user, err
	}
	return user, tx.Commit(ctx)
}
func (s Postgres) ClientUserByToken(ctx context.Context, tokenHash string) (ClientUser, error) {
	if tokenHash == "" {
		return ClientUser{}, ErrNotFound
	}
	return scanClientUser(s.Pool.QueryRow(ctx, `SELECT `+clientUserColumns+` FROM client_users WHERE id=(SELECT user_id FROM client_sessions WHERE token_hash=$1 AND (expires_at IS NULL OR expires_at>now()))`, tokenHash))
}
func (s Postgres) LogoutClientUser(ctx context.Context, userID, tokenHash string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM client_sessions WHERE user_id=$1 AND token_hash=$2`, userID, tokenHash); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE client_users SET token_hash='',token_expires_at=NULL,updated_at=now() WHERE id=$1 AND token_hash=$2`, userID, tokenHash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s Postgres) loadReleaseAssets(ctx context.Context, releases []DesktopRelease) ([]DesktopRelease, error) {
	if len(releases) == 0 {
		return releases, nil
	}
	ids := make([]string, len(releases))
	byID := make(map[string]int, len(releases))
	for i := range releases {
		ids[i] = releases[i].ID
		releases[i].Assets = []DesktopReleaseAsset{}
		byID[releases[i].ID] = i
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+assetColumns+` FROM desktop_release_assets WHERE release_id = ANY($1) ORDER BY created_at ASC`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		if idx, ok := byID[a.ReleaseID]; ok {
			releases[idx].Assets = append(releases[idx].Assets, a)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	SortReleases(releases)
	return releases, nil
}

func (s Postgres) ListReleases(ctx context.Context, publishedOnly bool) ([]DesktopRelease, error) {
	query := `SELECT ` + releaseColumns + ` FROM desktop_releases`
	if publishedOnly {
		query += ` WHERE published = true`
	}
	return s.queryReleases(ctx, query+` ORDER BY published_at DESC LIMIT 200`)
}

// Update discovery is not paginated: a compatible release can predate the release-center page.
func (s Postgres) ListUpdateCandidates(ctx context.Context, channel, targetOS string) ([]DesktopRelease, error) {
	return s.queryReleases(ctx, `SELECT `+releaseColumns+` FROM desktop_releases r
		WHERE published AND (channel=$1 OR $1='beta')
		  AND EXISTS (SELECT 1 FROM desktop_release_assets a WHERE a.release_id=r.id
		    AND ($2='' OR a.os=$2) AND a.approved_by_admin_id IS NOT NULL
		    AND lower(a.approved_sha256)=lower(a.sha256) AND a.size_bytes>0)`, channel, targetOS)
}

func (s Postgres) queryReleases(ctx context.Context, query string, args ...any) ([]DesktopRelease, error) {
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DesktopRelease{}
	for rows.Next() {
		r, err := scanRelease(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return s.loadReleaseAssets(ctx, out)
}

func (s Postgres) GetRelease(ctx context.Context, id string) (DesktopRelease, error) {
	r, err := scanRelease(s.Pool.QueryRow(ctx, `SELECT `+releaseColumns+` FROM desktop_releases WHERE id=$1`, id))
	if err != nil {
		return r, err
	}
	items, err := s.loadReleaseAssets(ctx, []DesktopRelease{r})
	if err != nil {
		return r, err
	}
	return items[0], nil
}

func (s Postgres) CreateRelease(ctx context.Context, r DesktopRelease) (DesktopRelease, error) {
	created, err := scanRelease(s.Pool.QueryRow(ctx,
		`INSERT INTO desktop_releases(id, admin_id, version, title, notes, channel, mandatory, published, published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING `+releaseColumns,
		r.ID, r.AdminID, r.Version, r.Title, r.Notes, r.Channel, r.Mandatory, r.Published,
	))
	if err != nil && strings.Contains(err.Error(), "duplicate key") {
		return created, ErrDuplicateVersion
	}
	return created, err
}

func (s Postgres) UpdateRelease(ctx context.Context, r DesktopRelease) (DesktopRelease, error) {
	updated, err := scanRelease(s.Pool.QueryRow(ctx,
		`UPDATE desktop_releases SET admin_id=COALESCE(NULLIF($1, ''), admin_id), version=$2, title=$3, notes=$4, channel=$5, mandatory=$6, published=$7, published_at=CASE WHEN published = false AND $7 = true THEN now() ELSE published_at END, updated_at=now() WHERE id=$8 RETURNING `+releaseColumns,
		r.AdminID, r.Version, r.Title, r.Notes, r.Channel, r.Mandatory, r.Published, r.ID,
	))
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return updated, ErrDuplicateVersion
		}
		return updated, err
	}
	items, err := s.loadReleaseAssets(ctx, []DesktopRelease{updated})
	if err != nil {
		return updated, err
	}
	return items[0], nil
}

func (s Postgres) DeleteRelease(ctx context.Context, id string) (DesktopRelease, error) {
	existing, err := s.GetRelease(ctx, id)
	if err != nil {
		return existing, err
	}
	tag, err := s.Pool.Exec(ctx, `DELETE FROM desktop_releases WHERE id=$1`, id)
	if err != nil {
		return existing, err
	}
	if tag.RowsAffected() == 0 {
		return existing, ErrNotFound
	}
	return existing, nil
}

func (s Postgres) UpsertReleaseAsset(ctx context.Context, a DesktopReleaseAsset) (DesktopReleaseAsset, string, error) {
	var oldStorage string
	_ = s.Pool.QueryRow(ctx, `SELECT storage_path FROM desktop_release_assets WHERE release_id=$1 AND os=$2 AND arch=$3 AND package_type=$4`,
		a.ReleaseID, a.OS, a.Arch, a.PackageType,
	).Scan(&oldStorage)
	cleanSHA := strings.ToLower(strings.TrimSpace(a.SHA256))
	approvedBy := strings.TrimSpace(a.ApprovedByAdminID)
	approvedSHA := strings.ToLower(strings.TrimSpace(a.ApprovedSHA256))
	if approvedBy == "" || approvedSHA == "" || !strings.EqualFold(approvedSHA, cleanSHA) || a.SizeBytes <= 0 || !sha256Pattern.MatchString(cleanSHA) {
		approvedBy = ""
		approvedSHA = ""
	}
	saved, err := scanAsset(s.Pool.QueryRow(ctx,
		`INSERT INTO desktop_release_assets(id, release_id, os, arch, package_type, file_name, size_bytes, sha256, storage_path, external_url, approved_by_admin_id, approved_sha256, approved_at, updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''),$12,CASE WHEN NULLIF($11,'') IS NOT NULL THEN now() ELSE NULL END,now())
		 ON CONFLICT (release_id, os, arch, package_type)
		 DO UPDATE SET file_name=EXCLUDED.file_name, size_bytes=EXCLUDED.size_bytes, sha256=EXCLUDED.sha256, storage_path=EXCLUDED.storage_path, external_url=EXCLUDED.external_url, approved_by_admin_id=EXCLUDED.approved_by_admin_id, approved_sha256=EXCLUDED.approved_sha256, approved_at=EXCLUDED.approved_at, updated_at=now()
		 RETURNING `+assetColumns,
		a.ID, a.ReleaseID, a.OS, a.Arch, a.PackageType, a.FileName, a.SizeBytes, cleanSHA, a.StoragePath, a.ExternalURL, approvedBy, approvedSHA,
	))
	if err != nil {
		return saved, "", err
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE desktop_releases SET updated_at=now() WHERE id=$1`, a.ReleaseID)
	return saved, oldStorage, nil
}

func (s Postgres) ApproveReleaseAsset(ctx context.Context, releaseID, assetID, adminID, expectedSHA256 string) (DesktopReleaseAsset, error) {
	cleanAdmin := strings.TrimSpace(adminID)
	cleanSHA := strings.ToLower(strings.TrimSpace(expectedSHA256))
	if cleanAdmin == "" || !sha256Pattern.MatchString(cleanSHA) {
		return DesktopReleaseAsset{}, ErrConflict
	}
	approved, err := scanAsset(s.Pool.QueryRow(ctx,
		`UPDATE desktop_release_assets
		 SET approved_by_admin_id=$1, approved_sha256=lower(sha256), approved_at=now(), updated_at=now()
		 WHERE id=$2 AND release_id=$3 AND size_bytes > 0 AND lower(sha256)=$4
		 RETURNING `+assetColumns,
		cleanAdmin, assetID, releaseID, cleanSHA,
	))
	if errors.Is(err, ErrNotFound) {
		var exists bool
		_ = s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM desktop_release_assets WHERE id=$1 AND release_id=$2)`, assetID, releaseID).Scan(&exists)
		if exists {
			return DesktopReleaseAsset{}, ErrConflict
		}
		return DesktopReleaseAsset{}, ErrNotFound
	}
	if err != nil {
		return DesktopReleaseAsset{}, err
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE desktop_releases SET updated_at=now() WHERE id=$1`, releaseID)
	return approved, nil
}

func (s Postgres) GetReleaseAsset(ctx context.Context, assetID string) (DesktopReleaseAsset, DesktopRelease, error) {
	asset, err := scanAsset(s.Pool.QueryRow(ctx, `SELECT `+assetColumns+` FROM desktop_release_assets WHERE id=$1`, assetID))
	if err != nil {
		return asset, DesktopRelease{}, err
	}
	rel, err := s.GetRelease(ctx, asset.ReleaseID)
	return asset, rel, err
}

func (s Postgres) DeleteReleaseAsset(ctx context.Context, releaseID, assetID string) (DesktopReleaseAsset, error) {
	deleted, err := scanAsset(s.Pool.QueryRow(ctx, `DELETE FROM desktop_release_assets WHERE id=$1 AND release_id=$2 RETURNING `+assetColumns, assetID, releaseID))
	if err != nil {
		return deleted, err
	}
	_, _ = s.Pool.Exec(ctx, `UPDATE desktop_releases SET updated_at=now() WHERE id=$1`, releaseID)
	return deleted, nil
}

func hostOnly(hostport string) string {
	h := strings.TrimSpace(hostport)
	if h == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(h); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(h, "[]")
}

func isLoopbackHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(hostOnly(host)))
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func isSameLoopbackOrigin(origin, reqHost string) bool {
	if origin == "" || reqHost == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return isLoopbackHost(u.Hostname()) && isLoopbackHost(reqHost)
}

func isTrustedAssetRecord(a DesktopReleaseAsset) bool {
	return a.SizeBytes > 0 && sha256Pattern.MatchString(strings.TrimSpace(a.SHA256))
}

func IsAssetApproved(a DesktopReleaseAsset) bool {
	if !isTrustedAssetRecord(a) {
		return false
	}
	if strings.TrimSpace(a.ApprovedByAdminID) == "" {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(a.ApprovedSHA256), strings.TrimSpace(a.SHA256))
}

func isAssetApprovedAndIntact(storageDir string, a DesktopReleaseAsset) bool {
	if !IsAssetApproved(a) {
		return false
	}
	if a.StoragePath != "" && strings.TrimSpace(storageDir) != "" {
		fullPath := filepath.Join(storageDir, filepath.Base(a.StoragePath))
		f, err := os.Open(fullPath)
		if err != nil {
			return false
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.Size() != a.SizeBytes {
			return false
		}
		h := sha256.New()
		if n, err := io.Copy(h, f); err != nil || n != a.SizeBytes {
			return false
		}
		actualDigest := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(actualDigest, strings.TrimSpace(a.ApprovedSHA256)) {
			return false
		}
	}
	return true
}

func parseRemoteIP(remoteAddr string) net.IP {
	raw := strings.TrimSpace(remoteAddr)
	if raw == "" {
		return nil
	}
	host := raw
	if h, _, err := net.SplitHostPort(raw); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	return net.ParseIP(host)
}

func isTrustedProxyPeer(peerIP net.IP, trustedProxies []string) bool {
	if peerIP == nil || len(trustedProxies) == 0 {
		return false
	}
	for _, entry := range trustedProxies {
		candidate := strings.TrimSpace(entry)
		if candidate == "" {
			continue
		}
		if strings.Contains(candidate, "/") {
			if _, cidr, err := net.ParseCIDR(candidate); err == nil && cidr.Contains(peerIP) {
				return true
			}
			continue
		}
		if ip := net.ParseIP(strings.Trim(candidate, "[]")); ip != nil {
			if ip.Equal(peerIP) {
				return true
			}
			continue
		}
		if resolved, err := net.LookupIP(candidate); err == nil {
			for _, ip := range resolved {
				if ip.Equal(peerIP) {
					return true
				}
			}
		}
	}
	return false
}

func isAllowedAdminRequest(c *gin.Context, options Options) bool {
	allowLAN := isAllowedLANAdminRequest(c, options)
	for _, hdr := range []string{"Origin", "Referer"} {
		raw := strings.TrimSpace(c.GetHeader(hdr))
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return false
		}
		if strings.EqualFold(u.Scheme, "https") {
			continue
		}
		if strings.EqualFold(u.Scheme, "http") && isLoopbackHost(u.Hostname()) {
			continue
		}
		if allowLAN && u.Scheme+"://"+u.Host == options.PublicOrigin {
			continue
		}
		return false
	}

	if allowLAN {
		return true
	}
	if c.Request.TLS != nil {
		return true
	}

	peerIP := parseRemoteIP(c.Request.RemoteAddr)
	if peerIP == nil {
		return false
	}

	if isTrustedProxyPeer(peerIP, options.TrustedProxies) {
		xfProto := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")))
		if xfProto == "https" {
			return true
		}

		adminChannel := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Protoflow-Admin-Channel")))
		clientIPHdr := strings.TrimSpace(c.GetHeader("X-Protoflow-Client-IP"))
		if adminChannel == "loopback" {
			if clientIPHdr != "" && !isLoopbackHost(strings.TrimSpace(strings.Split(clientIPHdr, ",")[0])) {
				return false
			}
			return isLoopbackHost(c.Request.Host)
		}

		hasForwardedClient := false
		for _, ipHdr := range []string{"X-Protoflow-Client-IP", "X-Real-IP", "X-Forwarded-For"} {
			val := strings.TrimSpace(c.GetHeader(ipHdr))
			if val == "" {
				continue
			}
			hasForwardedClient = true
			for _, part := range strings.Split(val, ",") {
				if !isLoopbackHost(strings.TrimSpace(part)) {
					return false
				}
			}
		}
		if hasForwardedClient {
			return isLoopbackHost(c.Request.Host)
		}
		return peerIP.IsLoopback() && isLoopbackHost(c.Request.Host)
	}

	// Untrusted peer: ignore X-Forwarded-Proto and X-Protoflow-Admin-Channel; require actual loopback peer + loopback Host
	if !peerIP.IsLoopback() {
		return false
	}
	for _, ipHdr := range []string{"X-Protoflow-Client-IP", "X-Real-IP", "X-Forwarded-For"} {
		val := strings.TrimSpace(c.GetHeader(ipHdr))
		if val == "" {
			continue
		}
		for _, part := range strings.Split(val, ",") {
			if !isLoopbackHost(strings.TrimSpace(part)) {
				return false
			}
		}
	}
	return isLoopbackHost(c.Request.Host)
}

func registerReleaseAndAuthRoutes(api *gin.RouterGroup, rateLimited func(*gin.Context), store Store, options Options) {
	storageDir := strings.TrimSpace(options.ReleaseStorageDir)
	if storageDir == "" {
		storageDir = filepath.Join(os.TempDir(), "protoflow-releases")
	}
	signingPriv, signingPubBase64, signingKeyErr := LoadOrCreateSigningKey(storageDir, options.ReleaseSigningKey)

	requireSigningKeyReady := func(c *gin.Context) {
		if signingKeyErr != nil || len(signingPriv) != ed25519.PrivateKeySize || signingPubBase64 == "" {
			fail(c, 500, msg(c, "版本签名密钥未就绪，请检查服务端 RELEASE_STORAGE_DIR 写权限与密钥配置", "Release signing key is not ready. Check server RELEASE_STORAGE_DIR write permissions and signing key configuration"))
			return
		}
		c.Next()
	}

	requireAdminChannel := func(c *gin.Context) {
		if !isAllowedAdminRequest(c, options) {
			fail(c, 403, msg(c, "当前网络未获准访问版本管理后台。请使用 HTTPS、本机回环地址，或联系管理员配置允许访问的局域网网段。", "Current network is not permitted to access release administration. Use HTTPS, loopback, or ask an administrator to configure allowed LAN CIDRs."))
			return
		}
		c.Next()
	}

	decorateAsset := func(rel DesktopRelease, a DesktopReleaseAsset) DesktopReleaseAsset {
		a.SHA256 = strings.ToLower(strings.TrimSpace(a.SHA256))
		a.Hosted = a.StoragePath != ""
		a.Channel = rel.Channel
		a.Mandatory = rel.Mandatory
		a.Approved = isAssetApprovedAndIntact(storageDir, a)
		if a.Hosted {
			a.DownloadURL = options.PublicOrigin + "/api/v1/updates/assets/" + a.ID + "/download"
		} else {
			a.DownloadURL = a.ExternalURL
		}
		if a.Approved && len(signingPriv) == ed25519.PrivateKeySize {
			sig := ed25519.Sign(signingPriv, AssetCanonicalManifest(rel.Version, rel.Channel, rel.Mandatory, a))
			a.Signature = base64.StdEncoding.EncodeToString(sig)
			a.SigningPublicKey = signingPubBase64
		} else {
			a.Signature = ""
			a.SigningPublicKey = ""
		}
		return a
	}

	decorateRelease := func(r DesktopRelease) DesktopRelease {
		if r.Assets == nil {
			r.Assets = []DesktopReleaseAsset{}
		}
		for i := range r.Assets {
			r.Assets[i] = decorateAsset(r, r.Assets[i])
		}
		return r
	}

	decoratePublicRelease := func(r DesktopRelease) DesktopRelease {
		trusted := make([]DesktopReleaseAsset, 0, len(r.Assets))
		for _, a := range r.Assets {
			decorated := decorateAsset(r, a)
			if decorated.Approved && decorated.Signature != "" {
				trusted = append(trusted, decorated)
			}
		}
		r.Assets = trusted
		return r
	}

	removeStoredFile := func(relPath string) {
		if relPath == "" {
			return
		}
		clean := filepath.Base(relPath)
		if clean == "." || clean == "/" || clean == "" {
			return
		}
		_ = os.Remove(filepath.Join(storageDir, clean))
	}

	extractBearer := func(c *gin.Context) (string, bool) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") || len(header) > 256 {
			return "", false
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if token == "" {
			return "", false
		}
		return token, true
	}

	// =========================================================================
	// 1. Client User Registration & Login Routes (/api/v1/auth/*)
	// =========================================================================
	authGroup := api.Group("/auth")
	authGroup.Use(rateLimited)

	authGroup.POST("/register", func(c *gin.Context) {
		var input authRegisterInput
		if !decode(c, &input) {
			return
		}
		username, displayName, err := ValidateCredentials(input.Username, input.DisplayName, input.Password, true)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		pwHash, err := HashPassword(input.Password)
		if err != nil {
			fail(c, 500, msg(c, "加密用户密码失败", "Failed to hash user password"))
			return
		}
		rawToken := "pfu_" + NewID() + NewID()
		exp := time.Now().Add(30 * 24 * time.Hour)
		created, err := store.CreateClientUser(c.Request.Context(), ClientUser{
			ID:             NewID(),
			Username:       username,
			DisplayName:    displayName,
			PasswordHash:   pwHash,
			TokenHash:      TokenHash(rawToken),
			TokenExpiresAt: &exp,
		})
		if err != nil {
			if errors.Is(err, ErrDuplicateUsername) {
				fail(c, 409, msg(c, "该用户名已被注册，请更换用户名或直接登录", "Username is already taken. Choose another username or sign in"))
				return
			}
			fail(c, 500, msg(c, "注册客户端账号失败", "Failed to register client account"))
			return
		}
		c.JSON(200, gin.H{
			"token": rawToken,
			"user":  created,
		})
	})

	authGroup.POST("/login", func(c *gin.Context) {
		var input authLoginInput
		if !decode(c, &input) {
			return
		}
		if strings.TrimSpace(input.Username) == "" || input.Password == "" || len(input.Password) > 128 {
			fail(c, 400, msg(c, "请输入用户名与密码", "Please enter your username and password"))
			return
		}
		rawToken := "pfu_" + NewID() + NewID()
		exp := time.Now().Add(30 * 24 * time.Hour)
		user, err := store.AuthenticateClientUser(c.Request.Context(), input.Username, input.Password, TokenHash(rawToken), exp)
		if err != nil {
			if errors.Is(err, ErrInvalidAuth) {
				fail(c, 401, msg(c, "用户名或密码不正确", "Incorrect username or password"))
				return
			}
			fail(c, 500, msg(c, "客户端登录服务暂时不可用", "Client sign-in service is temporarily unavailable"))
			return
		}
		c.JSON(200, gin.H{
			"token": rawToken,
			"user":  user,
		})
	})

	authGroup.GET("/me", func(c *gin.Context) {
		token, ok := extractBearer(c)
		if !ok {
			fail(c, 401, msg(c, "请先登录客户端账号", "Please sign in to your client account"))
			return
		}
		user, err := store.ClientUserByToken(c.Request.Context(), TokenHash(token))
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				fail(c, 401, msg(c, "登录会话已过期或无效，请重新登录", "Session expired or invalid. Please sign in again"))
			} else {
				fail(c, 503, msg(c, "账号服务暂时不可用，请稍后重试", "Account service is temporarily unavailable. Please try again later"))
			}
			return
		}
		c.JSON(200, gin.H{"user": user})
	})

	authGroup.POST("/publisher", func(c *gin.Context) {
		token, ok := extractBearer(c)
		if !ok {
			fail(c, 401, msg(c, "请先登录账号", "Please sign in first"))
			return
		}
		user, err := store.ClientUserByToken(c.Request.Context(), TokenHash(token))
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				fail(c, 401, msg(c, "登录已失效，请重新登录", "Session expired. Please sign in again"))
			} else {
				fail(c, 503, msg(c, "账号服务暂时不可用", "Account service is temporarily unavailable"))
			}
			return
		}
		var input struct {
			LegacyToken string `json:"legacyToken"`
		}
		if !decode(c, &input) {
			return
		}
		if input.LegacyToken == "" || len(input.LegacyToken) > 256 {
			fail(c, 400, msg(c, "本机没有可关联的原发布身份", "No legacy publishing identity is available to link"))
			return
		}
		id, name, err := store.LinkClientPublisher(c.Request.Context(), user.ID, TokenHash(input.LegacyToken))
		if err != nil {
			if errors.Is(err, ErrInvalidAuth) {
				fail(c, 400, msg(c, "原发布身份已失效，请联系管理员恢复原身份", "Legacy publishing identity is no longer valid. Contact an administrator to recover it"))
			} else if errors.Is(err, ErrConflict) {
				fail(c, 409, msg(c, "发布身份已被关联，或当前账号已开始发布；不能自动合并，请联系管理员", "Publishing identity is already linked or this account already has publications; automatic merge is not allowed. Contact an administrator"))
			} else {
				fail(c, 503, msg(c, "关联发布身份失败，请稍后重试", "Failed to link publishing identity. Please try again later"))
			}
			return
		}
		c.JSON(200, gin.H{"publisherId": id, "name": name})
	})

	authGroup.POST("/logout", func(c *gin.Context) {
		token, ok := extractBearer(c)
		if !ok {
			c.JSON(200, gin.H{"loggedOut": true})
			return
		}
		if user, err := store.ClientUserByToken(c.Request.Context(), TokenHash(token)); err == nil {
			if err := store.LogoutClientUser(c.Request.Context(), user.ID, TokenHash(token)); err != nil {
				fail(c, 503, msg(c, "服务器注销失败，请稍后重试", "Failed to sign out on the server. Please try again later"))
				return
			}
		} else if !errors.Is(err, ErrNotFound) {
			fail(c, 503, msg(c, "服务器注销失败，请稍后重试", "Failed to sign out on the server. Please try again later"))
			return
		}
		c.JSON(200, gin.H{"loggedOut": true})
	})

	// =========================================================================
	// 2. Platform Admin Auth Routes (HTTPS, loopback or explicitly configured LAN)
	// =========================================================================
	adminAuth := api.Group("/admin")
	adminAuth.Use(requireAdminChannel, rateLimited)

	adminAuth.GET("/status", func(c *gin.Context) {
		initialized, err := store.HasPlatformAdmin(c.Request.Context())
		if err != nil {
			fail(c, 500, msg(c, "查询平台管理员状态失败", "Failed to query platform administrator status"))
			return
		}
		c.JSON(200, gin.H{"initialized": initialized, "hasAdmin": initialized, "bootstrapAllowed": false})
	})

	adminAuth.POST("/login", func(c *gin.Context) {
		var input authLoginInput
		if !decode(c, &input) {
			return
		}
		if strings.TrimSpace(input.Username) == "" || input.Password == "" || len(input.Password) > 128 {
			fail(c, 400, msg(c, "请输入管理员账号与密码", "Please enter administrator username and password"))
			return
		}
		rawToken := "pfa_" + NewID() + NewID()
		exp := time.Now().Add(7 * 24 * time.Hour)
		admin, err := store.AuthenticatePlatformAdmin(c.Request.Context(), input.Username, input.Password, TokenHash(rawToken), exp)
		if err != nil {
			if errors.Is(err, ErrInvalidAuth) {
				fail(c, 401, msg(c, "管理员账号或密码不正确", "Incorrect administrator username or password"))
				return
			}
			fail(c, 500, msg(c, "管理员登录服务暂时不可用", "Administrator sign-in service is temporarily unavailable"))
			return
		}
		c.JSON(200, gin.H{
			"token": rawToken,
			"admin": admin,
		})
	})

	adminAuth.GET("/me", func(c *gin.Context) {
		token, ok := extractBearer(c)
		if !ok {
			fail(c, 401, msg(c, "请使用平台管理员账号登录", "Please sign in with a platform administrator account"))
			return
		}
		admin, err := store.PlatformAdminByToken(c.Request.Context(), TokenHash(token))
		if err != nil {
			fail(c, 403, msg(c, "需要平台管理员权限，普通发布凭证或客户端用户无权访问版本管理后台", "Platform administrator privileges required. Publisher tokens and client accounts cannot access release administration"))
			return
		}
		c.JSON(200, gin.H{"admin": admin})
	})

	adminAuth.POST("/logout", func(c *gin.Context) {
		token, ok := extractBearer(c)
		if !ok {
			c.JSON(200, gin.H{"loggedOut": true})
			return
		}
		if admin, err := store.PlatformAdminByToken(c.Request.Context(), TokenHash(token)); err == nil {
			_ = store.LogoutPlatformAdmin(c.Request.Context(), admin.ID)
		}
		c.JSON(200, gin.H{"loggedOut": true})
	})

	// =========================================================================
	// 3. Release Management Routes (platform admin + permitted transport)
	// =========================================================================
	releaseAdmin := api.Group("/releases")
	releaseAdmin.Use(requireAdminChannel, requireSigningKeyReady, func(c *gin.Context) {
		token, ok := extractBearer(c)
		if !ok {
			fail(c, 401, msg(c, "请先登录平台管理员账号", "Please sign in as a platform administrator first"))
			return
		}
		admin, err := store.PlatformAdminByToken(c.Request.Context(), TokenHash(token))
		if err != nil || admin.ID == "" {
			fail(c, 403, msg(c, "仅平台管理员可维护桌面版本与安装包，普通发布者无权操作", "Only platform administrators can manage desktop releases and installers"))
			return
		}
		c.Set("adminId", admin.ID)
		c.Set("adminUsername", admin.Username)
		c.Next()
	})

	releaseAdmin.GET("", func(c *gin.Context) {
		items, err := store.ListReleases(c.Request.Context(), false)
		if err != nil {
			fail(c, 500, msg(c, "读取版本列表失败", "Failed to load release list"))
			return
		}
		for i := range items {
			items[i] = decorateRelease(items[i])
		}
		c.JSON(200, gin.H{
			"signingPublicKey": signingPubBase64,
			"items":            items,
		})
	})

	releaseAdmin.POST("", func(c *gin.Context) {
		var input releaseInput
		if !decode(c, &input) {
			return
		}
		rel, err := validateReleaseInput(input)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		rel.ID = NewID()
		rel.AdminID = c.GetString("adminId")
		created, err := store.CreateRelease(c.Request.Context(), rel)
		if err != nil {
			if errors.Is(err, ErrDuplicateVersion) {
				fail(c, 409, msg(c,
					fmt.Sprintf("版本号 v%s 已存在，请修改版本号或直接编辑已有版本", rel.Version),
					fmt.Sprintf("Release v%s already exists. Change the version number or edit the existing release", rel.Version),
				))
				return
			}
			storeError(c, err)
			return
		}
		c.JSON(200, decorateRelease(created))
	})

	releaseAdmin.PUT("/:id", func(c *gin.Context) {
		var input releaseInput
		if !decode(c, &input) {
			return
		}
		rel, err := validateReleaseInput(input)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		rel.ID = c.Param("id")
		rel.AdminID = c.GetString("adminId")
		if _, err := store.GetRelease(c.Request.Context(), rel.ID); err != nil {
			storeError(c, err)
			return
		}
		updated, err := store.UpdateRelease(c.Request.Context(), rel)
		if err != nil {
			if errors.Is(err, ErrDuplicateVersion) {
				fail(c, 409, msg(c,
					fmt.Sprintf("版本号 v%s 已存在", rel.Version),
					fmt.Sprintf("Release v%s already exists", rel.Version),
				))
				return
			}
			storeError(c, err)
			return
		}
		c.JSON(200, decorateRelease(updated))
	})

	releaseAdmin.DELETE("/:id", func(c *gin.Context) {
		deleted, err := store.DeleteRelease(c.Request.Context(), c.Param("id"))
		if err != nil {
			storeError(c, err)
			return
		}
		for _, a := range deleted.Assets {
			removeStoredFile(a.StoragePath)
		}
		c.JSON(200, gin.H{"deleted": true, "id": deleted.ID})
	})

	releaseAdmin.POST("/:id/assets", func(c *gin.Context) {
		releaseID := c.Param("id")
		rel, err := store.GetRelease(c.Request.Context(), releaseID)
		if err != nil {
			storeError(c, err)
			return
		}

		var rawOS, rawArch, rawPkg, rawFileName string
		var reader io.Reader

		if strings.HasPrefix(c.ContentType(), "multipart/form-data") {
			mr, err := c.Request.MultipartReader()
			if err != nil {
				fail(c, 400, msg(c, "解析上传表单失败", "Failed to parse multipart upload form"))
				return
			}
			if err := os.MkdirAll(storageDir, 0700); err != nil {
				fail(c, 500, msg(c, "创建安装包存储目录失败", "Failed to create installer storage directory"))
				return
			}
			tmpFile, err := os.CreateTemp(storageDir, "upload-*.tmp")
			if err != nil {
				fail(c, 500, msg(c, "创建临时文件失败", "Failed to create temporary upload file"))
				return
			}
			tmpPath := tmpFile.Name()
			cleanupTmp := true
			defer func() {
				_ = tmpFile.Close()
				if cleanupTmp {
					_ = os.Remove(tmpPath)
				}
			}()

			hasher := sha256.New()
			var sizeBytes int64
			fileReceived := false

			for {
				part, err := mr.NextPart()
				if errors.Is(err, io.EOF) {
					break
				}
				if err != nil {
					var maxErr *http.MaxBytesError
					if errors.As(err, &maxErr) {
						fail(c, 413, msg(c, "安装包大小超过 512 MB 限制", "Installer exceeds the 512 MB size limit"))
					} else {
						fail(c, 400, msg(c, "读取上传数据失败", "Failed to read uploaded data"))
					}
					return
				}
				formName := part.FormName()
				switch formName {
				case "os":
					b, _ := io.ReadAll(io.LimitReader(part, 64))
					rawOS = string(b)
				case "arch":
					b, _ := io.ReadAll(io.LimitReader(part, 64))
					rawArch = string(b)
				case "packageType":
					b, _ := io.ReadAll(io.LimitReader(part, 64))
					rawPkg = string(b)
				case "fileName":
					b, _ := io.ReadAll(io.LimitReader(part, 256))
					rawFileName = string(b)
				case "file":
					if rawFileName == "" {
						rawFileName = part.FileName()
					}
					n, copyErr := io.Copy(io.MultiWriter(tmpFile, hasher), part)
					if copyErr != nil {
						var maxErr *http.MaxBytesError
						if errors.As(copyErr, &maxErr) {
							fail(c, 413, msg(c, "安装包大小超过 512 MB 限制", "Installer exceeds the 512 MB size limit"))
						} else {
							fail(c, 400, msg(c, "保存上传文件失败", "Failed to write uploaded file"))
						}
						return
					}
					sizeBytes = n
					fileReceived = true
				}
				_ = part.Close()
			}

			if !fileReceived || sizeBytes <= 0 {
				fail(c, 400, msg(c, "请选择非空的安装包文件上传", "Please upload a non-empty installer file"))
				return
			}
			_ = tmpFile.Close()

			targetOS, err := NormalizeOS(rawOS)
			if err != nil {
				fail(c, 400, err.Error())
				return
			}
			targetArch, err := NormalizeArch(rawArch)
			if err != nil {
				fail(c, 400, err.Error())
				return
			}
			pkgType, err := NormalizePackageType(targetOS, rawPkg)
			if err != nil {
				fail(c, 400, err.Error())
				return
			}
			cleanName, err := SanitizeFileName(rawFileName)
			if err != nil {
				fail(c, 400, err.Error())
				return
			}

			assetID := NewID()
			storedName := assetID + "-" + cleanName
			finalPath := filepath.Join(storageDir, storedName)
			if err := os.Rename(tmpPath, finalPath); err != nil {
				fail(c, 500, msg(c, "持久化安装包文件失败", "Failed to persist installer file"))
				return
			}
			cleanupTmp = false

			digest := hex.EncodeToString(hasher.Sum(nil))
			asset, oldStorage, err := store.UpsertReleaseAsset(c.Request.Context(), DesktopReleaseAsset{
				ID:                assetID,
				ReleaseID:         releaseID,
				OS:                targetOS,
				Arch:              targetArch,
				PackageType:       pkgType,
				FileName:          cleanName,
				SizeBytes:         sizeBytes,
				SHA256:            digest,
				StoragePath:       storedName,
				ApprovedByAdminID: c.GetString("adminId"),
				ApprovedSHA256:    digest,
			})
			if err != nil {
				removeStoredFile(storedName)
				storeError(c, err)
				return
			}
			if oldStorage != "" && oldStorage != storedName {
				removeStoredFile(oldStorage)
			}
			c.JSON(200, decorateAsset(rel, asset))
			return
		}

		// Raw binary stream upload via query parameters
		rawOS = c.Query("os")
		rawArch = c.Query("arch")
		rawPkg = c.Query("packageType")
		rawFileName = c.Query("fileName")
		reader = c.Request.Body

		targetOS, err := NormalizeOS(rawOS)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		targetArch, err := NormalizeArch(rawArch)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		pkgType, err := NormalizePackageType(targetOS, rawPkg)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		cleanName, err := SanitizeFileName(rawFileName)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		if err := os.MkdirAll(storageDir, 0700); err != nil {
			fail(c, 500, msg(c, "创建安装包存储目录失败", "Failed to create installer storage directory"))
			return
		}
		tmpFile, err := os.CreateTemp(storageDir, "upload-*.tmp")
		if err != nil {
			fail(c, 500, msg(c, "创建临时文件失败", "Failed to create temporary upload file"))
			return
		}
		tmpPath := tmpFile.Name()
		cleanupTmp := true
		defer func() {
			_ = tmpFile.Close()
			if cleanupTmp {
				_ = os.Remove(tmpPath)
			}
		}()
		hasher := sha256.New()
		sizeBytes, err := io.Copy(io.MultiWriter(tmpFile, hasher), reader)
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				fail(c, 413, msg(c, "安装包大小超过 512 MB 限制", "Installer exceeds the 512 MB size limit"))
			} else {
				fail(c, 400, msg(c, "读取安装包内容失败", "Failed to read installer stream"))
			}
			return
		}
		if sizeBytes <= 0 {
			fail(c, 400, msg(c, "安装包文件内容不能为空", "Installer file cannot be empty"))
			return
		}
		_ = tmpFile.Close()

		assetID := NewID()
		storedName := assetID + "-" + cleanName
		finalPath := filepath.Join(storageDir, storedName)
		if err := os.Rename(tmpPath, finalPath); err != nil {
			fail(c, 500, msg(c, "保存安装包文件失败", "Failed to save installer file"))
			return
		}
		cleanupTmp = false

		digest := hex.EncodeToString(hasher.Sum(nil))
		asset, oldStorage, err := store.UpsertReleaseAsset(c.Request.Context(), DesktopReleaseAsset{
			ID:                assetID,
			ReleaseID:         releaseID,
			OS:                targetOS,
			Arch:              targetArch,
			PackageType:       pkgType,
			FileName:          cleanName,
			SizeBytes:         sizeBytes,
			SHA256:            digest,
			StoragePath:       storedName,
			ApprovedByAdminID: c.GetString("adminId"),
			ApprovedSHA256:    digest,
		})
		if err != nil {
			removeStoredFile(storedName)
			storeError(c, err)
			return
		}
		if oldStorage != "" && oldStorage != storedName {
			removeStoredFile(oldStorage)
		}
		c.JSON(200, decorateAsset(rel, asset))
	})

	releaseAdmin.POST("/:id/assets/link", func(c *gin.Context) {
		releaseID := c.Param("id")
		rel, err := store.GetRelease(c.Request.Context(), releaseID)
		if err != nil {
			storeError(c, err)
			return
		}
		var input assetLinkInput
		if !decode(c, &input) {
			return
		}
		targetOS, err := NormalizeOS(input.OS)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		targetArch, err := NormalizeArch(input.Arch)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		pkgType, err := NormalizePackageType(targetOS, input.PackageType)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		extURL := strings.TrimSpace(input.ExternalURL)
		parsedURL, err := url.Parse(extURL)
		if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "https" && parsedURL.Scheme != "http") {
			fail(c, 400, msg(c, "请填写有效的 HTTP/HTTPS 下载链接", "Please provide a valid HTTP/HTTPS download URL"))
			return
		}
		fileName := strings.TrimSpace(input.FileName)
		if fileName == "" {
			fileName = filepath.Base(parsedURL.Path)
		}
		cleanName, err := SanitizeFileName(fileName)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		if input.SizeBytes <= 0 {
			fail(c, 400, msg(c, "外链安装包必须声明大于 0 的准确字节大小", "External installer must declare an exact sizeBytes greater than 0"))
			return
		}
		checksum := strings.ToLower(strings.TrimSpace(input.SHA256))
		if !sha256Pattern.MatchString(checksum) {
			fail(c, 400, msg(c, "外链安装包必须提供有效的 64 位十六进制 SHA-256 校验值", "External installer must provide a valid 64-character hex SHA-256 checksum"))
			return
		}
		asset, oldStorage, err := store.UpsertReleaseAsset(c.Request.Context(), DesktopReleaseAsset{
			ID:                NewID(),
			ReleaseID:         releaseID,
			OS:                targetOS,
			Arch:              targetArch,
			PackageType:       pkgType,
			FileName:          cleanName,
			SizeBytes:         input.SizeBytes,
			SHA256:            checksum,
			ExternalURL:       extURL,
			ApprovedByAdminID: c.GetString("adminId"),
			ApprovedSHA256:    checksum,
		})
		if err != nil {
			storeError(c, err)
			return
		}
		if oldStorage != "" {
			removeStoredFile(oldStorage)
		}
		c.JSON(200, decorateAsset(rel, asset))
	})

	releaseAdmin.POST("/:id/assets/:assetId/approve", func(c *gin.Context) {
		releaseID := c.Param("id")
		assetID := c.Param("assetId")
		asset, rel, err := store.GetReleaseAsset(c.Request.Context(), assetID)
		if err != nil || asset.ReleaseID != releaseID {
			fail(c, 404, msg(c, "安装包不存在或不属于当前版本", "Installer asset not found or does not belong to this release"))
			return
		}
		if c.Request.ContentLength == 0 {
			fail(c, 400, msg(c, "请提交已核对的 64 位 SHA-256 摘要", "Please submit the verified 64-character SHA-256 digest"))
			return
		}
		var input assetApproveInput
		if !decode(c, &input) {
			return
		}
		expectedSHA := strings.ToLower(strings.TrimSpace(input.SHA256))
		if !sha256Pattern.MatchString(expectedSHA) {
			fail(c, 400, msg(c, "请提交已核对的 64 位 SHA-256 摘要", "Please submit the verified 64-character SHA-256 digest"))
			return
		}
		if !isTrustedAssetRecord(asset) {
			fail(c, 409, msg(c, "该安装包缺少有效的字节大小或 64 位 SHA-256 摘要，请先补全或重新上传", "Installer asset is missing a valid byte size or 64-character SHA-256 digest. Re-upload or complete metadata first"))
			return
		}
		if !strings.EqualFold(expectedSHA, asset.SHA256) {
			fail(c, 409, msg(c, "安装包 SHA-256 摘要与当前记录不一致，请刷新页面核对后再确认", "Submitted SHA-256 digest does not match the current asset record. Refresh and verify before approving"))
			return
		}
		if asset.StoragePath != "" {
			fullPath := filepath.Join(storageDir, filepath.Base(asset.StoragePath))
			f, openErr := os.Open(fullPath)
			if openErr != nil {
				fail(c, 409, msg(c, "托管安装包文件不存在，无法确认签名", "Hosted installer file is missing on disk; cannot approve signature"))
				return
			}
			h := sha256.New()
			n, copyErr := io.Copy(h, f)
			_ = f.Close()
			if copyErr != nil || n != asset.SizeBytes || !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), expectedSHA) {
				fail(c, 409, msg(c, "托管安装包文件内容或大小与记录的 SHA-256 摘要不一致，请重新上传后再确认", "Hosted installer file content or size does not match the recorded SHA-256 digest. Re-upload before approving"))
				return
			}
		}
		approved, err := store.ApproveReleaseAsset(c.Request.Context(), releaseID, assetID, c.GetString("adminId"), expectedSHA)
		if err != nil {
			if errors.Is(err, ErrConflict) {
				fail(c, 409, msg(c, "安装包摘要已变更或不可确认，请刷新后重试", "Installer digest changed or cannot be approved. Refresh and try again"))
				return
			}
			storeError(c, err)
			return
		}
		c.JSON(200, decorateAsset(rel, approved))
	})

	releaseAdmin.DELETE("/:id/assets/:assetId", func(c *gin.Context) {
		deleted, err := store.DeleteReleaseAsset(c.Request.Context(), c.Param("id"), c.Param("assetId"))
		if err != nil {
			storeError(c, err)
			return
		}
		removeStoredFile(deleted.StoragePath)
		c.JSON(200, gin.H{"deleted": true, "id": deleted.ID})
	})

	// =========================================================================
	// 4. Public Update Check & Download Routes (/api/v1/updates*)
	// =========================================================================
	public := api.Group("/updates")
	public.Use(rateLimited)

	public.GET("", requireSigningKeyReady, func(c *gin.Context) {
		channelFilter := strings.TrimSpace(c.Query("channel"))
		items, err := store.ListReleases(c.Request.Context(), true)
		if err != nil {
			fail(c, 500, msg(c, "读取版本发布记录失败", "Failed to load published releases"))
			return
		}
		filtered := make([]DesktopRelease, 0, len(items))
		for _, item := range items {
			if channelFilter == "" || channelFilter == "all" || item.Channel == channelFilter || (channelFilter == "beta" && item.Channel == "stable") {
				filtered = append(filtered, decoratePublicRelease(item))
			}
		}
		var latest *DesktopRelease
		if len(filtered) > 0 {
			first := filtered[0]
			latest = &first
		}
		c.JSON(200, gin.H{
			"signingPublicKey": signingPubBase64,
			"latest":           latest,
			"items":            filtered,
		})
	})

	public.GET("/check", requireSigningKeyReady, func(c *gin.Context) {
		currentRaw := strings.TrimSpace(c.Query("currentVersion"))
		if currentRaw == "" {
			currentRaw = "0.0.0"
		}
		currentVer, err := NormalizeSemver(currentRaw)
		if err != nil {
			fail(c, 400, err.Error())
			return
		}
		channel := strings.TrimSpace(c.Query("channel"))
		if channel == "" {
			channel = "stable"
		}
		var targetOS, targetArch string
		if rawOS := strings.TrimSpace(c.Query("os")); rawOS != "" {
			targetOS, err = NormalizeOS(rawOS)
			if err != nil {
				fail(c, 400, err.Error())
				return
			}
		}
		if rawArch := strings.TrimSpace(c.Query("arch")); rawArch != "" {
			targetArch, err = NormalizeArch(rawArch)
			if err != nil {
				fail(c, 400, err.Error())
				return
			}
		}
		preferPackage := strings.TrimSpace(c.Query("preferPackage"))

		if targetOS != "" && targetArch == "" {
			targetArch = "x64"
		}
		items, err := store.ListUpdateCandidates(c.Request.Context(), channel, targetOS)
		if err != nil {
			fail(c, 500, msg(c, "检查版本更新失败", "Failed to check for updates"))
			return
		}

		var latest *DesktopRelease
		var recommended *DesktopReleaseAsset
		platformAssets := []DesktopReleaseAsset{}
		hasUpdate := false
		for _, item := range items {
			cmp := CompareSemver(item.Version, currentVer)
			if cmp < 0 {
				break // Store results are ordered by descending semantic version.
			}
			if targetOS != "" {
				_, item.Assets = SelectRecommendedAsset(item.Assets, targetOS, targetArch, preferPackage)
			}
			candidate := decoratePublicRelease(item)
			if len(candidate.Assets) == 0 {
				continue
			}
			latest = &candidate
			hasUpdate = cmp > 0
			if targetOS != "" {
				platformAssets = candidate.Assets
				recommended = &platformAssets[0]
			}
			break
		}
		c.JSON(200, gin.H{
			"signingPublicKey": signingPubBase64,
			"currentVersion":   currentVer,
			"hasUpdate":        hasUpdate,
			"latestRelease":    latest,
			"recommendedAsset": recommended,
			"platformAssets":   platformAssets,
		})
	})

	public.GET("/assets/:assetId/download", func(c *gin.Context) {
		asset, rel, err := store.GetReleaseAsset(c.Request.Context(), c.Param("assetId"))
		if err != nil || !rel.Published {
			fail(c, 404, msg(c, "安装包不存在或该版本尚未公开", "Installer not found or release is not published"))
			return
		}
		if !isTrustedAssetRecord(asset) {
			fail(c, 409, msg(c, "该历史安装包缺少可信 SHA-256 摘要或文件大小元数据，需由平台管理员补全后才可下载", "This legacy installer is missing trusted SHA-256 or size metadata and must be approved by an administrator before download"))
			return
		}
		if !isAssetApprovedAndIntact(storageDir, asset) {
			fail(c, 403, msg(c, "该安装包尚未经平台管理员确认签名或其文件内容/摘要已变更，需由管理员重新确认后才可下载", "This installer has not been approved/signed by an administrator or its file digest has changed"))
			return
		}
		if asset.StoragePath != "" {
			fullPath := filepath.Join(storageDir, filepath.Base(asset.StoragePath))
			file, err := os.Open(fullPath)
			if err != nil {
				fail(c, 404, msg(c, "安装包文件不存在或已被清理", "Installer file is missing or has been removed"))
				return
			}
			defer file.Close()
			c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", asset.FileName))
			c.Header("Content-Type", "application/octet-stream")
			if asset.SHA256 != "" {
				c.Header("X-Checksum-Sha256", strings.ToLower(asset.SHA256))
			}
			http.ServeContent(c.Writer, c.Request, asset.FileName, asset.UpdatedAt, file)
			return
		}
		if asset.ExternalURL != "" {
			c.Redirect(http.StatusFound, asset.ExternalURL)
			return
		}
		fail(c, 404, msg(c, "安装包缺少有效的下载地址", "Installer has no valid download URL"))
	})
}
