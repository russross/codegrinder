package main

import "time"

type User struct {
	ID             int       `json:"id" meddler:"id,pk"`
	Name           string    `json:"name" meddler:"name"`
	Email          string    `json:"email" meddler:"email"`
	LtiID          string    `json:"ltiID" meddler:"lti_id"`
	ImageURL       string    `json:"imageURL" meddler:"lti_image_url"`
	CanvasLogin    string    `json:"canvasLogin" meddler:"canvas_login"`
	CanvasID       int       `json:"canvasID" meddler:"canvas_id"`
	CreatedAt      time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt      time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
	LastSignedInAt time.Time `json:"lastSignedInAt" meddler:"last_signed_in_at,localtime"`
}
