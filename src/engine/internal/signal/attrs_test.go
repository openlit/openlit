package signal

import "testing"

func TestExtraAttributesIgnoreSensitiveKeys(t *testing.T) {
	if !AllowedAttribute("app.tier") || !Groupable("gen_ai.agent.name") {
		t.Fatal("custom attributes should be usable without configuration")
	}
	if AllowedAttribute("user.email") || AllowedAttribute("session.id") || Known("client.ip") {
		t.Fatal("personal attributes need OPENLIT_SIGNAL_ATTRIBUTES")
	}
	SetExtraAttributes("app.tier, gen_ai.prompt, not a key")
	t.Cleanup(func() { SetExtraAttributes("") })
	if !AllowedAttribute("app.tier") || !Groupable("app.tier") {
		t.Fatal("expected app.tier to be groupable")
	}
	if AllowedAttribute("gen_ai.prompt") || Known("gen_ai.prompt") {
		t.Fatal("prompt attributes must stay blocked")
	}
	got, ok := (Signal{Attrs: map[string]string{"app.tier": "gold", "gen_ai.prompt": "secret"}}).Field("app.tier")
	if !ok || got != "gold" {
		t.Fatalf("field = %q, %v", got, ok)
	}
	if _, ok := (Signal{Attrs: map[string]string{"gen_ai.request.temperature": "0.2"}}).Number("gen_ai.request.temperature"); !ok {
		t.Fatal("expected numeric attribute")
	}
}

func TestPersonalAttributesCanBeEnabled(t *testing.T) {
	SetExtraAttributes("session.id")
	t.Cleanup(func() { SetExtraAttributes("") })
	if !AllowedAttribute("session.id") || AllowedAttribute("user.id") {
		t.Fatal("only configured personal attributes are allowed")
	}
}

func TestBuiltinNamesAreNotAttributes(t *testing.T) {
	for _, name := range []string{"service", "model", "http_status", "cost"} {
		if AllowedAttribute(name) {
			t.Fatalf("%s must resolve to the built-in field", name)
		}
	}
}

func TestPersonalAttributeSpellings(t *testing.T) {
	for _, key := range []string{"userId", "app.endUserID", "customerEmail", "contact_phone_number", "clientIP", "request.urlPath", "sessionToken.id"} {
		if AllowedAttribute(key) {
			t.Fatalf("%s must need OPENLIT_SIGNAL_ATTRIBUTES", key)
		}
	}
	for _, key := range []string{"app.tier", "gen_ai.agent.name", "zipCode", "shipping.region", "pipeline.stage"} {
		if !AllowedAttribute(key) {
			t.Fatalf("%s should be allowed", key)
		}
	}
}
