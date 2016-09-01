package common

type Version struct {
	Version                 string `json:"version"`
	GrindVersionRequired    string `json:"grindVersionRequired"`
	GrindVersionRecommended string `json:"grindVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                 "2.0.4",
	GrindVersionRequired:    "2.0.1",
	GrindVersionRecommended: "2.0.4",
}
