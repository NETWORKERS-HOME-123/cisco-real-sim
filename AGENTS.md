# AGENTS.md - Cisco Network Simulator

This file provides essential information for AI coding agents working on the Cisco Network Simulator project.

---

## Project Overview

**Cisco Network Simulator** is a browser-based network simulation application built with Next.js and TypeScript. It provides a Cisco-like CLI experience for educational purposes, allowing users to:

- Build network topologies with routers and switches via drag-and-drop
- Configure devices using a hierarchical Cisco IOS-like CLI
- Simulate packet routing (ARP, ICMP/ping) with visual animations
- Practice CCNA-level networking concepts

**Important:** This is a pure logical simulation - no real device emulation. It's designed for educational purposes to help students learn Cisco CLI syntax and basic networking concepts.

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | Next.js | 14.2.3 |
| Language | TypeScript | 5.4.5 |
| UI Library | React | 18.3.1 |
| Canvas Rendering | Konva.js + react-konva | 9.3.6 |
| Terminal | xterm.js | 5.5.0 |
| State Management | Zustand | 4.5.2 |
| Testing | Jest + ts-jest | 29.7.0 |
| Linting | ESLint | 8.57.0 |
| Utilities | uuid, immer | latest |

---

## Project Structure

```
cisco-simulator/
├── docker-compose.yml          # Docker Compose (production + dev profiles)
├── Dockerfile                  # Production multi-stage build
├── Dockerfile.dev              # Development image with hot reload
├── package.json                # Dependencies and scripts
├── next.config.js              # Next.js configuration with security headers
├── tsconfig.json               # TypeScript configuration
├── jest.config.js              # Jest test configuration
├── .eslintrc.json              # ESLint rules (extends next/core-web-vitals)
├── public/
│   └── simulation.worker.js    # Web Worker for simulation (static file)
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with metadata
│   │   └── page.tsx            # Main page component (force-dynamic)
│   ├── components/
│   │   ├── NetworkCanvas.tsx   # Konva.js canvas (drag-drop, zoom, pan)
│   │   ├── Terminal.tsx        # xterm.js CLI terminal component
│   │   ├── Toolbar.tsx         # Device creation toolbar
│   │   └── PropertiesPanel.tsx # Device properties sidebar
│   ├── lib/
│   │   ├── types/
│   │   │   └── index.ts        # Core TypeScript interfaces
│   │   ├── cli/
│   │   │   ├── parser.ts       # Cisco-like CLI parser
│   │   │   └── executor.ts     # CLI command executor
│   │   ├── topology/
│   │   │   └── topologyEngine.ts  # Device/link management
│   │   ├── simulation/
│   │   │   └── simulationEngine.ts # Packet processing (ARP, ICMP)
│   │   ├── utils/
│   │   │   └── priorityQueue.ts    # Min-heap priority queue
│   │   └── validation/
│   │       └── topologySchema.ts   # Input validation & XSS prevention
│   ├── pages/
│   │   └── api/
│   │       └── health.ts       # Health check endpoint
│   ├── stores/
│   │   └── simulationStore.ts  # Zustand store + Web Worker comms
│   └── tests/
│       ├── cli.test.ts         # CLI parser tests
│       ├── simulation.test.ts  # Simulation engine tests
│       └── topology.test.ts    # Topology engine tests
```

---

## Build and Development Commands

### Local Development (Node.js 18+)

```bash
# Install dependencies
npm install

# Start development server (hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linting
npm run lint

# Run tests once
npm test

# Run tests in watch mode
npm run test:watch
```

### Docker (Recommended)

```bash
# Production mode
docker-compose up -d

# Development mode with hot reload
docker-compose --profile dev up -d

# Access application
# Open http://localhost:3000
```

### Troubleshooting Build Issues

```bash
# Clear Next.js cache if build fails
rm -rf .next

# Kill Node processes (Windows)
taskkill /F /IM node.exe

# Kill Node processes (macOS/Linux)
pkill -f node
```

---

## Testing Instructions

