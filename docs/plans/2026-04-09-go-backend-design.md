# Hybrid Go Backend Design — cisco-real-sim

**Date**: 2026-04-09
**Status**: Approved
**Approach**: Monolith (Approach A) — single Go binary serves API + static frontend

## Context

The cisco-real-sim browser-based Cisco CLI simulator needs a backend for:
- User authentication (friends sharing the same VM)
- Save/load lab topologies per user
- 10 preset CCNA labs with objectives
- Auto-grading against answer keys
- Export/import lab files
- Real-time auto-save via WebSocket

All CLI simulation, protocol engines, and packet processing remain 100% client-side.

## Constraints

- **Deploy target**: Self-hosted VM (16 CPU, 32GB RAM, 500GB NVMe, 2Gbps)
- **Users**: Personal + friends (~5-10 concurrent)
- **Database**: SQLite (single file, zero ops)
- **Framework**: Go Fiber
- **Auth**: JWT + bcrypt, 7-day token expiry
- **No changes** to existing simulation code

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Go Binary (Fiber)                   │
│                                                        │
│  Static Files ─── serves Next.js export (/)            │
│                                                        │
│  Auth (/api/v1/auth/)                                  │
│    POST /register        create account                │
│    POST /login           get JWT token                 │
│    GET  /me              current user info              │
│                                                        │
│  Labs (/api/v1/labs/)  [JWT required]                  │
│    GET    /              list my saved labs             │
│    POST   /              create new lab                │
│    GET    /:id           load lab                      │
│    PUT    /:id           update lab                    │
│    DELETE /:id           delete lab                    │
│    GET    /:id/export    download JSON file            │
│    POST   /import        upload JSON file              │
│    POST   /:id/grade     check against answer key      │
│                                                        │
│  Presets (/api/v1/presets/)  [JWT required]             │
│    GET  /                list preset labs               │
│    GET  /:id             load preset                   │
│                                                        │
│  WebSocket (/ws)  [JWT in query param]                  │
│    auto-save topology every 60s                        │
│                                                        │
│  SQLite (labs.db)                                       │
└──────────────────────────────────────────────────────┘
```

## Data Model

### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| username | TEXT UNIQUE NOT NULL | |
| password_hash | TEXT NOT NULL | bcrypt |
| display_name | TEXT | |
| created_at | DATETIME | |

### labs
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL | FK → users |
| name | TEXT NOT NULL | |
| description | TEXT | |
| topology | TEXT NOT NULL | full topology JSON |
| thumbnail | TEXT | base64 canvas screenshot |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### presets
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| category | TEXT NOT NULL | routing/switching/security/services/comprehensive |
| difficulty | TEXT NOT NULL | beginner/intermediate/advanced |
| description | TEXT | |
| objectives | TEXT NOT NULL | JSON array of objective strings |
| topology | TEXT NOT NULL | starter topology JSON |
| answer_key | TEXT NOT NULL | JSON grading spec |
| sort_order | INTEGER | |

### grade_results
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL | FK → users |
| lab_id | TEXT NOT NULL | FK → labs |
| preset_id | TEXT | FK → presets |
| score | INTEGER NOT NULL | 0-100 |
| total | INTEGER NOT NULL | total objectives |
| passed | INTEGER NOT NULL | passed objectives |
| details | TEXT NOT NULL | JSON per-objective results |
| graded_at | DATETIME | |

## Grading Engine

The grading engine compares topology JSON against answer_key. Each objective has one or more checks.

### Check Types

| Check Type | Validates |
|-----------|-----------|
| interface_ip | Interface has correct IP/mask |
| interface_up | Interface not shutdown |
| ospf_enabled | OSPF process exists |
| ospf_neighbor | Neighbor in expected state |
| ospf_network | Network statement in OSPF |
| route_exists | Route to network exists |
| vlan_exists | VLAN created |
| vlan_port | Interface in correct VLAN |
| trunk_configured | Interface is trunk |
| acl_applied | ACL on interface in/out |
| acl_entry_exists | ACL has specific entry |
| nat_configured | NAT inside/outside |
| nat_static | Static NAT entry |
| dhcp_pool | DHCP pool with network/gateway |
| hostname | Device hostname |
| default_route | Default route exists |

### Answer Key Format

```json
{
  "objectives": [
    {
      "id": 1,
      "description": "Configure IP on R1 Gi0/0",
      "checks": [
        { "device": "Router1", "type": "interface_ip", "interface": "GigabitEthernet0/0", "ip": "10.0.0.1", "mask": "255.255.255.0" }
      ]
    }
  ]
}
```

### Grading Response

```json
{
  "score": 75,
  "total": 4,
  "passed": 3,
  "results": [
    { "id": 1, "passed": true, "description": "..." },
    { "id": 2, "passed": false, "description": "...", "reason": "No ACL applied" }
  ]
}
```

## Project Structure

```
backend/
  main.go
  go.mod / go.sum
  config/config.go
  database/sqlite.go, migrations.go
  models/user.go, lab.go, preset.go, grade.go
  handlers/auth.go, labs.go, presets.go, grading.go
  middleware/auth.go
  websocket/autosave.go
  presets/ccna_labs.go
```

## Frontend Additions (~500 lines)

```
src/app/login/page.tsx          login + register
src/app/labs/page.tsx           lab picker
src/lib/api/client.ts           fetch wrapper with JWT
src/lib/api/types.ts            API types
src/stores/authStore.ts         auth Zustand store
src/components/GradePanel.tsx   score overlay
src/components/LabPicker.tsx    lab card grid
src/components/LoginForm.tsx    auth form
```

## 10 Preset CCNA Labs

1. Basic IP Addressing (routing/beginner)
2. Static Routing (routing/beginner)
3. OSPF Single Area (routing/intermediate)
4. VLAN Configuration (switching/beginner)
5. Inter-VLAN Routing (switching/intermediate)
6. Standard ACLs (security/beginner)
7. Extended ACLs (security/intermediate)
8. Static NAT + PAT (security/intermediate)
9. DHCP Server (services/beginner)
10. Full Network Build (comprehensive/advanced)

## Deployment

```bash
# Build frontend
npm run build && next export

# Build Go (embeds frontend)
cd backend && go build -o cisco-lab-server .

# Run
./cisco-lab-server   # :3000, SQLite at ./labs.db
```

## Effort Estimate

~10 working days, ~3,500 lines Go + ~500 lines frontend.
