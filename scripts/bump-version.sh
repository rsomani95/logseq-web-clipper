#!/bin/bash

set -e

NEW_VERSION="$1"

if [ -z "$NEW_VERSION" ]; then
	echo "Usage: ./bump-version.sh <version>"
	echo "Example: ./bump-version.sh 1.0.1"
	exit 1
fi

if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	echo "Error: Version must be in semver format (X.Y.Z)"
	exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# JSON files to update
JSON_FILES=(
	"package.json"
	"src/manifest.chrome.json"
	"src/manifest.firefox.json"
	"src/manifest.safari.json"
	"dev/manifest.json"
)

echo "Bumping version to $NEW_VERSION"
echo ""

# Update JSON files
for file in "${JSON_FILES[@]}"; do
	filepath="$ROOT_DIR/$file"
	old_version=$(grep -o '"version": "[^"]*"' "$filepath" | head -1 | sed 's/"version": "//;s/"//')
	sed -i '' "s/\"version\": \"$old_version\"/\"version\": \"$NEW_VERSION\"/" "$filepath"
	echo "Updated $file: $old_version -> $NEW_VERSION"
done

# Keep the Chrome manifest's human-readable version_name in sync with the numeric
# version, preserving the "(obsidian-clipper X.Y.Z)" provenance suffix. version_name
# is Chrome-only; the other manifests carry the numeric version alone.
chrome_manifest="$ROOT_DIR/src/manifest.chrome.json"
if grep -q '"version_name"' "$chrome_manifest"; then
	sed -i '' -E "s/(\"version_name\": \")[0-9]+\.[0-9]+\.[0-9]+/\1$NEW_VERSION/" "$chrome_manifest"
	echo "Updated version_name in src/manifest.chrome.json (provenance suffix preserved)"
fi

echo ""
echo "Done!"
echo "Next: commit the bump, then  git tag v$NEW_VERSION && git push origin v$NEW_VERSION"
