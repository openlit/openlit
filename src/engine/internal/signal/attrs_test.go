package signal

import "testing"

func TestExtraAttributesIgnoreSensitiveKeys(t *testing.T) {
	if AllowedAttribute("app.tier") {
		t.Fatal("app.tier is not a default attribute")
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
