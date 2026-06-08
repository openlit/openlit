package engine

import "testing"

func TestUserServiceNameFromEnv(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"nil env", nil, ""},
		{"none set", map[string]string{"PATH": "/usr/bin"}, ""},
		{"OTEL_SERVICE_NAME wins", map[string]string{
			"OTEL_SERVICE_NAME":        "my-svc",
			"OTEL_RESOURCE_ATTRIBUTES": "service.name=other",
		}, "my-svc"},
		{"service.name from resource attrs", map[string]string{
			"OTEL_RESOURCE_ATTRIBUTES": "deployment.environment=prod,service.name=from-attrs,foo=bar",
		}, "from-attrs"},
		{"trims whitespace", map[string]string{"OTEL_SERVICE_NAME": "  spaced  "}, "spaced"},
		{"empty OTEL_SERVICE_NAME falls through to attrs", map[string]string{
			"OTEL_SERVICE_NAME":        "",
			"OTEL_RESOURCE_ATTRIBUTES": "service.name=attr-svc",
		}, "attr-svc"},
		{"resource attrs without service.name", map[string]string{
			"OTEL_RESOURCE_ATTRIBUTES": "deployment.environment=prod",
		}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := userServiceNameFromEnv(tc.env); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
