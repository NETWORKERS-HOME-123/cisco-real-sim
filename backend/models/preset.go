package models

type Preset struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Difficulty  string `json:"difficulty"`
	Description string `json:"description"`
	Objectives  string `json:"objectives"`
	Topology    string `json:"topology"`
	AnswerKey   string `json:"answerKey"`
	SortOrder   int    `json:"sortOrder"`
}
