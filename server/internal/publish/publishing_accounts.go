package publish

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

func (s Postgres) EnsureClientPublisher(ctx context.Context, userID string) (string, string, error) {
	return s.clientPublisher(ctx, userID, "")
}
func (s Postgres) LinkClientPublisher(ctx context.Context, userID, legacyHash string) (string, string, error) {
	if legacyHash == "" {
		return "", "", ErrInvalidAuth
	}
	return s.clientPublisher(ctx, userID, legacyHash)
}

// A publisher ID is a separate business identity, never a substitute for user ID.
// Locking the user serializes first publication against an explicit legacy claim.
// Once assigned, ownership cannot be silently rebound or merged.
func (s Postgres) clientPublisher(ctx context.Context, userID, legacyHash string) (string, string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)
	var publisherID, displayName string
	err = tx.QueryRow(ctx, `SELECT coalesce(publisher_id,''),display_name FROM client_users WHERE id=$1 FOR UPDATE`, userID).Scan(&publisherID, &displayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	if legacyHash != "" {
		var legacyID, name string
		err = tx.QueryRow(ctx, `SELECT id,name FROM publishers WHERE token_hash=$1 FOR UPDATE`, legacyHash).Scan(&legacyID, &name)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", ErrInvalidAuth
		}
		if err != nil {
			return "", "", err
		}
		if publisherID != "" && publisherID != legacyID {
			return "", "", ErrConflict
		}
		var claimed bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM client_users WHERE publisher_id=$1 AND id<>$2)`, legacyID, userID).Scan(&claimed); err != nil {
			return "", "", err
		}
		if claimed {
			return "", "", ErrConflict
		}
		publisherID, displayName = legacyID, name
		_, err = tx.Exec(ctx, `UPDATE client_users SET publisher_id=$1,updated_at=now() WHERE id=$2`, publisherID, userID)
	} else if publisherID == "" {
		publisherID = NewID()
		// This random secret is never issued. Account sessions authenticate through client_users.
		_, err = tx.Exec(ctx, `INSERT INTO publishers(id,name,token_hash) VALUES($1,$2,$3)`, publisherID, displayName, TokenHash("account-only:"+NewID()+NewID()))
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE client_users SET publisher_id=$1,updated_at=now() WHERE id=$2`, publisherID, userID)
		}
	} else {
		err = tx.QueryRow(ctx, `SELECT name FROM publishers WHERE id=$1`, publisherID).Scan(&displayName)
	}
	if err != nil {
		return "", "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return publisherID, displayName, nil
}
