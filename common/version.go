package common

type Version struct {
	Version                 string `json:"version"`
	GrindVersionRequired    string `json:"grindVersionRequired"`
	GrindVersionRecommended string `json:"grindVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                 "2.3.0",
	GrindVersionRequired:    "2.3.0",
	GrindVersionRecommended: "2.3.0",
}
