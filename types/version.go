package types

type Version struct {
	Version                 string `json:"version"`
	GrindVersionRequired    string `json:"grindVersionRequired"`
	GrindVersionRecommended string `json:"grindVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                 "1.9.2",
	GrindVersionRequired:    "1.9.2",
	GrindVersionRecommended: "1.9.2",
}
