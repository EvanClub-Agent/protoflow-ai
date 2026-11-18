package publish

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type Store interface {
	Publisher(context.Context, string) (string, string, error)
	EnsureClientPublisher(context.Context, string) (string, string, error)
	LinkClientPublisher(context.Context, string, string) (string, string, error)
	List(context.Context, string, string) ([]Publication, error)
	Get(context.Context, string, string) (Publication, error)
	Create(context.Context, Publication) (Publication, error)
	Update(context.Context, Publication, int) (Publication, error)
	Revoke(context.Context, string, string, int) (Publication, error)
	HasPlatformAdmin(context.Context) (bool, error)
	CreatePlatformAdmin(context.Context, PlatformAdmin) (PlatformAdmin, error)
	UpsertPlatformAdmin(context.Context, PlatformAdmin) (PlatformAdmin, bool, error)
	AuthenticatePlatformAdmin(context.Context, string, string, string, time.Time) (PlatformAdmin, error)
	PlatformAdminByToken(context.Context, string) (PlatformAdmin, error)
	LogoutPlatformAdmin(context.Context, string) error
	CreateClientUser(context.Context, ClientUser) (ClientUser, error)
	AuthenticateClientUser(context.Context, string, string, string, time.Time) (ClientUser, error)
	ClientUserByToken(context.Context, string) (ClientUser, error)
	LogoutClientUser(context.Context, string, string) error
	ListReleases(context.Context, bool) ([]DesktopRelease, error)
	ListUpdateCandidates(context.Context, string, string) ([]DesktopRelease, error)
	GetRelease(context.Context, string) (DesktopRelease, error)
	CreateRelease(context.Context, DesktopRelease) (DesktopRelease, error)
	UpdateRelease(context.Context, DesktopRelease) (DesktopRelease, error)
	DeleteRelease(context.Context, string) (DesktopRelease, error)
	UpsertReleaseAsset(context.Context, DesktopReleaseAsset) (DesktopReleaseAsset, string, error)
	ApproveReleaseAsset(context.Context, string, string, string, string) (DesktopReleaseAsset, error)
	GetReleaseAsset(context.Context, string) (DesktopReleaseAsset, DesktopRelease, error)
	DeleteReleaseAsset(context.Context, string, string) (DesktopReleaseAsset, error)
}
type Postgres struct{ Pool *pgxpool.Pool }

const columns = `id, publisher_id, project_id, title, snapshot, version, password_hash, expires_at, revoked_at, created_at, updated_at`

func scan(row pgx.Row) (Publication, error) {
	var p Publication
	e := row.Scan(&p.ID, &p.PublisherID, &p.ProjectID, &p.Title, &p.Snapshot, &p.Version, &p.PasswordHash, &p.ExpiresAt, &p.RevokedAt, &p.CreatedAt, &p.UpdatedAt)
	p.PasswordProtected = p.PasswordHash != ""
	if errors.Is(e, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, e
}
func (s Postgres) Publisher(ctx context.Context, hash string) (string, string, error) {
	var id, name string
	e := s.Pool.QueryRow(ctx, `SELECT id,name FROM publishers WHERE token_hash=$1`, hash).Scan(&id, &name)
	if errors.Is(e, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return id, name, e
}
func (s Postgres) List(ctx context.Context, owner, project string) ([]Publication, error) {
	rows, e := s.Pool.Query(ctx, `SELECT `+columns+` FROM publications WHERE publisher_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100`, owner, project)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Publication{}
	for rows.Next() {
		p, e := scan(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s Postgres) Get(ctx context.Context, id, owner string) (Publication, error) {
	return scan(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM publications WHERE id=$1 AND ($2='' OR publisher_id=$2)`, id, owner))
}
func (s Postgres) Create(ctx context.Context, p Publication) (Publication, error) {
	return scan(s.Pool.QueryRow(ctx, `INSERT INTO publications(id,publisher_id,project_id,title,snapshot,password_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+columns, p.ID, p.PublisherID, p.ProjectID, p.Title, p.Snapshot, p.PasswordHash, p.ExpiresAt))
}
func (s Postgres) Update(ctx context.Context, p Publication, version int) (Publication, error) {
	result, e := scan(s.Pool.QueryRow(ctx, `UPDATE publications SET title=$1,snapshot=$2,password_hash=$3,expires_at=$4,version=version+1,updated_at=now() WHERE id=$5 AND publisher_id=$6 AND project_id=$7 AND version=$8 AND revoked_at IS NULL RETURNING `+columns, p.Title, p.Snapshot, p.PasswordHash, p.ExpiresAt, p.ID, p.PublisherID, p.ProjectID, version))
	if errors.Is(e, ErrNotFound) {
		return result, ErrConflict
	}
	return result, e
}
func (s Postgres) Revoke(ctx context.Context, id, owner string, version int) (Publication, error) {
	result, e := scan(s.Pool.QueryRow(ctx, `UPDATE publications SET revoked_at=now(),updated_at=now(),version=version+1 WHERE id=$1 AND publisher_id=$2 AND version=$3 AND revoked_at IS NULL RETURNING `+columns, id, owner, version))
	if errors.Is(e, ErrNotFound) {
		return result, ErrConflict
	}
	return result, e
}
