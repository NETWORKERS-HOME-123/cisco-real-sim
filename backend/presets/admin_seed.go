package presets

import (
	"cisco-lab-server/database"
	"log"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func SeedAdmin() error {
	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM users WHERE username = 'admin'").Scan(&count)
	if count > 0 {
		log.Println("admin user already exists, skipping")
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = database.DB.Exec(
		"INSERT INTO users (id, username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?, ?)",
		uuid.New().String(), "admin", string(hash), "Administrator", 1,
	)
	if err != nil {
		return err
	}
	log.Println("seeded admin user (admin/admin)")
	return nil
}
