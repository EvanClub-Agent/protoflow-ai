#!/usr/bin/env bash
# Run on a native Linux host, as a desktop user. Takes the final AppImage path.
set -euo pipefail
image=$(realpath "$1")
name=$(basename "$image" .AppImage)
arch=${name##*-}
work=$(mktemp -d)
cleanup() {
  cd /
  for _ in 1 2 3 4 5; do
    rm -rf "$work" 2>/dev/null && return 0
    sleep 0.2
  done
  rm -rf "$work" || true
}
trap cleanup EXIT
cd "$work"
if readelf -dW "$image" | grep '(NEEDED)'; then
  echo 'The AppImage runtime has a dynamic library dependency' >&2
  exit 1
fi
[[ "$("$image" --appimage-updateinformation)" == "gh-releases-zsync|EvanClub-Agent|protoflow-ai|latest|ProtoFlow_AI-*-$arch.AppImage.zsync" ]]
"$image" --appimage-extract protoflow-ai.desktop
grep -Fx 'Name=ProtoFlow AI' squashfs-root/protoflow-ai.desktop
# zsync 0.8 scans full blocks in its seed. Pad the tail so the check can
# reconstruct the last partial block before the release has a public URL.
cp --reflink=auto "$image" seed.AppImage
truncate -s +64K seed.AppImage
zsync -i seed.AppImage -o verified.AppImage "$image.zsync"
cmp "$image" verified.AppImage

# Extraction runs the real launcher even on CI hosts without a /dev/fuse device.
xvfb-run -a bash -eu -c '
  mkdir -p "$PWD/tmp"
  export XDG_CONFIG_HOME="$PWD/config" XDG_CACHE_HOME="$PWD/cache" TMPDIR="$PWD/tmp"
  setsid "$1" --appimage-extract-and-run >desktop.log 2>&1 &
  pid=$!
  stop_app() {
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for ((j=0; j<25; j++)); do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  }
  trap stop_app EXIT
  for ((i=0; i<90; i++)); do
    if xwininfo -root -tree | grep -F "\"protoflow-ai\" \"protoflow-ai\""; then exit 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  cat desktop.log >&2
  exit 1
' bash "$image"
