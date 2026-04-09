package websocket

import (
	"cisco-lab-server/config"
	"cisco-lab-server/database"
	"cisco-lab-server/middleware"
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	ws "github.com/gofiber/websocket/v2"
	jwtpkg "github.com/golang-jwt/jwt/v5"
)

func Upgrade(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := c.Query("token")
		if token == "" {
			return c.Status(401).JSON(fiber.Map{"error": "token required"})
		}
		claims := &middleware.Claims{}
		t, err := jwtpkg.ParseWithClaims(token, claims, func(t *jwtpkg.Token) (interface{}, error) {
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !t.Valid {
			return c.Status(401).JSON(fiber.Map{"error": "invalid token"})
		}
		c.Locals("userId", claims.UserID)
		if ws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	}
}

func Handle(c *ws.Conn) {
	userId, _ := c.Locals("userId").(string)
	log.Printf("ws connected: user=%s", userId)
	defer c.Close()

	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			break
		}

		var payload struct {
			Type     string `json:"type"`
			LabID    string `json:"labId"`
			Topology string `json:"topology"`
		}
		if err := json.Unmarshal(msg, &payload); err != nil {
			continue
		}

		if payload.Type == "autosave" && payload.LabID != "" && payload.Topology != "" {
			_, err := database.DB.Exec(
				"UPDATE labs SET topology = ?, updated_at = ? WHERE id = ? AND user_id = ?",
				payload.Topology, time.Now(), payload.LabID, userId,
			)
			resp := fiber.Map{"type": "autosave_ack", "labId": payload.LabID}
			if err != nil {
				resp["error"] = "save failed"
			}
			ack, _ := json.Marshal(resp)
			c.WriteMessage(1, ack)
		}
	}
}
