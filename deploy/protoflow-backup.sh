#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/data/protoflow-ai
stamp=$(date -u +%Y%m%d-%H%M%S)
stage=$(mktemp -d "$root/backups/.backup-XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
runuser -u postgres -- pg_dump -Fc protoflow_publish > "$stage/database.dump"
cp "$root/shared/server.env" "$stage/server.env"
cp "$root/shared/releases/.release-signing-key.ed25519" "$stage/release-signing-key.ed25519"
readlink -f "$root/current" > "$stage/release.txt"
tar -czf "$root/backups/daily-$stamp.tar.gz.tmp" -C "$stage" .
mv "$root/backups/daily-$stamp.tar.gz.tmp" "$root/backups/daily-$stamp.tar.gz"
find "$root/backups" -maxdepth 1 -type f -name 'daily-????????-??????.tar.gz' -mtime +14 -delete
