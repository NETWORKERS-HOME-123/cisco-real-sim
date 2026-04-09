package models

import "time"

type Lab struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Topology    string    `json:"topology"`
	Thumbnail   string    `json:"thumbnail,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type LabInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Topology    string `json:"topology"`
	Thumbnail   string `json:"thumbnail,omitempty"`
}
