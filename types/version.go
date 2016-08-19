package types

type Version struct {
	Version                 string `json:"version"`
	GrindVersionRequired    string `json:"grindVersionRequired"`
	GrindVersionRecommended string `json:"grindVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                 "1.9.7",
	GrindVersionRequired:    "1.9.7",
	GrindVersionRecommended: "1.9.7",
}
