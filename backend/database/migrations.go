package database

import (
	"log"
	"strings"
)

func Migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			display_name TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS labs (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id),
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			topology TEXT NOT NULL,
			thumbnail TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS presets (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			category TEXT NOT NULL,
			difficulty TEXT NOT NULL,
			description TEXT DEFAULT '',
			objectives TEXT NOT NULL,
			topology TEXT NOT NULL,
			answer_key TEXT NOT NULL,
			sort_order INTEGER DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS grade_results (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id),
			lab_id TEXT NOT NULL REFERENCES labs(id),
			preset_id TEXT DEFAULT '',
			score INTEGER NOT NULL,
			total INTEGER NOT NULL,
			passed INTEGER NOT NULL,
			details TEXT NOT NULL,
			graded_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`,
		`CREATE INDEX IF NOT EXISTS idx_labs_user ON labs(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_grades_user ON grade_results(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_grades_lab ON grade_results(lab_id)`,
	}
	for _, m := range migrations {
		if _, err := DB.Exec(m); err != nil {
			// Ignore ALTER TABLE errors (column already exists)
			if !strings.Contains(err.Error(), "duplicate column") {
				return err
			}
		}
	}
	log.Println("database migrations complete")
	return nil
}
