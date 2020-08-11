package types

type Version struct {
	Version                 string `json:"version"`
	GrindVersionRequired    string `json:"grindVersionRequired"`
	GrindVersionRecommended string `json:"grindVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                 "2.5.2",
	GrindVersionRequired:    "2.5.0",
	GrindVersionRecommended: "2.5.2",
}
