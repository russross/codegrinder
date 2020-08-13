package types

type Version struct {
	Version                  string `json:"version"`
	GrindVersionRequired     string `json:"grindVersionRequired"`
	GrindVersionRecommended  string `json:"grindVersionRecommended"`
	ThonnyVersionRequired    string `json:"thonnyVersionRequired"`
	ThonnyVersionRecommended string `json:"thonnyVersionRecommended"`
}

var CurrentVersion = Version{
	Version:                  "2.5.3",
	GrindVersionRequired:     "2.5.3",
	GrindVersionRecommended:  "2.5.3",
	ThonnyVersionRecommended: "2.5.3",
	ThonnyVersionRequired:    "2.5.3",
}
