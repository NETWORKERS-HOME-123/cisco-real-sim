package config

import (
	"os"
	"time"
)

type Config struct {
	Port         string
	DatabasePath string
	JWTSecret    string
	JWTExpiry    time.Duration
	StaticDir    string
}

func Load() *Config {
	return &Config{
		Port:         getEnv("PORT", "3000"),
		DatabasePath: getEnv("DB_PATH", "./labs.db"),
		JWTSecret:    getEnv("JWT_SECRET", "change-me-in-production"),
		JWTExpiry:    7 * 24 * time.Hour,
		StaticDir:    getEnv("STATIC_DIR", "../out"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
