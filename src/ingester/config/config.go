package config

// Assuming Configuration struct definition is globally accessible
type Configuration struct {
	IngesterPort string `json:"ingesterPort"`
	Pricing      struct {
		URL string `json:"url"`
	} `json:"pricing"`
	Database struct {
		Host         string `json:"host"`
		Name         string `json:"name"`
		Password     string `json:"password"`
		Port         string `json:"port"`
		SSLMode      string `json:"sslmode"`
		User         string `json:"user"`
		MaxIdleConns int    `json:"maxIdleConns"`
		MaxOpenConns int    `json:"maxOpenConns"`
	} `json:"database"`
}
