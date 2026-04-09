package handlers

import (
	"cisco-lab-server/database"
	"cisco-lab-server/models"

	"github.com/gofiber/fiber/v2"
)

type PresetsHandler struct{}

func (h *PresetsHandler) List(c *fiber.Ctx) error {
	rows, err := database.DB.Query(
		"SELECT id, name, category, difficulty, description, objectives, sort_order FROM presets ORDER BY sort_order",
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	presets := []fiber.Map{}
	for rows.Next() {
		var p models.Preset
		if err := rows.Scan(&p.ID, &p.Name, &p.Category, &p.Difficulty, &p.Description, &p.Objectives, &p.SortOrder); err != nil {
			continue
		}
		presets = append(presets, fiber.Map{
			"id": p.ID, "name": p.Name, "category": p.Category,
			"difficulty": p.Difficulty, "description": p.Description,
			"objectives": p.Objectives, "sortOrder": p.SortOrder,
		})
	}
	return c.JSON(presets)
}

func (h *PresetsHandler) Get(c *fiber.Ctx) error {
	presetId := c.Params("id")
	var p models.Preset
	err := database.DB.QueryRow(
		"SELECT id, name, category, difficulty, description, objectives, topology, answer_key, sort_order FROM presets WHERE id = ?",
		presetId,
	).Scan(&p.ID, &p.Name, &p.Category, &p.Difficulty, &p.Description, &p.Objectives, &p.Topology, &p.AnswerKey, &p.SortOrder)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "preset not found"})
	}
	return c.JSON(p)
}
