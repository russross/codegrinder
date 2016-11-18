package common

type Version struct {
	Version                 string `json:"version"`
	GrindVersionRequired    string `json:"grindVersionRequired"`
	GrindVersionRecommended string `json:"grindVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                 "2.2.1",
	GrindVersionRequired:    "2.2.0",
	GrindVersionRecommended: "2.2.1",
}
