package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"cisco-lab-server/config"
	"cisco-lab-server/database"
	"cisco-lab-server/handlers"
	"cisco-lab-server/middleware"
	"cisco-lab-server/presets"
	wsHandler "cisco-lab-server/websocket"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/websocket/v2"
)

func main() {
	cfg := config.Load()

	// Database
	if err := database.Connect(cfg.DatabasePath); err != nil {
		log.Fatalf("database: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	if err := presets.Seed(); err != nil {
		log.Fatalf("seed presets: %v", err)
	}

	// Fiber
	app := fiber.New(fiber.Config{
		AppName:   "cisco-lab-server",
		BodyLimit: 50 * 1024 * 1024, // 50MB for large topologies
	})
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
	}))

	// Health
	app.Get("/api/v1/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// Auth (public)
	auth := &handlers.AuthHandler{Cfg: cfg}
	api := app.Group("/api/v1")
	api.Post("/auth/register", auth.Register)
	api.Post("/auth/login", auth.Login)

	// Protected routes
	protected := api.Group("", middleware.RequireAuth(cfg))
	protected.Get("/auth/me", auth.Me)

	// Labs
	labs := &handlers.LabsHandler{}
	protected.Get("/labs", labs.List)
	protected.Post("/labs", labs.Create)
	protected.Get("/labs/:id", labs.Get)
	protected.Put("/labs/:id", labs.Update)
	protected.Delete("/labs/:id", labs.Delete)
	protected.Get("/labs/:id/export", labs.Export)
	protected.Post("/labs/import", labs.Import)

	// Grading
	grading := &handlers.GradingHandler{}
	protected.Post("/labs/:id/grade", grading.Grade)
	protected.Get("/grades", grading.History)

	// Presets
	presetsH := &handlers.PresetsHandler{}
	protected.Get("/presets", presetsH.List)
	protected.Get("/presets/:id", presetsH.Get)

	// WebSocket
	app.Use("/ws", wsHandler.Upgrade(cfg))
	app.Get("/ws", websocket.New(wsHandler.Handle))

	// Static files (Next.js export)
	app.Static("/", cfg.StaticDir)
	// SPA fallback
	app.Get("/*", func(c *fiber.Ctx) error {
		return c.SendFile(cfg.StaticDir + "/index.html")
	})

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down...")
		app.Shutdown()
	}()

	fmt.Printf("cisco-lab-server starting on :%s\n", cfg.Port)
	log.Fatal(app.Listen(":" + cfg.Port))
}
