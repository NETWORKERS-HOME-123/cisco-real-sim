package handlers

import (
	"cisco-lab-server/database"
	"cisco-lab-server/models"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type GradingHandler struct{}

type topoDevice struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Type         string      `json:"type"`
	Hostname     string      `json:"hostname"`
	Interfaces   []topoIface `json:"interfaces"`
	StaticRoutes []topoRoute `json:"staticRoutes"`
	OspfProcess  *topoOSPF   `json:"ospfProcess"`
	Vlans        []topoVLAN  `json:"vlans"`
	Acls         interface{} `json:"acls"`
	AclApps      interface{} `json:"aclApplications"`
	NatConfig    *topoNAT    `json:"natConfig"`
	DhcpConfig   *topoDHCP   `json:"dhcpConfig"`
}

type topoIface struct {
	Name       string `json:"name"`
	IP         string `json:"ip"`
	SubnetMask string `json:"subnetMask"`
	IsShutdown bool   `json:"isShutdown"`
	SwitchMode string `json:"switchportMode"`
	AccessVlan int    `json:"accessVlan"`
	TrunkMode  bool   `json:"isTrunk"`
}

type topoRoute struct {
	Network string `json:"network"`
	Mask    string `json:"mask"`
	NextHop string `json:"nextHop"`
}

type topoOSPF struct {
	ProcessId int           `json:"processId"`
	Networks  []ospfNetwork `json:"networks"`
}

type ospfNetwork struct {
	Network  string `json:"network"`
	Wildcard string `json:"wildcard"`
	Area     string `json:"area"`
}

type topoVLAN struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type topoNAT struct {
	InsideInterfaces  []string         `json:"insideInterfaces"`
	OutsideInterfaces []string         `json:"outsideInterfaces"`
	StaticEntries     []natStaticEntry `json:"staticEntries"`
}

type natStaticEntry struct {
	Inside  string `json:"inside"`
	Outside string `json:"outside"`
}

type topoDHCP struct {
	Enabled bool        `json:"enabled"`
	Pools   interface{} `json:"pools"`
}

type answerKey struct {
	Objectives []answerObjective `json:"objectives"`
}

type answerObjective struct {
	ID          int           `json:"id"`
	Description string        `json:"description"`
	Checks      []answerCheck `json:"checks"`
}

type answerCheck struct {
	Device    string `json:"device"`
	Type      string `json:"type"`
	Interface string `json:"interface,omitempty"`
	IP        string `json:"ip,omitempty"`
	Mask      string `json:"mask,omitempty"`
	Network   string `json:"network,omitempty"`
	Area      string `json:"area,omitempty"`
	Neighbor  string `json:"neighbor,omitempty"`
	VlanID    int    `json:"vlanId,omitempty"`
	Hostname  string `json:"hostname,omitempty"`
}

type topology struct {
	Devices []topoDevice `json:"devices"`
}

func (h *GradingHandler) Grade(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	labId := c.Params("id")

	var topoJSON string
	err := database.DB.QueryRow("SELECT topology FROM labs WHERE id = ? AND user_id = ?", labId, userId).Scan(&topoJSON)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "lab not found"})
	}

	var body struct {
		PresetID string `json:"presetId"`
	}
	c.BodyParser(&body)
	if body.PresetID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "presetId required"})
	}

	var akJSON string
	err = database.DB.QueryRow("SELECT answer_key FROM presets WHERE id = ?", body.PresetID).Scan(&akJSON)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "preset not found"})
	}

	var topo topology
	if err := json.Unmarshal([]byte(topoJSON), &topo); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid topology JSON"})
	}
	var ak answerKey
	if err := json.Unmarshal([]byte(akJSON), &ak); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "invalid answer key"})
	}

	deviceMap := map[string]*topoDevice{}
	for i := range topo.Devices {
		d := &topo.Devices[i]
		name := d.Name
		if d.Hostname != "" {
			name = d.Hostname
		}
		deviceMap[name] = d
		deviceMap[d.Name] = d
	}

	results := []models.ObjectiveResult{}
	passed := 0
	for _, obj := range ak.Objectives {
		objPassed := true
		reason := ""
		for _, check := range obj.Checks {
			dev := deviceMap[check.Device]
			if dev == nil {
				objPassed = false
				reason = "device " + check.Device + " not found"
				break
			}
			ok, r := runCheck(dev, check)
			if !ok {
				objPassed = false
				reason = r
				break
			}
		}
		if objPassed {
			passed++
		}
		results = append(results, models.ObjectiveResult{
			ID: obj.ID, Passed: objPassed, Description: obj.Description, Reason: reason,
		})
	}

	total := len(ak.Objectives)
	score := 0
	if total > 0 {
		score = (passed * 100) / total
	}

	resp := models.GradeResponse{Score: score, Total: total, Passed: passed, Results: results}

	detailsJSON, _ := json.Marshal(results)
	database.DB.Exec(
		"INSERT INTO grade_results (id, user_id, lab_id, preset_id, score, total, passed, details, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		uuid.New().String(), userId, labId, body.PresetID, score, total, passed, string(detailsJSON), time.Now(),
	)

	return c.JSON(resp)
}

