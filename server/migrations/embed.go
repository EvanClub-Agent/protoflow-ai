package migrations

import _ "embed"

//go:embed 001_publications.sql
var Initial string

//go:embed 002_published_notes.sql
var PublishedNotes string

//go:embed 003_published_sitemap.sql
var PublishedSitemap string

//go:embed 004_desktop_releases.sql
var DesktopReleases string

//go:embed 005_release_admin_governance.sql
var ReleaseAdminGovernance string

//go:embed 006_release_asset_approval.sql
var ReleaseAssetApproval string

//go:embed 007_published_project_notes.sql
var PublishedProjectNotes string

//go:embed 008_runtime_diagnostics.sql
var RuntimeDiagnostics string

//go:embed 009_publishing_accounts.sql
var PublishingAccounts string

//go:embed 010_client_sessions.sql
var ClientSessions string

// Startup applies the append-only migrations within the existing transaction
// and advisory lock; versioned upgrades record completion in PostgreSQL.
var All = Initial + "\n" + PublishedNotes + "\n" + PublishedSitemap + "\n" + DesktopReleases + "\n" + ReleaseAdminGovernance + "\n" + ReleaseAssetApproval + "\n" + PublishedProjectNotes + "\n" + RuntimeDiagnostics + "\n" + PublishingAccounts + "\n" + ClientSessions
