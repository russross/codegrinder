package types

type Version struct {
	Version                  string `json:"version"`
	GrindVersionRequired     string `json:"grindVersionRequired"`
	GrindVersionRecommended  string `json:"grindVersionRecommended"`
	ThonnyVersionRequired    string `json:"thonnyVersionRequired"`
	ThonnyVersionRecommended string `json:"thonnyVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                  "2.6.0",
	GrindVersionRequired:     "2.6.0",
	GrindVersionRecommended:  "2.6.0",
	ThonnyVersionRecommended: "2.5.5",
	ThonnyVersionRequired:    "2.5.3",
}
