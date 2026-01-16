# Better Notes

A powerful notes management system with MCP (Model Context Protocol) integration for Claude, full-text search, and automatic git sync.

## Features

- **MCP Integration**: Use Claude to create, search, and manage notes naturally
- **Full-Text Search**: SQLite-powered search across all notes
- **Git Auto-Sync**: Automatic commits and pushes with smart debouncing
- **Entity Extraction**: Automatically tracks @mentions for people
- **Background Daemon**: File watching and syncing runs in the background
- **Human-Readable Storage**: Markdown files organized by date

## Installation

```bash
npm install -g @better-notes/cli
```

## Quick Start

1. **Initialize**:
   ```bash
   better-notes init
   ```

2. **Start the daemon** (optional, for file watching and git sync):
   ```bash
   better-notes daemon start
   ```

3. **Add to Claude Code** (one-liner):
   ```bash
   claude mcp add-json better-notes '{"command":"npx","args":["@better-notes/cli","serve"]}'
   ```

   Or if globally installed:
   ```bash
   claude mcp add-json better-notes '{"command":"better-notes","args":["serve"]}'
   ```

4. **Or configure Claude Desktop manually**:
   ```json
   {
     "mcpServers": {
       "better-notes": {
         "command": "better-notes",
         "args": ["serve"]
       }
     }
   }
   ```

## CLI Commands

### Setup & Configuration

```bash
# Interactive setup
better-notes init

# Show configuration
better-notes config
```

### Daemon Management

```bash
# Start background daemon
better-notes daemon start

# Stop daemon
better-notes daemon stop

# Check status
better-notes daemon status

# Run in foreground
better-notes daemon start --foreground
```

### Note Management

```bash
# Create a note
better-notes note create --title "Meeting with team" --content "Discussed roadmap"

# View today's note
better-notes note today

# List recent notes
better-notes note recent --days 7
```

### Search

```bash
# Full-text search
better-notes search "project timeline"

# Search with filters
better-notes search "@hannah past week"
```

### Index Management

```bash
# Rebuild search index
better-notes index rebuild

# Show index stats
better-notes index stats
```

### Service Installation

```bash
# Show instructions for systemd/launchd
better-notes install-service
```

## MCP Tools

When used with Claude, the following tools are available:

| Tool | Description |
|------|-------------|
| `create_note` | Create a new note entry |
| `append_note` | Append to today's note |
| `search_notes` | Natural language search with filters |
| `search_by_person` | Find notes mentioning a person |
| `search_by_topic` | Full-text topic search |
| `get_daily_summary` | Get summary for a day |
| `list_recent_notes` | List notes from past N days |
| `get_note` | Get full note content |
| `list_categories` | List available categories |
| `list_tags` | List all tags |
| `list_people` | List mentioned people |
| `search_by_category` | Filter by category |
| `search_by_tag` | Filter by tag |

## File Structure

Notes are stored in markdown format:

```
~/notes/
├── 2024/
│   ├── 01/
│   │   ├── 2024-01-15.md
│   │   └── 2024-01-16.md
│   └── 02/
│       └── ...
├── .index/
│   ├── notes.db      # SQLite search index
│   ├── daemon.pid    # Daemon PID file
│   └── daemon.log    # Daemon log
└── .gitignore
```

## Note Format

Notes use YAML frontmatter:

```markdown
---
title: Notes for 2024-01-15
created: 2024-01-15T09:00:00.000Z
updated: 2024-01-15T14:30:00.000Z
tags:
  - project
  - meeting
mentions:
  - hannah
  - bob
---

## 09:00 - Morning standup

Discussed sprint progress with @hannah and @bob.

Tags: #meeting #standup

## 14:30 - Project review

Reviewed Q1 roadmap. Key decisions:
- Launch feature X by Feb
- Prioritize performance work

Tags: #project #planning
```

## Configuration

Config file: `~/.better-notes.json`

```json
{
  "notesDirectory": "~/notes",
  "categories": ["work", "meeting", "personal", "idea", "task"],
  "defaultCategory": "personal",
  "gitSync": {
    "enabled": true,
    "debounceSeconds": 30,
    "autoCommit": true,
    "autoPush": true
  },
  "daemon": {
    "enabled": true,
    "watchFiles": true
  },
  "search": {
    "enableEntityExtraction": true,
    "maxResults": 20
  }
}
```

## License

MIT
