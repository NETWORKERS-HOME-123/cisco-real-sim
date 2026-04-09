package handlers

import (
	"cisco-lab-server/config"
	"cisco-lab-server/database"
	"cisco-lab-server/middleware"
	"cisco-lab-server/models"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	Cfg *config.Config
}

func (h *AuthHandler) Register(c *fiber.Ctx) error {
	var input models.RegisterInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	if input.Username == "" || input.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "username and password required"})
	}
	if len(input.Password) < 6 {
		return c.Status(400).JSON(fiber.Map{"error": "password must be at least 6 characters"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	user := models.User{
		ID:          uuid.New().String(),
		Username:    input.Username,
		DisplayName: input.DisplayName,
	}
	if user.DisplayName == "" {
		user.DisplayName = user.Username
	}

	_, err = database.DB.Exec(
		"INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)",
		user.ID, user.Username, string(hash), user.DisplayName,
	)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "username already taken"})
	}

	token, err := middleware.GenerateToken(&user, h.Cfg)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	return c.Status(201).JSON(models.AuthResponse{Token: token, User: user})
}

func (h *AuthHandler) Login(c *fiber.Ctx) error {
	var input models.LoginInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	var user models.User
	var hash string
	err := database.DB.QueryRow(
		"SELECT id, username, password_hash, display_name, created_at FROM users WHERE username = ?",
		input.Username,
	).Scan(&user.ID, &user.Username, &hash, &user.DisplayName, &user.CreatedAt)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid credentials"})
	}

	token, err := middleware.GenerateToken(&user, h.Cfg)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	return c.JSON(models.AuthResponse{Token: token, User: user})
}

func (h *AuthHandler) Me(c *fiber.Ctx) error {
	userId := c.Locals("userId").(string)
	var user models.User
	err := database.DB.QueryRow(
		"SELECT id, username, display_name, created_at FROM users WHERE id = ?",
		userId,
	).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}
	return c.JSON(user)
}
