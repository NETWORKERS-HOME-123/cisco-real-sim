package handlers

import (
	"cisco-lab-server/database"
	"cisco-lab-server/models"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type LabsHandler struct{}

func (h *LabsHandler) List(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	rows, err := database.DB.Query(
		"SELECT id, user_id, name, description, thumbnail, created_at, updated_at FROM labs WHERE user_id = ? ORDER BY updated_at DESC",
		userId,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	labs := []fiber.Map{}
	for rows.Next() {
		var l models.Lab
		if err := rows.Scan(&l.ID, &l.UserID, &l.Name, &l.Description, &l.Thumbnail, &l.CreatedAt, &l.UpdatedAt); err != nil {
			continue
		}
		labs = append(labs, fiber.Map{
			"id": l.ID, "name": l.Name, "description": l.Description,
			"thumbnail": l.Thumbnail, "createdAt": l.CreatedAt, "updatedAt": l.UpdatedAt,
		})
	}
	return c.JSON(labs)
}

func (h *LabsHandler) Create(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	var input models.LabInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	if input.Name == "" || input.Topology == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name and topology required"})
	}

	lab := models.Lab{
		ID:          uuid.New().String(),
		UserID:      userId,
		Name:        input.Name,
		Description: input.Description,
		Topology:    input.Topology,
		Thumbnail:   input.Thumbnail,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	_, err := database.DB.Exec(
		"INSERT INTO labs (id, user_id, name, description, topology, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		lab.ID, lab.UserID, lab.Name, lab.Description, lab.Topology, lab.Thumbnail, lab.CreatedAt, lab.UpdatedAt,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	return c.Status(201).JSON(lab)
}

func (h *LabsHandler) Get(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	labId := c.Params("id")

	var lab models.Lab
	err := database.DB.QueryRow(
		"SELECT id, user_id, name, description, topology, thumbnail, created_at, updated_at FROM labs WHERE id = ? AND user_id = ?",
		labId, userId,
	).Scan(&lab.ID, &lab.UserID, &lab.Name, &lab.Description, &lab.Topology, &lab.Thumbnail, &lab.CreatedAt, &lab.UpdatedAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "lab not found"})
	}
	return c.JSON(lab)
}

func (h *LabsHandler) Update(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	labId := c.Params("id")

	var input models.LabInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	result, err := database.DB.Exec(
		"UPDATE labs SET name = COALESCE(NULLIF(?, ''), name), description = ?, topology = COALESCE(NULLIF(?, ''), topology), thumbnail = ?, updated_at = ? WHERE id = ? AND user_id = ?",
		input.Name, input.Description, input.Topology, input.Thumbnail, time.Now(), labId, userId,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "lab not found"})
	}
	return c.JSON(fiber.Map{"message": "updated"})
}

func (h *LabsHandler) Delete(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	labId := c.Params("id")

	result, err := database.DB.Exec("DELETE FROM labs WHERE id = ? AND user_id = ?", labId, userId)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "lab not found"})
	}
	return c.JSON(fiber.Map{"message": "deleted"})
}

func (h *LabsHandler) Export(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	labId := c.Params("id")

	var lab models.Lab
	err := database.DB.QueryRow(
		"SELECT id, name, description, topology FROM labs WHERE id = ? AND user_id = ?",
		labId, userId,
	).Scan(&lab.ID, &lab.Name, &lab.Description, &lab.Topology)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "lab not found"})
	}

	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, lab.Name))
	return c.JSON(fiber.Map{
		"name": lab.Name, "description": lab.Description, "topology": lab.Topology,
		"exportedAt": time.Now(), "version": "1.0",
	})
}

func (h *LabsHandler) Import(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Topology    string `json:"topology"`
	}
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid import file"})
	}
	if input.Topology == "" {
		return c.Status(400).JSON(fiber.Map{"error": "topology data required"})
	}
	if input.Name == "" {
		input.Name = "Imported Lab"
	}

	lab := models.Lab{
		ID:          uuid.New().String(),
		UserID:      userId,
		Name:        input.Name,
		Description: input.Description,
		Topology:    input.Topology,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	_, err := database.DB.Exec(
		"INSERT INTO labs (id, user_id, name, description, topology, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		lab.ID, lab.UserID, lab.Name, lab.Description, lab.Topology, lab.CreatedAt, lab.UpdatedAt,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	return c.Status(201).JSON(lab)
}
