#!/bin/bash
# Log Cleanup Script
# Usage: ./cleanup-logs.sh [days_to_keep]

# Default to keeping 7 days of logs
DAYS_TO_KEEP=${1:-7}
ARCHIVE_DIR="./archive"
CURRENT_DATE=$(date +%Y-%m-%d)

echo "Log Cleanup Tool"
echo "====================="
echo "Archiving logs older than $DAYS_TO_KEEP days"

# Create archive directory if it doesn't exist
mkdir -p "$ARCHIVE_DIR"

# Function to archive old logs
archive_old_logs() {
  local log_type=$1
  local log_file=$2
  
  if [ -f "$log_file" ]; then
    # Check if the log file is older than specified days
    if [ $(find "$log_file" -mtime +$DAYS_TO_KEEP -print | wc -l) -gt 0 ]; then
      echo "Archiving old $log_type log: $log_file"
      
      # Create an archive filename with date
      local archive_name="$ARCHIVE_DIR/$(basename $log_file).$CURRENT_DATE.bak"
      
      # Copy to archive and truncate original
      cp "$log_file" "$archive_name"
      > "$log_file"
      
      echo "✓ Archived to $archive_name"
    fi
  fi
}

# Archive old log files
archive_old_logs "engine error" "./engine-err.log"
archive_old_logs "engine output" "./engine-out.log"
archive_old_logs "amplifier error" "./amplifier-err.log"
archive_old_logs "amplifier output" "./amplifier-out.log"
archive_old_logs "mirror error" "./mirror-err.log"
archive_old_logs "mirror output" "./mirror-out.log"
archive_old_logs "monitor error" "./monitor-err.log"
archive_old_logs "monitor output" "./monitor-out.log"
archive_old_logs "gist updater error" "./gist-updater-err.log"
archive_old_logs "gist updater output" "./gist-updater-out.log"

# Clean up old archives (older than 30 days)
find "$ARCHIVE_DIR" -type f -name "*.bak" -mtime +30 -delete

echo "Log cleanup complete!"
