package main

import "time"

type Course struct {
	ID        int       `json:"id" meddler:"id,pk"`
	Name      string    `json:"name" meddler:"name"`
	Label     string    `json:"label" meddler:"lti_label"`
	LtiID     string    `json:"ltiID" meddler:"lti_id"`
	CanvasID  int       `json:"canvasID" meddler:"canvas_id"`
	CreatedAt time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}
