package presets

import (
	"cisco-lab-server/database"
	"log"
)

func Seed() error {
	count := 0
	database.DB.QueryRow("SELECT COUNT(*) FROM presets").Scan(&count)
	if count > 0 {
		log.Println("presets already seeded, skipping")
		return nil
	}

	labs := []struct {
		ID, Name, Category, Difficulty, Description, Objectives, Topology, AnswerKey string
		SortOrder                                                                    int
	}{
		{
			ID: "lab-01-basic-ip", Name: "Basic IP Addressing", Category: "routing", Difficulty: "beginner", SortOrder: 1,
			Description: "Configure IP addresses on two routers and verify connectivity with ping.",
			Objectives:  `[{"id":1,"description":"Configure R1 GigabitEthernet0/0 with IP 10.0.0.1/24"},{"id":2,"description":"Configure R2 GigabitEthernet0/0 with IP 10.0.0.2/24"},{"id":3,"description":"Ensure both interfaces are not shutdown"},{"id":4,"description":"Verify R1 can ping R2"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":200,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true}]},{"id":"r2","name":"Router2","type":"router","x":600,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true}]}],"connections":[{"id":"c1","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/0","targetDeviceId":"r2","targetInterface":"GigabitEthernet0/0"}]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"interface_ip","interface":"GigabitEthernet0/0","ip":"10.0.0.1","mask":"255.255.255.0"}]},{"id":2,"checks":[{"device":"Router2","type":"interface_ip","interface":"GigabitEthernet0/0","ip":"10.0.0.2","mask":"255.255.255.0"}]},{"id":3,"checks":[{"device":"Router1","type":"interface_up","interface":"GigabitEthernet0/0"},{"device":"Router2","type":"interface_up","interface":"GigabitEthernet0/0"}]},{"id":4,"checks":[{"device":"Router1","type":"route_exists","network":"10.0.0.0","mask":"255.255.255.0"}]}]}`,
		},
		{
			ID: "lab-02-static-routing", Name: "Static Routing", Category: "routing", Difficulty: "beginner", SortOrder: 2,
			Description: "Configure static routes between three routers so all networks are reachable.",
			Objectives:  `[{"id":1,"description":"Configure IP addresses on all router interfaces"},{"id":2,"description":"Add static route on R1 to reach 192.168.2.0/24 via R2"},{"id":3,"description":"Add static route on R3 to reach 192.168.0.0/24 via R2"},{"id":4,"description":"Configure default route on R2"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":150,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true}]},{"id":"r2","name":"Router2","type":"router","x":400,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true},{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":true}]},{"id":"r3","name":"Router3","type":"router","x":650,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true}]}],"connections":[{"id":"c1","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/0","targetDeviceId":"r2","targetInterface":"GigabitEthernet0/0"},{"id":"c2","sourceDeviceId":"r2","sourceInterface":"GigabitEthernet0/1","targetDeviceId":"r3","targetInterface":"GigabitEthernet0/0"}]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"interface_ip","interface":"GigabitEthernet0/0","ip":"192.168.0.1","mask":"255.255.255.0"},{"device":"Router2","type":"interface_ip","interface":"GigabitEthernet0/0","ip":"192.168.0.2","mask":"255.255.255.0"},{"device":"Router2","type":"interface_ip","interface":"GigabitEthernet0/1","ip":"192.168.1.1","mask":"255.255.255.0"},{"device":"Router3","type":"interface_ip","interface":"GigabitEthernet0/0","ip":"192.168.1.2","mask":"255.255.255.0"}]},{"id":2,"checks":[{"device":"Router1","type":"route_exists","network":"192.168.2.0","mask":"255.255.255.0"}]},{"id":3,"checks":[{"device":"Router3","type":"route_exists","network":"192.168.0.0","mask":"255.255.255.0"}]},{"id":4,"checks":[{"device":"Router2","type":"default_route"}]}]}`,
		},
		{
			ID: "lab-03-ospf-single", Name: "OSPF Single Area", Category: "routing", Difficulty: "intermediate", SortOrder: 3,
			Description: "Configure OSPF area 0 on three routers. All networks should be reachable via OSPF.",
			Objectives:  `[{"id":1,"description":"Configure OSPF process 1 on all routers"},{"id":2,"description":"Advertise all connected networks into area 0"},{"id":3,"description":"Verify OSPF neighbor adjacencies form"},{"id":4,"description":"Verify OSPF routes appear in routing tables"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":150,"y":200,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.12.1","subnetMask":"255.255.255.0","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"10.0.13.1","subnetMask":"255.255.255.0","isShutdown":false},{"name":"Loopback0","ip":"1.1.1.1","subnetMask":"255.255.255.255","isShutdown":false}]},{"id":"r2","name":"Router2","type":"router","x":550,"y":200,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.12.2","subnetMask":"255.255.255.0","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"10.0.23.1","subnetMask":"255.255.255.0","isShutdown":false},{"name":"Loopback0","ip":"2.2.2.2","subnetMask":"255.255.255.255","isShutdown":false}]},{"id":"r3","name":"Router3","type":"router","x":350,"y":450,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.13.2","subnetMask":"255.255.255.0","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"10.0.23.2","subnetMask":"255.255.255.0","isShutdown":false},{"name":"Loopback0","ip":"3.3.3.3","subnetMask":"255.255.255.255","isShutdown":false}]}],"connections":[{"id":"c1","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/0","targetDeviceId":"r2","targetInterface":"GigabitEthernet0/0"},{"id":"c2","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/1","targetDeviceId":"r3","targetInterface":"GigabitEthernet0/0"},{"id":"c3","sourceDeviceId":"r2","sourceInterface":"GigabitEthernet0/1","targetDeviceId":"r3","targetInterface":"GigabitEthernet0/1"}]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"ospf_enabled"},{"device":"Router2","type":"ospf_enabled"},{"device":"Router3","type":"ospf_enabled"}]},{"id":2,"checks":[{"device":"Router1","type":"ospf_network","network":"10.0.12.0","area":"0"},{"device":"Router1","type":"ospf_network","network":"10.0.13.0","area":"0"},{"device":"Router2","type":"ospf_network","network":"10.0.12.0","area":"0"},{"device":"Router2","type":"ospf_network","network":"10.0.23.0","area":"0"},{"device":"Router3","type":"ospf_network","network":"10.0.13.0","area":"0"},{"device":"Router3","type":"ospf_network","network":"10.0.23.0","area":"0"}]},{"id":3,"checks":[{"device":"Router1","type":"ospf_neighbor","neighbor":"Router2"},{"device":"Router1","type":"ospf_neighbor","neighbor":"Router3"}]},{"id":4,"checks":[{"device":"Router1","type":"route_exists","network":"10.0.23.0","mask":"255.255.255.0"}]}]}`,
		},
		{
			ID: "lab-04-vlan-config", Name: "VLAN Configuration", Category: "switching", Difficulty: "beginner", SortOrder: 4,
			Description: "Create VLANs on a switch and assign ports to the correct VLANs.",
			Objectives:  `[{"id":1,"description":"Create VLAN 10 (Sales) and VLAN 20 (Engineering)"},{"id":2,"description":"Assign Fa0/1-Fa0/5 to VLAN 10"},{"id":3,"description":"Assign Fa0/6-Fa0/10 to VLAN 20"},{"id":4,"description":"Configure Gi0/1 as trunk"}]`,
			Topology:    `{"devices":[{"id":"sw1","name":"Switch1","type":"switch","x":400,"y":300,"interfaces":[{"name":"FastEthernet0/1","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/2","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/6","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/7","ip":"","subnetMask":"","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":false}]}],"connections":[]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Switch1","type":"vlan_exists","vlanId":10},{"device":"Switch1","type":"vlan_exists","vlanId":20}]},{"id":2,"checks":[{"device":"Switch1","type":"vlan_port","interface":"FastEthernet0/1","vlanId":10},{"device":"Switch1","type":"vlan_port","interface":"FastEthernet0/2","vlanId":10}]},{"id":3,"checks":[{"device":"Switch1","type":"vlan_port","interface":"FastEthernet0/6","vlanId":20},{"device":"Switch1","type":"vlan_port","interface":"FastEthernet0/7","vlanId":20}]},{"id":4,"checks":[{"device":"Switch1","type":"trunk_configured","interface":"GigabitEthernet0/1"}]}]}`,
		},
		{
			ID: "lab-05-intervlan", Name: "Inter-VLAN Routing", Category: "switching", Difficulty: "intermediate", SortOrder: 5,
			Description: "Configure router-on-a-stick for inter-VLAN routing between VLAN 10 and VLAN 20.",
			Objectives:  `[{"id":1,"description":"Create VLANs 10 and 20 on the switch"},{"id":2,"description":"Configure trunk on switch uplink to router"},{"id":3,"description":"Configure router subinterfaces for each VLAN"},{"id":4,"description":"Assign correct IP addresses to subinterfaces"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":400,"y":150,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true}]},{"id":"sw1","name":"Switch1","type":"switch","x":400,"y":400,"interfaces":[{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/1","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/2","ip":"","subnetMask":"","isShutdown":false}]}],"connections":[{"id":"c1","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/0","targetDeviceId":"sw1","targetInterface":"GigabitEthernet0/1"}]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Switch1","type":"vlan_exists","vlanId":10},{"device":"Switch1","type":"vlan_exists","vlanId":20}]},{"id":2,"checks":[{"device":"Switch1","type":"trunk_configured","interface":"GigabitEthernet0/1"}]},{"id":3,"checks":[{"device":"Router1","type":"interface_up","interface":"GigabitEthernet0/0"}]},{"id":4,"checks":[{"device":"Router1","type":"interface_ip","interface":"GigabitEthernet0/0","ip":"10.0.10.1","mask":"255.255.255.0"}]}]}`,
		},
		{
			ID: "lab-06-standard-acl", Name: "Standard ACLs", Category: "security", Difficulty: "beginner", SortOrder: 6,
			Description: "Configure a standard ACL to permit traffic from 10.0.0.0/24 and deny all others. Apply it inbound on an interface.",
			Objectives:  `[{"id":1,"description":"Create standard ACL 10 permitting 10.0.0.0/24"},{"id":2,"description":"Apply ACL 10 inbound on R1 GigabitEthernet0/1"},{"id":3,"description":"Verify ACL appears in show access-lists"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":400,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.0.1","subnetMask":"255.255.255.0","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"192.168.1.1","subnetMask":"255.255.255.0","isShutdown":false}]}],"connections":[]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"acl_entry_exists"}]},{"id":2,"checks":[{"device":"Router1","type":"acl_applied","interface":"GigabitEthernet0/1"}]},{"id":3,"checks":[{"device":"Router1","type":"acl_entry_exists"}]}]}`,
		},
		{
			ID: "lab-07-extended-acl", Name: "Extended ACLs", Category: "security", Difficulty: "intermediate", SortOrder: 7,
			Description: "Configure an extended ACL to permit HTTP traffic from 10.0.0.0/24 to 192.168.1.0/24 and deny all else.",
			Objectives:  `[{"id":1,"description":"Create extended ACL 100 with permit and deny rules"},{"id":2,"description":"Apply ACL 100 on the correct interface and direction"},{"id":3,"description":"Verify with show ip access-lists"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":400,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.0.1","subnetMask":"255.255.255.0","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"192.168.1.1","subnetMask":"255.255.255.0","isShutdown":false}]}],"connections":[]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"acl_entry_exists"}]},{"id":2,"checks":[{"device":"Router1","type":"acl_applied","interface":"GigabitEthernet0/0"}]},{"id":3,"checks":[{"device":"Router1","type":"acl_entry_exists"}]}]}`,
		},
		{
			ID: "lab-08-nat-pat", Name: "Static NAT + PAT", Category: "security", Difficulty: "intermediate", SortOrder: 8,
			Description: "Configure static NAT for a server and PAT for internal hosts to access the internet.",
			Objectives:  `[{"id":1,"description":"Configure ip nat inside/outside on correct interfaces"},{"id":2,"description":"Create static NAT for server 10.0.0.10 to 203.0.113.10"},{"id":3,"description":"Configure PAT for 10.0.0.0/24 using the outside interface"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":400,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.0.1","subnetMask":"255.255.255.0","isShutdown":false},{"name":"GigabitEthernet0/1","ip":"203.0.113.1","subnetMask":"255.255.255.0","isShutdown":false}]}],"connections":[]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"nat_configured"}]},{"id":2,"checks":[{"device":"Router1","type":"nat_static","ip":"10.0.0.10"}]},{"id":3,"checks":[{"device":"Router1","type":"nat_configured"}]}]}`,
		},
		{
			ID: "lab-09-dhcp", Name: "DHCP Server", Category: "services", Difficulty: "beginner", SortOrder: 9,
			Description: "Configure the router as a DHCP server for the 10.0.0.0/24 network with gateway and DNS.",
			Objectives:  `[{"id":1,"description":"Create DHCP pool LAN with network 10.0.0.0/24"},{"id":2,"description":"Set default-router to 10.0.0.1"},{"id":3,"description":"Set dns-server to 8.8.8.8"},{"id":4,"description":"Exclude 10.0.0.1-10.0.0.10 from the pool"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":400,"y":300,"interfaces":[{"name":"GigabitEthernet0/0","ip":"10.0.0.1","subnetMask":"255.255.255.0","isShutdown":false}]}],"connections":[]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"dhcp_pool"}]},{"id":2,"checks":[{"device":"Router1","type":"dhcp_pool"}]},{"id":3,"checks":[{"device":"Router1","type":"dhcp_pool"}]},{"id":4,"checks":[{"device":"Router1","type":"dhcp_pool"}]}]}`,
		},
		{
			ID: "lab-10-full-build", Name: "Full Network Build", Category: "comprehensive", Difficulty: "advanced", SortOrder: 10,
			Description: "Build a complete network: 3 routers with OSPF, 2 switches with VLANs, inter-VLAN routing, ACLs, NAT, and DHCP.",
			Objectives:  `[{"id":1,"description":"Configure IP addressing on all devices"},{"id":2,"description":"Enable OSPF on all routers"},{"id":3,"description":"Create VLANs and trunks on switches"},{"id":4,"description":"Configure inter-VLAN routing"},{"id":5,"description":"Apply ACL to restrict traffic"},{"id":6,"description":"Configure NAT on the edge router"},{"id":7,"description":"Configure DHCP for client networks"}]`,
			Topology:    `{"devices":[{"id":"r1","name":"Router1","type":"router","x":200,"y":150,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true},{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":true}]},{"id":"r2","name":"Router2","type":"router","x":500,"y":150,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true},{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":true}]},{"id":"r3","name":"Router3","type":"router","x":350,"y":50,"interfaces":[{"name":"GigabitEthernet0/0","ip":"","subnetMask":"","isShutdown":true},{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":true}]},{"id":"sw1","name":"Switch1","type":"switch","x":200,"y":350,"interfaces":[{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/1","ip":"","subnetMask":"","isShutdown":false}]},{"id":"sw2","name":"Switch2","type":"switch","x":500,"y":350,"interfaces":[{"name":"GigabitEthernet0/1","ip":"","subnetMask":"","isShutdown":false},{"name":"FastEthernet0/1","ip":"","subnetMask":"","isShutdown":false}]}],"connections":[{"id":"c1","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/0","targetDeviceId":"r2","targetInterface":"GigabitEthernet0/0"},{"id":"c2","sourceDeviceId":"r1","sourceInterface":"GigabitEthernet0/1","targetDeviceId":"sw1","targetInterface":"GigabitEthernet0/1"},{"id":"c3","sourceDeviceId":"r2","sourceInterface":"GigabitEthernet0/1","targetDeviceId":"sw2","targetInterface":"GigabitEthernet0/1"},{"id":"c4","sourceDeviceId":"r3","sourceInterface":"GigabitEthernet0/0","targetDeviceId":"r1","targetInterface":"GigabitEthernet0/0"},{"id":"c5","sourceDeviceId":"r3","sourceInterface":"GigabitEthernet0/1","targetDeviceId":"r2","targetInterface":"GigabitEthernet0/0"}]}`,
			AnswerKey:   `{"objectives":[{"id":1,"checks":[{"device":"Router1","type":"interface_up","interface":"GigabitEthernet0/0"},{"device":"Router2","type":"interface_up","interface":"GigabitEthernet0/0"}]},{"id":2,"checks":[{"device":"Router1","type":"ospf_enabled"},{"device":"Router2","type":"ospf_enabled"},{"device":"Router3","type":"ospf_enabled"}]},{"id":3,"checks":[{"device":"Switch1","type":"vlan_exists","vlanId":10},{"device":"Switch2","type":"vlan_exists","vlanId":20}]},{"id":4,"checks":[{"device":"Router1","type":"interface_up","interface":"GigabitEthernet0/1"}]},{"id":5,"checks":[{"device":"Router3","type":"acl_entry_exists"}]},{"id":6,"checks":[{"device":"Router3","type":"nat_configured"}]},{"id":7,"checks":[{"device":"Router1","type":"dhcp_pool"}]}]}`,
		},
	}

	for _, l := range labs {
		_, err := database.DB.Exec(
			"INSERT INTO presets (id, name, category, difficulty, description, objectives, topology, answer_key, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			l.ID, l.Name, l.Category, l.Difficulty, l.Description, l.Objectives, l.Topology, l.AnswerKey, l.SortOrder,
		)
		if err != nil {
			return err
		}
	}
	log.Printf("seeded %d preset labs", len(labs))
	return nil
}
