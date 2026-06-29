package otlp

import "testing"

// TestDetectHostFromBinary pins the cross-platform host matcher. The
// matcher must recognise the same logical host across macOS bundle
// paths, Linux binary names, and Windows .exe basenames — three very
// different conventions converging on one label.
func TestDetectHostFromBinary(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want string
	}{
		// Cursor across platforms.
		{"cursor-macos", "/Applications/Cursor.app/Contents/MacOS/Cursor", "cursor"},
		{"cursor-macos-helper", "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper", "cursor"},
		{"cursor-linux", "/usr/share/cursor/cursor", "cursor"},
		{"cursor-windows", `C:\Users\me\AppData\Local\Programs\cursor\Cursor.exe`, "cursor"},

		// VS Code across platforms.
		{"vscode-macos", "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", "vscode"},
		{"vscode-macos-helper", "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper", "vscode"},
		{"vscode-windows", `C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe`, "vscode"},
		{"vscodium-windows", `C:\Program Files\VSCodium\VSCodium.exe`, "vscode"},

		// Terminals.
		{"warp-macos", "/Applications/Warp.app/Contents/MacOS/stable", "warp"},
		{"warp-windows", `C:\Users\me\AppData\Local\Programs\Warp\Warp.exe`, "warp"},
		{"wezterm-linux", "/usr/bin/wezterm-gui", "wezterm"},
		{"wezterm-windows", `C:\Program Files\WezTerm\wezterm-gui.exe`, "wezterm"},

		// Windows-only hosts.
		{"windows-terminal", `C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.18\WindowsTerminal.exe`, "windows-terminal"},
		{"windows-terminal-wt", `C:\Users\me\AppData\Local\Microsoft\WindowsApps\wt.exe`, "windows-terminal"},
		{"powershell-pwsh", `C:\Program Files\PowerShell\7\pwsh.exe`, "powershell"},
		{"powershell-legacy", `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, "powershell"},
		{"cmd", `C:\Windows\System32\cmd.exe`, "cmd"},

		// JetBrains across platforms.
		{"jetbrains-macos", "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea", "jetbrains"},
		{"jetbrains-windows", `C:\Program Files\JetBrains\IntelliJ IDEA 2025.3\bin\idea64.exe`, "jetbrains"},

		// Negative cases.
		{"empty", "", ""},
		{"unrelated", "/usr/bin/bash", ""},
		{"unrelated-windows", `C:\Windows\System32\notepad.exe`, ""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := detectHostFromBinary(tc.in)
			if got != tc.want {
				t.Errorf("detectHostFromBinary(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
