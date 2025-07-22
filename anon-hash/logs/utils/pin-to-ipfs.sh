#!/bin/bash

# 1. Pin the current directory to IPFS and get the new hash
NEW_HASH=$(ipfs add -r -Q .)

if [ -z "$NEW_HASH" ]; then
    echo "Error: Failed to get new IPFS hash. Make sure IPFS is running and the daemon is accessible."
    exit 1
fi

echo "New IPFS Manifest Hash: $NEW_HASH"

# 2. Find and replace the placeholder in all relevant files
# Use grep to find files containing the placeholder
FILES_TO_UPDATE=$(grep -rl "__IPFS_MANIFEST_HASH__" .)

if [ -z "$FILES_TO_UPDATE" ]; then
    echo "No files with placeholder found. Nothing to update."
    exit 0
fi

echo "Updating files..."
for FILE in $FILES_TO_UPDATE; do
    # Use sed to replace the placeholder with the new hash
    sed -i "" "s/__IPFS_MANIFEST_HASH__/$NEW_HASH/g" "$FILE"
    echo "  Updated $FILE"
done

# 3. Update the .ipfs-hash file
echo "$NEW_HASH" > .ipfs-hash

echo "
IPFS hash updated successfully in all relevant files.
"