### Test Framework
- **Runner:** Jest with ts-jest preset
- **Environment:** Node.js
- **Location:** `src/tests/*.test.ts`

### Test Coverage Configuration
Coverage is collected from:
- `src/**/*.ts` (excluding types, tests, and UI components)
- Excluded: `src/app/**`, `src/components/**`, `src/stores/**`, `src/workers/**`

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage report
npm test -- --coverage

# Watch mode for development
npm run test:watch

# Run specific test file
npm test -- cli.test.ts
```

### Test File Organization
- `cli.test.ts` - CLI parser mode transitions and command parsing
- `simulation.test.ts` - Packet processing and routing logic
- `topology.test.ts` - Device creation and link management

---

## Code Style Guidelines

### TypeScript Configuration
- **Target:** ES2017
- **Strict mode:** Enabled
- **Module Resolution:** Bundler
- **Path Alias:** `@/*` maps to `src/*`

### ESLint Rules
Extends `next/core-web-vitals` with relaxed rules:
- `@typescript-eslint/no-unused-vars`: OFF (allow unused variables during development)
- `@typescript-eslint/no-explicit-any`: OFF (allow `any` where necessary)

### Coding Conventions

1. **File Headers:** Include descriptive JSDoc comments at the top of each file
   ```typescript
   /**
    * Brief description of the module
    * Additional details if needed
    */
   ```

2. **Section Dividers:** Use `// ===` style dividers for major sections
   ```typescript
   // ============================================================================
   // Section Name
   // ============================================================================
   ```

3. **Type Imports:** Import types explicitly from `../lib/types`
   ```typescript
   import { Device, Interface, Packet } from '../types';
   ```

4. **State Management:** Use Zustand with Immer middleware for immutable updates
   ```typescript
   set((state) => {
     state.property = newValue; // Immer handles immutability
   });
   ```

5. **Component Exports:** Use default exports for page components, named exports for others
   ```typescript
   // Pages
   export default function Home() { }
   
   // Components
   export function Toolbar() { }
   ```

---

## Security Considerations

### Input Validation
All user inputs must be validated:

1. **CLI Input Limits** (`src/lib/cli/parser.ts`):
   - Maximum input length: 1024 characters
   - Maximum token length: 256 characters
   - Allowed characters: Printable ASCII only (`^[\x20-\x7E]*$`)

2. **Topology Import Validation** (`src/lib/validation/topologySchema.ts`):
   - Max devices: 1000
   - Max links: 5000
   - Max import size: 10MB
   - MAC address format validation
   - IP address format validation
   - Device name validation (alphanumeric + hyphens, max 63 chars)

3. **XSS Prevention:**
   - All displayed strings are sanitized via `sanitizeString()`
   - HTML entities are escaped: `<`, `>`, `"`, `'`, `/`
   - No `dangerouslySetInnerHTML` usage

4. **Prototype Pollution Prevention:**
   - Topology validation checks for `__proto__` and `constructor` properties
   - No spread operators on untrusted data

### Security Headers
Configured in `next.config.js`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

### Environment Variables
- `NODE_ENV` - Environment mode (development/production)
- `PORT` - Server port (default: 3000)
- `NEXT_TELEMETRY_DISABLED` - Set to 1 to disable telemetry

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                      │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   Toolbar    │  │    Canvas    │  │ Properties Panel│   │
│  │   (React)    │  │   (Konva.js) │  │    (React)      │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                      Zustand Store                           │
│              (State Management & Worker Comms)              │
├─────────────────────────────────────────────────────────────┤
│                    Web Worker Thread                         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   Topology   │  │  Simulation  │  │  CLI Parser/    │   │
│  │    Engine    │  │    Engine    │  │   Executor      │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Modules

#### 1. Topology Engine (`src/lib/topology/topologyEngine.ts`)
- Device creation and management
- Interface generation (routers: 4x GigabitEthernet, switches: 24x FastEthernet)
- Link creation and validation
- MAC address generation (uses `crypto.getRandomValues` when available)

