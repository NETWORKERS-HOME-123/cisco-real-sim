package models

import "time"

type GradeResult struct {
	ID       string    `json:"id"`
	UserID   string    `json:"userId"`
	LabID    string    `json:"labId"`
	PresetID string    `json:"presetId,omitempty"`
	Score    int       `json:"score"`
	Total    int       `json:"total"`
	Passed   int       `json:"passed"`
	Details  string    `json:"details"`
	GradedAt time.Time `json:"gradedAt"`
}

type GradeResponse struct {
	Score   int               `json:"score"`
	Total   int               `json:"total"`
	Passed  int               `json:"passed"`
	Results []ObjectiveResult `json:"results"`
}

type ObjectiveResult struct {
	ID          int    `json:"id"`
	Passed      bool   `json:"passed"`
	Description string `json:"description"`
	Reason      string `json:"reason,omitempty"`
}