func runCheck(dev *topoDevice, check answerCheck) (bool, string) {
	switch check.Type {
	case "interface_ip":
		iface := findInterface(dev, check.Interface)
		if iface == nil {
			return false, "interface " + check.Interface + " not found"
		}
		if iface.IP != check.IP {
			return false, "expected IP " + check.IP + ", got " + iface.IP
		}
		if check.Mask != "" && iface.SubnetMask != check.Mask {
			return false, "expected mask " + check.Mask + ", got " + iface.SubnetMask
		}
		return true, ""
	case "interface_up":
		iface := findInterface(dev, check.Interface)
		if iface == nil {
			return false, "interface " + check.Interface + " not found"
		}
		if iface.IsShutdown {
			return false, check.Interface + " is shutdown"
		}
		return true, ""
	case "ospf_enabled":
		if dev.OspfProcess == nil {
			return false, "OSPF not configured"
		}
		return true, ""
	case "ospf_network":
		if dev.OspfProcess == nil {
			return false, "OSPF not configured"
		}
		for _, n := range dev.OspfProcess.Networks {
			if matchNetwork(n.Network, check.Network) && (check.Area == "" || n.Area == check.Area) {
				return true, ""
			}
		}
		return false, "network " + check.Network + " not in OSPF"
	case "ospf_neighbor":
		return true, ""
	case "route_exists":
		for _, r := range dev.StaticRoutes {
			if r.Network == check.Network {
				return true, ""
			}
		}
		for _, iface := range dev.Interfaces {
			if !iface.IsShutdown && iface.IP != "" {
				net := applyMask(iface.IP, iface.SubnetMask)
				if net == check.Network {
					return true, ""
				}
			}
		}
		return false, "no route to " + check.Network
	case "default_route":
		for _, r := range dev.StaticRoutes {
			if r.Network == "0.0.0.0" && r.Mask == "0.0.0.0" {
				return true, ""
			}
		}
		return false, "no default route"
	case "vlan_exists":
		for _, v := range dev.Vlans {
			if v.ID == check.VlanID {
				return true, ""
			}
		}
		return false, "VLAN not found"
	case "vlan_port":
		iface := findInterface(dev, check.Interface)
		if iface == nil {
			return false, "interface not found"
		}
		if iface.AccessVlan != check.VlanID {
			return false, "wrong VLAN assignment"
		}
		return true, ""
	case "trunk_configured":
		iface := findInterface(dev, check.Interface)
		if iface == nil {
			return false, "interface not found"
		}
		if !iface.TrunkMode {
			return false, "not configured as trunk"
		}
		return true, ""
	case "hostname":
		name := dev.Hostname
		if name == "" {
			name = dev.Name
		}
		if !strings.EqualFold(name, check.Hostname) {
			return false, "hostname mismatch"
		}
		return true, ""
	case "nat_configured":
		if dev.NatConfig == nil {
			return false, "NAT not configured"
		}
		return true, ""
	case "nat_static":
		if dev.NatConfig == nil {
			return false, "NAT not configured"
		}
		for _, e := range dev.NatConfig.StaticEntries {
			if e.Inside == check.IP {
				return true, ""
			}
		}
		return false, "static NAT entry not found"
	case "dhcp_pool":
		if dev.DhcpConfig == nil || !dev.DhcpConfig.Enabled {
			return false, "DHCP not configured"
		}
		return true, ""
	case "acl_applied", "acl_entry_exists":
		return true, ""
	default:
		return false, "unknown check type: " + check.Type
	}
}

func findInterface(dev *topoDevice, name string) *topoIface {
	for i, iface := range dev.Interfaces {
		if strings.EqualFold(iface.Name, name) {
			return &dev.Interfaces[i]
		}
	}
	return nil
}

func matchNetwork(a, b string) bool {
	return strings.HasPrefix(a, strings.Split(b, "/")[0]) || a == b
}

func applyMask(ip, mask string) string {
	ipParts := strings.Split(ip, ".")
	maskParts := strings.Split(mask, ".")
	if len(ipParts) != 4 || len(maskParts) != 4 {
		return ""
	}
	result := make([]string, 4)
	for i := 0; i < 4; i++ {
		ipByte := parseByte(ipParts[i])
		maskByte := parseByte(maskParts[i])
		result[i] = strconv.Itoa(int(ipByte & maskByte))
	}
	return strings.Join(result, ".")
}

func parseByte(s string) byte {
	v := 0
	for _, c := range s {
		v = v*10 + int(c-'0')
	}
	return byte(v)
}

func (h *GradingHandler) History(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	rows, err := database.DB.Query(
		"SELECT id, lab_id, preset_id, score, total, passed, graded_at FROM grade_results WHERE user_id = ? ORDER BY graded_at DESC LIMIT 50",
		userId,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	grades := []fiber.Map{}
	for rows.Next() {
		var g models.GradeResult
		if err := rows.Scan(&g.ID, &g.LabID, &g.PresetID, &g.Score, &g.Total, &g.Passed, &g.GradedAt); err != nil {
			continue
		}
		grades = append(grades, fiber.Map{
			"id": g.ID, "labId": g.LabID, "presetId": g.PresetID,
			"score": g.Score, "total": g.Total, "passed": g.Passed, "gradedAt": g.GradedAt,
		})
	}
	return c.JSON(grades)
}
