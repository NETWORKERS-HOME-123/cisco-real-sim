package handlers

import (
	"cisco-lab-server/database"
	"time"

	"github.com/gofiber/fiber/v2"
)

type AdminHandler struct{}

func (h *AdminHandler) Dashboard(c *fiber.Ctx) error {
	var userCount, labCount, presetCount, gradeCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
	database.DB.QueryRow("SELECT COUNT(*) FROM labs").Scan(&labCount)
	database.DB.QueryRow("SELECT COUNT(*) FROM presets").Scan(&presetCount)
	database.DB.QueryRow("SELECT COUNT(*) FROM grade_results").Scan(&gradeCount)

	return c.JSON(fiber.Map{
		"stats": fiber.Map{
			"users":   userCount,
			"labs":    labCount,
			"presets": presetCount,
			"grades":  gradeCount,
		},
	})
}

func (h *AdminHandler) ListUsers(c *fiber.Ctx) error {
	rows, err := database.DB.Query(
		"SELECT id, username, display_name, COALESCE(is_admin, 0), created_at FROM users ORDER BY created_at DESC",
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	users := []fiber.Map{}
	for rows.Next() {
		var id, username, displayName string
		var isAdmin int
		var createdAt time.Time
		if err := rows.Scan(&id, &username, &displayName, &isAdmin, &createdAt); err != nil {
			continue
		}
		// Count labs for this user
		var labCount int
		database.DB.QueryRow("SELECT COUNT(*) FROM labs WHERE user_id = ?", id).Scan(&labCount)
		var gradeCount int
		database.DB.QueryRow("SELECT COUNT(*) FROM grade_results WHERE user_id = ?", id).Scan(&gradeCount)

		users = append(users, fiber.Map{
			"id": id, "username": username, "displayName": displayName,
			"isAdmin": isAdmin == 1, "createdAt": createdAt,
			"labCount": labCount, "gradeCount": gradeCount,
		})
	}
	return c.JSON(users)
}

func (h *AdminHandler) ListAllLabs(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT l.id, l.name, l.description, l.created_at, l.updated_at, u.username
		FROM labs l JOIN users u ON l.user_id = u.id
		ORDER BY l.updated_at DESC
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	labs := []fiber.Map{}
	for rows.Next() {
		var id, name, desc, username string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &name, &desc, &createdAt, &updatedAt, &username); err != nil {
			continue
		}
		labs = append(labs, fiber.Map{
			"id": id, "name": name, "description": desc,
			"owner": username, "createdAt": createdAt, "updatedAt": updatedAt,
		})
	}
	return c.JSON(labs)
}

func (h *AdminHandler) ListAllGrades(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT g.id, g.score, g.total, g.passed, g.graded_at, u.username,
			COALESCE(p.name, 'Custom') as preset_name
		FROM grade_results g
		JOIN users u ON g.user_id = u.id
		LEFT JOIN presets p ON g.preset_id = p.id
		ORDER BY g.graded_at DESC LIMIT 100
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	grades := []fiber.Map{}
	for rows.Next() {
		var id, username, presetName string
		var score, total, passed int
		var gradedAt time.Time
		if err := rows.Scan(&id, &score, &total, &passed, &gradedAt, &username, &presetName); err != nil {
			continue
		}
		grades = append(grades, fiber.Map{
			"id": id, "score": score, "total": total, "passed": passed,
			"gradedAt": gradedAt, "username": username, "presetName": presetName,
		})
	}
	return c.JSON(grades)
}

func (h *AdminHandler) DeleteUser(c *fiber.Ctx) error {
	userId := c.Params("id")
	// Don't allow deleting yourself
	currentUserId := c.Locals("userId").(string)
	if userId == currentUserId {
		return c.Status(400).JSON(fiber.Map{"error": "cannot delete yourself"})
	}
	// Delete user's grades, labs, then user
	database.DB.Exec("DELETE FROM grade_results WHERE user_id = ?", userId)
	database.DB.Exec("DELETE FROM labs WHERE user_id = ?", userId)
	result, err := database.DB.Exec("DELETE FROM users WHERE id = ?", userId)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}
	return c.JSON(fiber.Map{"message": "user deleted"})
}