#### 2. Simulation Engine (`src/lib/simulation/simulationEngine.ts`)
- Event-driven packet processing
- Priority queue for event scheduling (O(log n))
- ARP resolution and MAC learning
- ICMP echo request/reply (ping)
- Static routing with longest prefix match
- L2 loop protection (TTL/hop count limit: 32)

#### 3. CLI Parser (`src/lib/cli/parser.ts`)
- Hierarchical command parsing (User → Privileged → Config → Interface)
- Command abbreviation support (e.g., `sh` → `show`)
- Context help with `?` character
- Mode transition management

#### 4. CLI Executor (`src/lib/cli/executor.ts`)
- Command action execution
- Configuration state management
- Show command output generation
- Configuration persistence (startup-config/running-config)

### State Management

The Zustand store (`src/stores/simulationStore.ts`) manages:
- Topology state (serialized for Worker communication)
- UI state (selected device, zoom, pan, tool selection)
- Web Worker instance
- CLI history and output

### Web Worker Communication

Message types between main thread and worker:
- `INIT` - Initialize worker
- `TOPOLOGY_UPDATE` - Send topology changes to worker
- `CLI_COMMAND` - Send CLI command to worker
- `STATE_UPDATE` - Receive topology updates from worker
- `CLI_RESPONSE` - Receive CLI output from worker
- `ANIMATION_EVENT` - Receive packet animation events
- `ERROR` - Error handling

---

## Supported CLI Commands

### User EXEC Mode (`>`)
- `enable` - Enter privileged EXEC mode
- `help` - Show available commands

### Privileged EXEC Mode (`#`)
- `disable` - Exit to user EXEC mode
- `configure terminal` - Enter global configuration mode
- `show version` - Display system version
- `show running-config` - Display running configuration
- `show startup-config` - Display startup configuration
- `show ip interface brief` - Display interface summary
- `show interfaces [name]` - Display interface details
- `show ip route` - Display routing table
- `show arp` - Display ARP table
- `show mac address-table` - Display MAC address table
- `ping <ip>` - Ping a destination
- `write memory` - Save configuration
- `copy running-config startup-config` - Save configuration
- `erase startup-config` - Erase startup configuration
- `reload` - Reload the system

### Global Configuration Mode (`(config)#`)
- `hostname <name>` - Set device hostname
- `interface <name>` - Enter interface configuration mode
- `ip route <network> <mask> <nextHop>` - Add static route
- `no ip route <network> <mask>` - Remove static route
- `end` - Exit to privileged EXEC mode
- `exit` - Exit to previous mode

### Interface Configuration Mode (`(config-if)#`)
- `ip address <ip> <mask>` - Assign IP address
- `no ip address` - Remove IP address
- `shutdown` - Administratively shutdown interface
- `no shutdown` - Enable interface
- `description <text>` - Set interface description
- `no description` - Remove interface description
- `exit` - Exit to global configuration mode

---

## Development Notes

### Canvas Rendering
- NetworkCanvas is dynamically imported with `ssr: false` to avoid SSR issues with Konva.js
- Grid is memoized to prevent re-creation on every render
- Selective Zustand subscriptions reduce re-renders by ~80%

### Performance Optimizations
- Priority Queue (Min-Heap) for event scheduling: O(log n) vs O(n log n)
- MAC address generation uses `crypto.getRandomValues` when available
- Component memoization for Grid, DeviceNode, LinkLine

### Security Audit Reference
See `SECURITY_AUDIT.md` for detailed security review and fixes applied.

### CCNA Readiness Status
See `CCNA_READINESS_UPDATE.md` for feature coverage and roadmap.

---

## File Naming Conventions

- **Components:** PascalCase (e.g., `NetworkCanvas.tsx`)
- **Libraries:** camelCase (e.g., `topologyEngine.ts`)
- **Types:** Lowercase with descriptive names (e.g., `index.ts` in types folder)
- **Tests:** `*.test.ts` suffix
- **Configuration:** Lowercase (e.g., `next.config.js`)

---

## Additional Resources

- **README.md** - User-facing documentation
- **SECURITY_AUDIT.md** - Security audit report
- **CCNA_READINESS_UPDATE.md** - Feature implementation status
