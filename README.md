# Cisco Network Simulator

A browser-based Cisco network simulator with Konva.js visualization and a Cisco-like CLI parser. No real device emulation - pure logical simulation.

## Features

- **Topology Engine**: Drag-and-drop device placement, link connections
- **Simulation Engine**: Event-driven packet processing (ARP, ICMP)
- **CLI Parser**: Cisco-like hierarchical CLI with multiple modes
- **Canvas Renderer**: Konva.js-based visualization with zoom/pan
- **Web Workers**: Non-blocking simulation in separate thread

## Supported Cisco Commands

### User EXEC Mode (>)
- `enable` - Enter privileged EXEC mode
- `help` - Show available commands

### Privileged EXEC Mode (#)
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

### Global Configuration Mode (config)#
- `hostname <name>` - Set device hostname
- `interface <name>` - Enter interface configuration mode
- `ip route <network> <mask> <nextHop>` - Add static route
- `no ip route <network> <mask>` - Remove static route
- `end` - Exit to privileged EXEC mode
- `exit` - Exit to previous mode

### Interface Configuration Mode (config-if)#
- `ip address <ip> <mask>` - Assign IP address
- `no ip address` - Remove IP address
- `shutdown` - Administratively shutdown interface
- `no shutdown` - Enable interface
- `description <text>` - Set interface description
- `no description` - Remove interface description
- `exit` - Exit to global configuration mode

## Quick Start

### Prerequisites
- Docker Desktop installed OR Node.js 18+ installed
- Git (optional, for cloning)

### Using Docker (Recommended)

```bash
# Build and run with Docker Compose
docker-compose up -d

# Access the application
open http://localhost:3000
```

### Development Mode with Docker

```bash
# Run in development mode with hot reload
docker-compose --profile dev up -d

# Access the application
open http://localhost:3000
```

### Local Development (Without Docker)

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Access the application
open http://localhost:3000
```

### Building for Production

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Start production server
npm start
```

## Project Structure

```
cisco-simulator/
├── docker-compose.yml          # Docker Compose configuration
├── Dockerfile                  # Production Docker image
├── Dockerfile.dev              # Development Docker image
├── package.json                # Node.js dependencies
├── next.config.js              # Next.js configuration
├── tsconfig.json               # TypeScript configuration
├── jest.config.js              # Jest test configuration
├── public/
│   └── simulation.worker.js    # Web Worker for simulation
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Main page
│   ├── components/
│   │   ├── NetworkCanvas.tsx   # Konva.js canvas component
│   │   ├── Terminal.tsx        # xterm.js CLI terminal
│   │   ├── Toolbar.tsx         # Device creation toolbar
│   │   └── PropertiesPanel.tsx # Device properties panel
│   ├── lib/
│   │   ├── types/
│   │   │   └── index.ts        # TypeScript type definitions
│   │   ├── topology/
│   │   │   └── topologyEngine.ts  # Topology management
│   │   ├── simulation/
│   │   │   └── simulationEngine.ts # Packet processing
│   │   └── cli/
│   │       ├── parser.ts       # CLI parser
│   │       └── executor.ts     # CLI command executor
│   ├── stores/
│   │   └── simulationStore.ts  # Zustand state management
│   ├── pages/
│   │   └── api/
│   │       └── health.ts       # Health check API
│   └── tests/
│       ├── topology.test.ts    # Topology tests
│       ├── simulation.test.ts  # Simulation tests
│       └── cli.test.ts         # CLI tests
```

## Architecture

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

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## API Endpoints

- `GET /api/health` - Health check endpoint

## Environment Variables

- `NODE_ENV` - Environment mode (development/production)
- `PORT` - Server port (default: 3000)
- `NEXT_TELEMETRY_DISABLED` - Disable Next.js telemetry (default: 1)

## Troubleshooting

### Build Issues
If the build times out or fails, try:
```bash
# Clear Next.js cache
rm -rf .next

# Kill all Node processes and retry
taskkill /F /IM node.exe  # Windows
pkill -f node             # macOS/Linux
```

### Docker Issues
If Docker fails to start, ensure:
- Docker Desktop is running
- Ports 3000 are not in use by other applications

### Windows-Specific Issues
If you encounter path issues on Windows, use WSL2 or PowerShell.

## License

MIT License - See LICENSE file for details.

## Credits

Built with:
- Next.js
- React
- Konva.js
- Zustand
- xterm.js
- TypeScript
