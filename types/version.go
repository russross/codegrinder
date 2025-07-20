package types

type Version struct {
	Version                  string `json:"version"`
	GrindVersionRequired     string `json:"grindVersionRequired"`
	GrindVersionRecommended  string `json:"grindVersionRecommended"`
	ThonnyVersionRequired    string `json:"thonnyVersionRequired"`
	ThonnyVersionRecommended string `json:"thonnyVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                  "2.7.0",
	GrindVersionRequired:     "2.7.0",
	GrindVersionRecommended:  "2.7.0",
	ThonnyVersionRecommended: "2.7.0",
	ThonnyVersionRequired:    "2.7.0",
}
