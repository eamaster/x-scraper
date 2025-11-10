#!/bin/bash
#
# Git History Purge Script for X Scraper
#
# This script uses git-filter-repo to purge exposed secrets from Git history.
# 
# ⚠️ WARNING: This rewrites Git history and requires force-push.
# ⚠️ WARNING: Forked repositories will still contain the old history.
# ⚠️ WARNING: Always backup your repository before running this script.
#
# Prerequisites:
#   pip install git-filter-repo
#   OR
#   brew install git-filter-repo (macOS)
#
# Usage:
#   1. Backup your repository: git clone --mirror <repo-url> backup.git
#   2. Review the commits that will be affected
#   3. Run this script: bash scripts/history-purge.sh
#   4. Review the changes: git log --all
#   5. Force push: git push origin --force --all
#   6. Force push tags: git push origin --force --tags
#
# After running:
#   - Notify all collaborators to re-clone the repository
#   - Rotate all exposed credentials (see ROTATE.md)
#   - Update any documentation referencing old commits

set -e

echo "⚠️  WARNING: This script will rewrite Git history!"
echo "⚠️  Make sure you have a backup of your repository."
echo ""
read -p "Have you backed up your repository? (yes/no): " backup_confirm

if [ "$backup_confirm" != "yes" ]; then
    echo "❌ Please backup your repository first!"
    echo "   Run: git clone --mirror <repo-url> backup.git"
    exit 1
fi

# Check if git-filter-repo is installed
if ! command -v git-filter-repo &> /dev/null; then
    echo "❌ git-filter-repo is not installed!"
    echo "   Install with: pip install git-filter-repo"
    echo "   OR: brew install git-filter-repo"
    exit 1
fi

echo ""
echo "🔍 Commits that will be affected:"
echo ""

# Show commits containing the exposed API key
echo "Commits with exposed RapidAPI key:"
git log --all -S "4aaf9685f9msh91bb6936661eb07p1a7da5jsn7ff9f3fe3216" --oneline --source || echo "  (none found)"

# Show commits containing the exposed Worker URL
echo ""
echo "Commits with exposed Worker URL:"
git log --all -S "twitter-api-proxy.smah0085" --oneline --source || echo "  (none found)"

echo ""
read -p "Continue with history purge? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Aborted."
    exit 1
fi

echo ""
echo "🧹 Purging secrets from Git history..."
echo ""

# Remove the exposed API key from all commits
echo "Removing exposed RapidAPI key..."
git filter-repo \
    --path script.js \
    --path cloudflare-worker.js \
    --invert-paths \
    --replace-text <(echo "4aaf9685f9msh91bb6936661eb07p1a7da5jsn7ff9f3fe3216==>REDACTED_API_KEY") \
    --force

# Remove the exposed Worker URL from all commits
echo "Removing exposed Worker URL..."
git filter-repo \
    --path script.js \
    --path test-api.html \
    --replace-text <(echo "https://twitter-api-proxy.smah0085.workers.dev==>YOUR_CLOUDFLARE_WORKER_URL") \
    --force

echo ""
echo "✅ History purge complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Review changes: git log --all --oneline"
echo "   2. Verify no secrets remain: git log --all -S 'REDACTED_API_KEY'"
echo "   3. Force push: git push origin --force --all"
echo "   4. Force push tags: git push origin --force --tags"
echo "   5. Notify collaborators to re-clone the repository"
echo "   6. Rotate all exposed credentials (see ROTATE.md)"
echo ""
echo "⚠️  Remember:"
echo "   - Forked repositories still contain old history"
echo "   - All collaborators must re-clone"
echo "   - Rotate all exposed credentials immediately"

