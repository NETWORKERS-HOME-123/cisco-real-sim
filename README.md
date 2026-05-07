<div align="center">

# 🖧 Cisco Real Sim

### Browser-based Cisco IOS CLI simulator for CCNA / CCNP lab practice

**Practice OSPF, ACLs, NAT, DHCP, STP, IPv6, VLANs — without a hardware lab, without Packet Tracer.**

[![CCNA](https://img.shields.io/badge/CCNA-200--301-1F4FD8?style=for-the-badge&logo=cisco&logoColor=white)](https://www.networkershome.com/best-ccna-course-in-bangalore/)
[![CCNP](https://img.shields.io/badge/CCNP%20Enterprise-FF6B35?style=for-the-badge&logo=cisco&logoColor=white)](https://www.networkershome.com/best-ccnp-enterprise-course-in-bangalore/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Built by Networkers Home](https://img.shields.io/badge/Built%20by-Networkers%20Home-000000?style=for-the-badge)](https://www.networkershome.com/)

</div>

---

## 🏛️ Built by Networkers Home

This simulator was built by **[Networkers Home](https://www.networkershome.com/)** — India's leading Cisco + cybersecurity training institute (Bengaluru, since 2005). It's the same lab tool used by our students in the [CCNA](https://www.networkershome.com/best-ccna-course-in-bangalore/) and [CCNP Enterprise](https://www.networkershome.com/best-ccnp-enterprise-course-in-bangalore/) programs to practice between live lab sessions on real Cisco hardware.

> **Want hands-on lab access on real Cisco gear?** Networkers Home runs 24×7 lab access at the HSR Layout campus with real Cisco/Palo Alto/Fortinet hardware. [Book a demo class →](https://www.networkershome.com/networkers-home-demo-class/)

**Compare top training institutes:**
[Top 10 CCNA Institutes in Bangalore](https://www.networkershome.com/top-10-ccna-training-institutes-bangalore-2026/) · [Top 10 CCNP Enterprise Institutes](https://www.networkershome.com/top-10-ccnp-enterprise-training-institutes-bangalore-2026/) · [Top 10 CCIE Enterprise India](https://www.networkershome.com/top-10-ccie-enterprise-training-institutes-india-2026/)

---

## ✨ Features

- **Hierarchical IOS CLI** — User EXEC, Privileged EXEC, Global Config, Interface Config modes
- **Drag-and-drop topology** — place devices, link interfaces, save/load topologies
- **Event-driven simulation** — ARP resolution, ICMP echo, packet flow visualization
- **Konva.js canvas** — zoom, pan, real-time packet animation
- **Web Workers** — non-blocking simulation runs in a separate thread
- **No real device emulation** — pure logical simulation (lightweight, runs in any browser)

## 🎯 Who this is for

- **CCNA candidates** practicing for the 200-301 exam
- **CCNP Enterprise candidates** drilling on OSPF, BGP, VLAN config
- **Networking instructors** wanting a free lab tool for classroom use
- **Self-learners** who can't afford physical Cisco gear

## 📚 Learn the underlying skills

This simulator **teaches you the syntax**. To master networking properly — protocols, troubleshooting methodology, real-hardware muscle memory, exam strategy — train with experts:

| Goal | Networkers Home program |
|---|---|
| Pass CCNA 200-301 | [CCNA course in Bangalore](https://www.networkershome.com/best-ccna-course-in-bangalore/) |
| Pass CCNP Enterprise | [CCNP Enterprise course](https://www.networkershome.com/best-ccnp-enterprise-course-in-bangalore/) |
| Become a network engineer | [Network Engineering program](https://www.networkershome.com/best-network-engineering-course-in-bangalore/) |
| Pass CCIE Enterprise lab | [CCIE Enterprise course](https://www.networkershome.com/best-ccie-enterprise-course-in-bangalore/) |
| Online study (anywhere in India) | [Online networking courses](https://www.networkershome.com/networkershome-all-courses/) |

---

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

## 🚀 Quick Start

### Prerequisites
- Docker Desktop installed OR Node.js 18+ installed
- Git (optional, for cloning)

### Using Docker (Recommended)

```bash
docker-compose up -d
open http://localhost:3000
```

### Development Mode

```bash
docker-compose --profile dev up -d
open http://localhost:3000
```

### Local Development (Without Docker)

```bash
npm install
npm run dev
open http://localhost:3000
```

### Production Build

```bash
npm install
npm run build
npm start
```

## 🏗️ Architecture

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

## 🧪 Testing

```bash
npm test               # Run tests once
npm run test:watch     # Watch mode
```

## 🔌 API Endpoints

- `GET /api/health` - Health check endpoint

## 🌍 Environment Variables

- `NODE_ENV` - Environment mode (development/production)
- `PORT` - Server port (default: 3000)
- `NEXT_TELEMETRY_DISABLED` - Disable Next.js telemetry (default: 1)

## 🔧 Troubleshooting

### Build Issues
```bash
rm -rf .next
taskkill /F /IM node.exe   # Windows
pkill -f node              # macOS/Linux
```

### Docker Issues
- Ensure Docker Desktop is running
- Check port 3000 isn't in use

### Windows-Specific
Use WSL2 or PowerShell if you hit path issues.

## 🤝 Contributing

Pull requests welcome! For major changes, open an issue first to discuss what you'd like to change.

## 📜 License

MIT — see [LICENSE](LICENSE) file for details.

## 🙏 Built With

- [Next.js](https://nextjs.org/) — React framework
- [Konva.js](https://konvajs.org/) — 2D canvas
- [Zustand](https://zustand-demo.pmnd.rs/) — state management
- [xterm.js](https://xtermjs.org/) — terminal emulator
- [TypeScript](https://www.typescriptlang.org/) — type safety

---

<div align="center">

### 🏛️ Want to learn networking the right way?

**[Networkers Home](https://www.networkershome.com/)** — Bengaluru's leading Cisco + cybersecurity training institute since 2005.
20,000+ alumni placed · 800+ hiring partners · 100% placement guarantee.

[**Book a free demo class**](https://www.networkershome.com/networkers-home-demo-class/) · [**See our placement record**](https://www.networkershome.com/networkers-home-placement-record-2026/) · [**Talk to a counsellor**](https://www.networkershome.com/career-counselling/)

</div>
